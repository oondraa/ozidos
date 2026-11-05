# OZIDOS – stav projektu a předávka mezi sessiony

> Tenhle soubor si Claude načte na začátku každé session. Na konci práce ho aktualizuj.
> Komunikace s uživatelem: **česky**.

## Co to je
Osobní IDOS pro uživatele, který bydlí v **Běleči nad Orlicí** (u HK), kde busy „spíš nejezdí, než jezdí“.
Mapa HK a okolí se **všemi živými spoji** (vlaky, busy IREDO, MHD Hradec), **Nextbike** (stanice + dostupnost, ukládá se do DB),
**zastávky**, **trasa spoje po kliknutí** a později **plánovač**. Je to jen pro jednoho uživatele.

## Spuštění
```bash
npm install
npm run dev      # server :8787 + web :5173 (Vite proxy /api → server)
npm run typecheck
```
DB: `server/data/ozidos.db` (vestavěné `node:sqlite`, Node 24). Pozor: po `TaskStop` může zůstat viset tsx proces na portu 8787 → najít a zabít.

## Hotovo (stav k 5. 11. 2026)
- **Server** (`server/`, Hono + TS):
  - `sources/iredo.ts`: živé busy + vlaky (`POST iredo.online/map/mapData`), zastávky (stejný endpoint se `zoom: 15` vrátí ~1400 zastávek), detail spoje (`/oredo/detail/{id}?geom=true` → WKT geometrie + stanice).
  - `sources/dpmhk.ts`: MHD (`dpmhk.qrbus.me/index/getAllRtdVehicles`), linky/trasy (`getLinesWithRoutes`, `getRoute`), zastávky spoje se skutečnými časy (`getPlatformsDataWithHistory`), zastávky (`getAllStops`). Vynechává „Přejezd“ (jízdy bez cestujících) a nesmyslná zpoždění.
  - `sources/nextbike.ts`: veřejné live API, města 682, 1140, 1253, 1254, 708, 768.
  - `collector.ts`: dotazy každých 10 s (Nextbike 60 s), při chybách backoff. `db.ts`: `trip_runs` (každý spoj a den: kdy viděn, zpoždění), `vehicle_positions` (1×/min, 14 dní), `bike_places`/`bike_counts`/`bike_sightings` (jen změny).
  - `catalog.ts`: katalog zastávek (denně), cache detailu spoje (20 s).
  - `departures.ts`: **odjezdy ze zastávky** – IREDO `GET /crws/departures/{S-822|K-…}?maxCount=30&langId=0` (vrací jen cca 1 h dopředu, `delay` v min), DPmHK `POST getDeparturesOnPlatformWeb {platformIds}` (~24 h dopředu, `departureDate` = očekávaný epoch s, `plan` = s od půlnoci). DPmHK chce **platformId** (sloupek, např. 8979), ne stopId z `getAllStops` (508001226) – převod z `GET getAllPlatforms` (`catalog.ts`). Kliknutá zastávka se slučuje se zastávkami do 150 m (Běleč = IREDO náves + MHD). Číslo spoje DPmHK se opakuje denně → s živým vozem párovat jen odjezdy do 3 h. Cache 30 s.
  - **Vyhledávání spojení** (náhrada IDOS): `gtfs/import.ts` stáhne celostátní GTFS (`spojenka.d3s.mff.cuni.cz/api/data/timetable/gtfs`, 80 MB, denně ~4:30; kontrola po 6 h přes Last-Modified) a proudově (yauzl) ho ořízne podle BBOX do `server/data/gtfs/area.json` (~2,7 MB, ~380 nástupišť, ~6900 jízd, import ~22 s). MHD = agency `A173` (číslo linky z `route_long_name` „linka: 6“). `gtfs/timetable.ts`: pěší přestupy do 450 m, spojení na den (i noční > 24 h). `planner.ts`: CSA, chůze k zastávce do 1,2 km (když nic, 2,5 km), další možnosti posunem odjezdu, filtr zbytečných spojení, pěšky když < 30 min. Živá data: IREDO bus = CISJR linka+spoj → `iredo:S-661115-12`, vlak `K-číslo`; MHD přes odjezdovou tabuli (linka + HH:MM). Chůze = vzdušná čára × 1,25 při 1,25 m/s (realistická pěší síť by šla převzít z OpenSISAKHk `scripts/walk.ts` + `src/shared/walkgraph.ts`).
  - `shapes.ts`: GTFS nemá tvary tras → úsek spojení se kreslí po silnici podle IREDO `oredo/detail/{S-…|K-…}?geom=true` (jde i pro spoje, co ještě nevyjely) nebo u MHD podle tras linky z DPmHK (`getRoute`, vybere se trasa přes zastávky úseku; zastávka se páruje k prvnímu průjezdu kvůli okružním linkám). Cache 6 h, limit 4 s, jinak rovné čáry.
  - API: `/api/plan?from=&to=&at=` (místo = `station:SC…` nebo `lat,lon,název`), `/api/places?q=`, `/api/places/near`, `/api/live`, `/api/stops`, `/api/trip/:tripKey`, `/api/departures/:stopId`, `/api/status`, `/api/history/line/:line`, `/api/history/bikes/:id`.
- **Web** (`web/`, Vite + React 19 + react-leaflet 5), **mobile-first**:
  - světlý panel s logem (`web/public/logo.png`, favikona A, ikona aplikace B z `assety/`, `manifest.webmanifest`); na šířce ≤ 700 px je panel spodní vysouvací list;
  - nahoře **Odkud/Kam** (`planner.tsx`): moje poloha, Doma, rychlé cíle, nedávné, hledání zastávek, čas; dlouhé podržení na mapě = Odsud/Sem; výsledky „vyraz za X min“, detail s živým zpožděním a „Kde je teď?“; spojení na mapě (jízda barevně, chůze čárkovaně);
  - **více dní**: výběr Teď/Dnes/Zítra/datum/čas (`WhenPicker`), výsledky s nadpisy dnů („Zítra · pátek 6. 11.“), „zítra v 5:12“, tlačítka Dřívější/Pozdější. Server: když den došel, jednou přejde na ráno dalšího dne a hledá pak až 20 h dopředu (o víkendu z Běleče jede v so 3 a v ne 2 spoje – ověřeno v GTFS); objížďky s přestupy výrazně delší než nejrychlejší spojení se vyřazují. Linka 700991 = na voze „991“, uživateli dlouhé číslo nevadí.
  - **poloha** (`geo.tsx`, modrá tečka, tlačítko 📍; prohlížeč ji dá jen přes HTTPS nebo localhost!);
  - **ztlumení**: při výběru spoje/spojení zešedne podklad i ostatní vozidla (třída `has-selection`);
  - vrstvy a podklad schované pod „⚙ Vrstvy a mapa“;
  - podklad **satelit** (Esri World Imagery + vrstvy silnic a názvů, bez klíče), tlačítkem přepnutelný na OSM;
  - vozidla jako **malé „3D“ autobusy/vlaky** z ptačí perspektivy (SVG v `layers.tsx`), natočené podle směru, stín na nerotovaném obalu, štítek linky s okrajem podle zpoždění; velikost podle zoomu přes třídy `zoom-far/mid/near` na mapě;
  - **vlaky ve výchozím stavu skryté** (uživatel je moc nepoužívá); vrstvy a podklad se pamatují v `localStorage` (`ozidos.layers`, `ozidos.view`);
  - **barvy podle skutečných vozů** (`web/src/colors.ts` + CSS proměnné): MHD červená, IREDO tmavě modrá s tyrkysovým pruhem, vlaky fialová;
  - Nextbike jako malé kolo (SVG) s počtem kol, prázdná stanice = šedý stojan;
  - zastávky jako malé označníky (sloupek + cedule v barvě dopravce), DOM markery od zoomu 14;
  - panel: vrstvy, stav zdrojů, „Teď u Běleče (3 km)“, nejbližší Nextbike;
  - **zastávky** se zobrazují od zoomu 14;
  - **klik na vozidlo** → přesná trasa + zastávky na mapě a v panelu jízdní řád (projeté šedě, příští zvýrazněná). Klik do mapy = zrušit výběr.
  - **klik na zastávku** → karta odjezdů (`departures.tsx`, obnova 30 s): „za X min“/„zítra 7:15“, nástupiště, zpoždění; spoje, které už jedou, mají modrý rámeček a klikem se vyberou na mapě.
- Ověřeno v prohlížeči (5. 11.): trasa vlaku V21, MHD linky 17 (přes Svinary → Běleč) a busu IREDO; odjezdy z Běleče (115 + MHD 17/11) a klik z tabule na živý spoj.

## Rozpracované / neověřené
- Nic rozpracovaného. Drobnost: u busu IREDO tabule odjezdů zná zpoždění (např. −1 min), ale živý feed u téhož vozu někdy ne → karta spoje ukáže „zpoždění neznámé“.
- Odjezdy IREDO jen ~1 h dopředu (parametry času API ignoruje) → delší výhled přinese GTFS.

## Další kroky (v tomto pořadí)
0. **ROZPRACOVÁNO – nasazení:** uživatel chce veřejné GitHub repo + GitHub Pages, ale NECHCE Oracle VM ani běžící domácí PC. Domov je už z kódu pryč (`web/src/home.ts`, localStorage; nastavení v poli Kam / podržením na mapě / v „Vrstvy a mapa“). Zjištěno (CORS z prohlížeče): Nextbike a GTFS mají `Access-Control-Allow-Origin: *`, IREDO a DPmHK NE (IREDO preflight 405). Navržený plán (ještě neschválený uživatelem): GitHub Actions denně postaví `area.json` z GTFS a nasadí Pages; vyhledávání (CSA) poběží v prohlížeči; pro IREDO/DPmHK malý bezstavový proxy (Vercel/Deno Deploy/Netlify Functions, ne Cloudflare); historie spojů (`trip_runs`) by bez stálého serveru odpadla. Git repo zatím NEexistuje, nic se nepushovalo.
1. Doladit UI na telefonu (uživatel chce další úpravy). Plánovač: alternativa Nextbikem, „příjezd do“, spojení s přestupem preferovat podle času čekání.
2. Statistiky spolehlivosti spojů do Běleče z `trip_runs` (jezdí to vůbec?).
3. PWA (mobil).
4. Hosting (nutné **HTTPS**, jinak na telefonu nepůjde poloha): uživatel chce **GitHub Pages nebo free tier, bez Cloudflare**. IREDO/DPmHK nemají CORS → nutný stále běžící backend (např. Oracle Cloud Free VM nebo domácí PC/RPi). Web: `VITE_API_URL`.

## Zásady
- **Žádné emoji v UI** (uživatel je nechce). Ikony jen z `web/src/icons.tsx` (obrysové SVG 24×24, čára 1,8, `currentColor`); nové ikony přidávat tam ve stejném stylu.
- **Výkon mapy (zoom se sekal):** na značkách (vozidla, kola, zastávky) NEpoužívat CSS `filter` (`drop-shadow`, `grayscale`) ani `transition` na transform – stíny kreslit přímo do SVG, ztlumení jen přes `opacity`. Dlaždice mají `updateWhenZooming: false`. Zastávky se vykreslují pro širší oblast (`pad(0.6)`) a přepočítají se, až když z ní výřez vyjede. Ve vývoji je mapa v konzoli jako `window.__map` (měření). Pozor: v okně ovládaném Claude in Chrome prohlížeč brzdí `requestAnimationFrame`, fps se tam měřit nedá.
- **Oblast je záměrně malá** (`BBOX` v `server/src/config.ts`): západ za Stěžery, sever za Všestary/Předměřice, východ za Třebechovice, jih za Čeperku. Uživatel nechce nic dál (dřív se to sekalo). Filtrují se vozidla, zastávky i Nextbike; web má `maxBounds` (`AREA_BOUNDS` v `App.tsx`) a `minZoom` 11.
- API IREDO a DPmHK jsou neoficiální (vyčtené z JS jejich webů) → dotazovat se šetrně (≥10 s), každý zdroj má vlastní adaptér.
- Mapové dlaždice CARTO chtějí API klíč → používat OSM.
