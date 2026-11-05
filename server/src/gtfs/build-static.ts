/**
 * Postaví statická data pro web bez serveru (GitHub Pages):
 * stáhne celostátní GTFS, ořízne ho na oblast a uloží `area.json` do zadané složky.
 * Spouští se v GitHub Actions jednou denně:  npm run build:data -w server -- ../web/public/data
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { buildArea, downloadGtfs } from './import.js';
import { AREA_JSON, GTFS_ZIP } from './timetable.js';

const outDir = resolve(process.argv[2] ?? '../web/public/data');

await mkdir(new URL('../../data/gtfs/', import.meta.url), { recursive: true });
const downloaded = await downloadGtfs(GTFS_ZIP);
console.log(downloaded ? '[data] staženo nové GTFS' : '[data] GTFS je aktuální');
const area = await buildArea(GTFS_ZIP, AREA_JSON);

await mkdir(outDir, { recursive: true });
await writeFile(`${outDir}/area.json`, JSON.stringify(area));
console.log(`[data] ${outDir}/area.json – ${area.trips.length} jízd, ${area.stops.length} nástupišť`);
