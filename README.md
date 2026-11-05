# OZIDOS

Osobní IDOS pro Hradec Králové a okolí: živá mapa vlaků, busů IREDO, MHD Hradec a kol Nextbike. Všechno se ukládá do SQLite pro statistiky, jestli spoje do Běleče opravdu jezdí.

## Spuštění

```bash
npm install
npm run dev
```

- web: http://localhost:5173
- API: http://localhost:8787/api/live, `/api/status`, `/api/history/line/17`, `/api/history/bikes/<id>`
- databáze: `server/data/ozidos.db`

## Zdroje dat

| Zdroj | Co | Interval | Poznámka |
|---|---|---|---|
| iredo.online `/map/mapData` | regionální busy + vlaky | 10 s | neoficiální |
| dpmhk.qrbus.me `/index/getAllRtdVehicles` | MHD Hradec | 10 s | neoficiální |
| api.nextbike.net `nextbike-live.json` | stanice + kola | 60 s | veřejné |

Neoficiální API se můžou kdykoliv změnit. Každý zdroj má vlastní adaptér v `server/src/sources/`.

## Struktura

- `server/` – Node + Hono, sběr dat (`collector.ts`), SQLite (`db.ts`, vestavěné `node:sqlite`)
- `web/` – Vite + React + Leaflet.
- `shared/` – jádro jízdních řádů a vyhledávání spojení (CSA), společné pro server i web.

## GitHub Pages (bez serveru)

Web běží i bez serveru: <https://oondraa.github.io/ozidos/>. GitHub Actions (`.github/workflows/pages.yml`)
každé ráno stáhne celostátní GTFS, ořízne ho na okolí Hradce (`npm run build:data -w server`) a postaví web
s `VITE_STATIC=1`. Vyhledávání spojení, odjezdy podle jízdního řádu a Nextbike pak fungují přímo v prohlížeči.
Živé polohy a zpoždění busů jsou jen s běžícím serverem (API IREDO a DPmHK nejdou volat z prohlížeče).

Domov se nikam neposílá – nastavíš ho v aplikaci a uloží se jen v tvém prohlížeči.
