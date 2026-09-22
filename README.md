# Cjenik — Green Tools TECH

Dnevna objava cjenika proizvoda prema **Odluci o objavi cjenika proizvoda i usluga kao mjeri izravne kontrole cijena** i **Odluci o isticanju dodatne cijene** (obje NN 101/2026, primjena od 1. 10. 2026.).

Skripta povuče aktivne proizvode iz Shopifyja, zapiše `cjenik.csv` i `cjenik.xml` u `public/`, arhivira imenovanu kopiju i commita promjenu. Cloudflare Pages objavi `public/` na `cjenik.greentools.tech`.

Nije pravni savjet — za granične slučajeve konzultirati knjigovođu ili HOK.

## Što sadrži cjenik

Jedanaest stupaca propisanih točkom III. Odluke: naziv, šifra, marka, jedinica mjere, cijena za jedinicu mjere, maloprodajna cijena, je li primijenjen poseban oblik prodaje i koji, sidrena cijena, barkod, dostupnost.

CSV je razdvojen točka-zarezom, u UTF-8 s BOM-om, s decimalnim zarezom i bez oznake valute — otvara se ispravno u hrvatskim postavkama Excela.

## Postavljanje (jednokratno)

### 1. Shopify aplikacija i vjerodajnice

Od 1. 1. 2026. Shopify više ne dopušta stvaranje custom aplikacija iz admina, pa ide preko Dev Dashboarda: **Create app** → naziv `GTT cjenik` → dodaj opseg **`read_products`** (i ništa drugo) → **Release a version** → **Install** na trgovinu.

U postavkama aplikacije kopiraj **Client ID** i **Client secret**.

Trajnih tokena više nema. Skripta pri svakom pokretanju razmijeni ID i secret za pristupni token koji vrijedi 24 sata. Token se nigdje ne zapisuje ni ne commita.

Uvjet: aplikacija i trgovina moraju biti u istoj Shopify organizaciji, inače ta razmjena ne radi.

### 2. GitHub secrets

Repozitorij → Settings → Secrets and variables → Actions → New repository secret:

| Ime | Vrijednost |
|---|---|
| `SHOPIFY_STORE_DOMAIN` | `xz1ihj-0i.myshopify.com` |
| `SHOPIFY_CLIENT_ID` | Client ID iz koraka 1 |
| `SHOPIFY_CLIENT_SECRET` | Client secret iz koraka 1 |

### 3. Cloudflare Pages

Cloudflare → Workers & Pages → Create → Pages → Connect to Git → odaberi ovaj repozitorij.

- Framework preset: **None**
- Build command: *(prazno)*
- Build output directory: **`public`**

Nakon prvog deploya: Custom domains → Set up a custom domain → `cjenik.greentools.tech`. Cloudflare sam doda DNS zapis i certifikat.

### 4. Link na webshopu

U podnožje Shopify teme dodaj vidljiv link **Cjenik** na `https://cjenik.greentools.tech/`, dostupan bez prijave.

### 5. Prva objava

Actions → *Objava cjenika* → Run workflow. Provjeri da se datoteke pojave i da se `cjenik.csv` otvara u anonimnom prozoru.

## Raspored

Cron je postavljen na `30 4 * * 1-5` (UTC), što je 6:30 ljeti i 5:30 zimi po hrvatskom vremenu. Rok iz Odluke je 8:00, pa ima najmanje sat i pol zalihe — GitHubov raspoređivač zna kasniti i po pola sata.

Vikendom se ne izvodi jer Odluka traži objavu svakog **radnog** dana. Ako želiš i vikende, promijeni u `30 4 * * *`.

## Arhiva

Svaka objava zapisuje datoteku u `public/arhiva/` pod imenom propisanim točkom VI.:

```
internetska-trgovina_<adresa>_<oznaka-objekta>_<broj-pohrane>_<YYYYMMDD-HHmm>.csv
```

Broj pohrane raste monotono i čuva se u `public/arhiva/stanje.json`. Datoteke starije od 45 dana se brišu (Odluka traži najmanje 30). Uz to, svaka objava je i zaseban git commit — povijest repozitorija je dokaz što je i kada bilo objavljeno.

## Sidrena cijena

Sidrena cijena živi u Shopifyju kao metafield proizvoda **`custom.sidrena_cijena`** (tip: decimalni broj). Ista vrijednost hrani i prikaz na stranici proizvoda i ovaj cjenik, pa postoji samo jedan izvor istine.

Vrijednost je cijena zatečena **10. 9. 2026.** i **ne mijenja se** kad se promijeni prodajna cijena. Za proizvod uveden nakon tog datuma polje ostaje prazno; skripta ga tada izvijesti kao upozorenje, a stupac u cjeniku ostaje prazan.

## Održavanje

Skripta prekida rad ako se prijava na Shopify ne uspije ili ako Shopify vrati nula proizvoda, da se ne objavi prazan cjenik. Workflow tada padne i GitHub pošalje mail.

Na kraju svakog izvođenja ispisuje upozorenja za proizvode bez sidrene cijene, bez šifre i bez barkoda — vrijedi ih povremeno pogledati u logu.

### Kad dodaš novi proizvod

1. Postavi mu `custom.sidrena_cijena` ako je bio u prodaji 10. 9. 2026. Ako nije, ostavi prazno i zabilježi zašto.
2. Provjeri ima li šifru (SKU) — obvezan je stupac.
3. Sljedeća objava ga pokupi sama.

## Lokalno pokretanje

```bash
export SHOPIFY_STORE_DOMAIN=xz1ihj-0i.myshopify.com
export SHOPIFY_CLIENT_ID=...
export SHOPIFY_CLIENT_SECRET=...
npm run generate
```

## Provjera prije prve objave

Sve je popunjeno. Ostaje samo kreirati Shopify token i proći korake postavljanja iznad.
