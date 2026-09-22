#!/usr/bin/env node
/**
 * Generira cjenik proizvoda prema Odluci o objavi cjenika proizvoda i usluga
 * kao mjeri izravne kontrole cijena (NN 101/2026), uz sidrenu cijenu iz
 * Odluke o isticanju dodatne cijene (NN 101/2026).
 *
 * Izvor podataka: Shopify Admin GraphQL API.
 * Izlaz: public/cjenik.csv, public/cjenik.xml (uvijek najnovija verzija)
 *        public/arhiva/<naziv-po-odluci>.csv|.xml (trajni zapis svake objave)
 *
 * Pokretanje: node scripts/generate-cjenik.mjs
 * Potrebne varijable okoline:
 *   SHOPIFY_STORE_DOMAIN   npr. xz1ihj-0i.myshopify.com
 *   SHOPIFY_CLIENT_ID      Client ID aplikacije iz Dev Dashboarda
 *   SHOPIFY_CLIENT_SECRET  Client secret iste aplikacije
 *
 * Od 1. 1. 2026. Shopify vise ne izdaje trajne tokene za custom aplikacije.
 * Skripta pri svakom pokretanju razmijeni ID i secret za pristupni token
 * koji vrijedi 24 sata (client credentials grant). Token nigdje ne zapisujemo.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(readFileSync(join(ROOT, 'config.json'), 'utf8'));

const STORE = process.env.SHOPIFY_STORE_DOMAIN;
const CLIENT_ID = process.env.SHOPIFY_CLIENT_ID;
const CLIENT_SECRET = process.env.SHOPIFY_CLIENT_SECRET;
const API_VERSION = CONFIG.shopifyApiVersion;

if (!STORE || !CLIENT_ID || !CLIENT_SECRET) {
  console.error('Nedostaje SHOPIFY_STORE_DOMAIN, SHOPIFY_CLIENT_ID ili SHOPIFY_CLIENT_SECRET.');
  process.exit(1);
}

/* ---------- pristupni token (client credentials grant) ---------- */

async function dohvatiToken() {
  const res = await fetch(`https://${STORE}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`Neuspjesna prijava na Shopify (HTTP ${res.status}). ` +
      'Provjeri Client ID i secret te je li aplikacija instalirana na trgovinu ' +
      'i pripada li istoj Shopify organizaciji.');
  }
  const json = await res.json();
  if (!json.access_token) throw new Error('Shopify nije vratio pristupni token.');
  return json.access_token;
}

const TOKEN = await dohvatiToken();

/* ---------- dohvat iz Shopifyja ---------- */

const QUERY = `
query Cjenik($cursor: String) {
  products(first: 100, after: $cursor, query: "status:active", sortKey: TITLE) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        title
        vendor
        sidrena: metafield(namespace: "custom", key: "sidrena_cijena") { value }
        variants(first: 100) {
          edges {
            node {
              title
              sku
              barcode
              price
              compareAtPrice
              inventoryQuantity
              availableForSale
            }
          }
        }
      }
    }
  }
}`;

async function shopify(query, variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Shopify-Access-Token': TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.errors) throw new Error(`Shopify GraphQL: ${JSON.stringify(json.errors)}`);
  return json.data;
}

async function dohvatiProizvode() {
  const redovi = [];
  let cursor = null;
  do {
    const data = await shopify(QUERY, { cursor });
    for (const { node: p } of data.products.edges) {
      for (const { node: v } of p.variants.edges) {
        const naziv = v.title && v.title !== 'Default Title' ? `${p.title} - ${v.title}` : p.title;
        const cijena = Number(v.price);
        const usporedna = v.compareAtPrice ? Number(v.compareAtPrice) : null;
        const akcija = usporedna !== null && usporedna > cijena;
        redovi.push({
          naziv,
          sifra: v.sku || '',
          marka: p.vendor || CONFIG.zadanaMarka,
          jedinicaMjere: CONFIG.zadanaJedinicaMjere,
          cijenaPoJedinici: cijena,
          maloprodajnaCijena: cijena,
          posebanOblikProdaje: akcija,
          nazivPosebnogOblikaProdaje: akcija ? CONFIG.nazivPosebnogOblikaProdaje : '',
          sidrenaCijena: p.sidrena?.value != null ? Number(p.sidrena.value) : null,
          barkod: v.barcode || '',
          dostupnost: v.inventoryQuantity > 0
            ? CONFIG.oznakaNaZalihi
            : (v.availableForSale ? CONFIG.oznakaPoNarudzbi : CONFIG.oznakaNedostupno),
        });
      }
    }
    cursor = data.products.pageInfo.hasNextPage ? data.products.pageInfo.endCursor : null;
  } while (cursor);
  return redovi;
}

/* ---------- formatiranje ---------- */

const novac = (n) => (n === null || n === undefined ? '' : n.toFixed(2).replace('.', ','));

const STUPCI = [
  'naziv_proizvoda',
  'sifra_proizvoda',
  'marka',
  'neto_kolicina_jedinica_mjere',
  'cijena_za_jedinicu_mjere',
  'maloprodajna_cijena',
  'poseban_oblik_prodaje',
  'naziv_posebnog_oblika_prodaje',
  'sidrena_cijena',
  'barkod',
  'dostupnost',
];

function csvPolje(v) {
  const s = String(v ?? '');
  return /[;"\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function uCsv(redovi) {
  const linije = [STUPCI.join(';')];
  for (const r of redovi) {
    linije.push([
      r.naziv,
      r.sifra,
      r.marka,
      r.jedinicaMjere,
      novac(r.cijenaPoJedinici),
      novac(r.maloprodajnaCijena),
      r.posebanOblikProdaje ? 'DA' : 'NE',
      r.nazivPosebnogOblikaProdaje,
      novac(r.sidrenaCijena),
      r.barkod,
      r.dostupnost,
    ].map(csvPolje).join(';'));
  }
  // BOM zbog ispravnog prikaza dijakritike u Excelu
  return '﻿' + linije.join('\r\n') + '\r\n';
}

const xmlEscape = (v) => String(v ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

function uXml(redovi, meta) {
  const stavke = redovi.map((r) => `  <proizvod>
    <naziv_proizvoda>${xmlEscape(r.naziv)}</naziv_proizvoda>
    <sifra_proizvoda>${xmlEscape(r.sifra)}</sifra_proizvoda>
    <marka>${xmlEscape(r.marka)}</marka>
    <neto_kolicina_jedinica_mjere>${xmlEscape(r.jedinicaMjere)}</neto_kolicina_jedinica_mjere>
    <cijena_za_jedinicu_mjere>${novac(r.cijenaPoJedinici)}</cijena_za_jedinicu_mjere>
    <maloprodajna_cijena>${novac(r.maloprodajnaCijena)}</maloprodajna_cijena>
    <poseban_oblik_prodaje>${r.posebanOblikProdaje ? 'DA' : 'NE'}</poseban_oblik_prodaje>
    <naziv_posebnog_oblika_prodaje>${xmlEscape(r.nazivPosebnogOblikaProdaje)}</naziv_posebnog_oblika_prodaje>
    <sidrena_cijena>${novac(r.sidrenaCijena)}</sidrena_cijena>
    <barkod>${xmlEscape(r.barkod)}</barkod>
    <dostupnost>${xmlEscape(r.dostupnost)}</dostupnost>
  </proizvod>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<cjenik>
  <trgovac>
    <naziv>${xmlEscape(CONFIG.trgovac.naziv)}</naziv>
    <oib>${xmlEscape(CONFIG.trgovac.oib)}</oib>
    <adresa>${xmlEscape(CONFIG.trgovac.adresa)}</adresa>
  </trgovac>
  <objava>
    <oblik_prodajnog_objekta>${xmlEscape(CONFIG.oblikProdajnogObjekta)}</oblik_prodajnog_objekta>
    <oznaka_objekta>${xmlEscape(CONFIG.oznakaObjekta)}</oznaka_objekta>
    <broj_pohrane>${meta.brojPohrane}</broj_pohrane>
    <datum_vrijeme>${meta.iso}</datum_vrijeme>
  </objava>
${stavke}
</cjenik>
`;
}

/* ---------- imenovanje datoteka i arhiva ---------- */

const slug = (s) => s
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/đ/g, 'd').replace(/Đ/g, 'D')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

function vremenskaOznaka(d) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

function sljedeciBrojPohrane(putanjaStanja) {
  let stanje = { brojPohrane: 0 };
  try { stanje = JSON.parse(readFileSync(putanjaStanja, 'utf8')); } catch { /* prvi put */ }
  stanje.brojPohrane = (stanje.brojPohrane || 0) + 1;
  writeFileSync(putanjaStanja, JSON.stringify(stanje, null, 2) + '\n');
  return stanje.brojPohrane;
}

function ocistiArhivu(dir, danaZadrzati) {
  const granica = Date.now() - danaZadrzati * 24 * 60 * 60 * 1000;
  for (const ime of readdirSync(dir)) {
    if (ime === '.gitkeep' || ime === 'stanje.json') continue;
    const p = join(dir, ime);
    if (statSync(p).mtimeMs < granica) unlinkSync(p);
  }
}

/* ---------- glavni tok ---------- */

const sada = new Date();
const publicDir = join(ROOT, 'public');
const arhivaDir = join(publicDir, 'arhiva');
mkdirSync(arhivaDir, { recursive: true });

const brojPohrane = sljedeciBrojPohrane(join(arhivaDir, 'stanje.json'));
const osnova = [
  slug(CONFIG.oblikProdajnogObjekta),
  slug(CONFIG.trgovac.adresa),
  slug(CONFIG.oznakaObjekta),
  String(brojPohrane),
  vremenskaOznaka(sada),
].join('_');

const redovi = await dohvatiProizvode();
if (redovi.length === 0) throw new Error('Shopify nije vratio nijedan aktivan proizvod - prekidam da ne objavim prazan cjenik.');

const meta = { brojPohrane, iso: sada.toISOString() };
const csv = uCsv(redovi);
const xml = uXml(redovi, meta);

writeFileSync(join(publicDir, 'cjenik.csv'), csv);
writeFileSync(join(publicDir, 'cjenik.xml'), xml);
writeFileSync(join(arhivaDir, `${osnova}.csv`), csv);
writeFileSync(join(arhivaDir, `${osnova}.xml`), xml);

ocistiArhivu(arhivaDir, CONFIG.danaArhive);

const bezSidrene = redovi.filter((r) => r.sidrenaCijena === null);
const bezSifre = redovi.filter((r) => !r.sifra);
const bezBarkoda = redovi.filter((r) => !r.barkod);

console.log(`Cjenik objavljen: ${redovi.length} stavki, broj pohrane ${brojPohrane}, datoteka ${osnova}`);
if (bezSidrene.length) console.warn(`UPOZORENJE: bez sidrene cijene (${bezSidrene.length}): ${bezSidrene.map((r) => r.naziv).join(', ')}`);
if (bezSifre.length) console.warn(`UPOZORENJE: bez sifre (${bezSifre.length}): ${bezSifre.map((r) => r.naziv).join(', ')}`);
if (bezBarkoda.length) console.warn(`Napomena: bez barkoda (${bezBarkoda.length}).`);
