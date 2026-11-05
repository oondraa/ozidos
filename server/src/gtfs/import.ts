/**
 * Import jízdních řádů z celostátního GTFS (spojenka.cz / MFF UK, denně, nekomerční použití OK).
 * Z ~400 MB nezabaleného balíku vybere jen zastávky a jízdy v oblasti BBOX a uloží je
 * do kompaktního `area.json`, který se drží v paměti pro vyhledávání spojení.
 */
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import yauzl from 'yauzl';
import { BBOX, USER_AGENT } from '../config.js';
import { inBbox } from '../util.js';
import type { AreaTimetable, GtfsRoute, GtfsService, GtfsStop, GtfsTrip } from './types.js';

export const GTFS_URL = 'https://spojenka.d3s.mff.cuni.cz/api/data/timetable/gtfs';
/** Agentura „Dopravní podnik města Hradce Králové“ – její linky jsou MHD. */
const DPMHK_AGENCY = 'A173';
/** Zastávky kousek za hranicí bereme taky, ať jde dojít pěšky přes okraj oblasti. */
const MARGIN = 0.005;
const AREA = { w: BBOX.w - MARGIN, s: BBOX.s - MARGIN, e: BBOX.e + MARGIN, n: BBOX.n + MARGIN };

/** Jednoduchý CSV parser jednoho řádku (uvozovky, čárky uvnitř uvozovek). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) =>
    yauzl.open(path, { lazyEntries: true, autoClose: false }, (err, zip) => (err ? reject(err) : resolve(zip!))),
  );
}

function entryStream(zip: yauzl.ZipFile, name: string): Promise<Readable> {
  return new Promise((resolve, reject) => {
    zip.readEntry();
    zip.on('entry', function onEntry(entry: yauzl.Entry) {
      if (entry.fileName !== name) return zip.readEntry();
      zip.off('entry', onEntry);
      zip.openReadStream(entry, (err, stream) => (err ? reject(err) : resolve(stream!)));
    });
    zip.once('end', () => reject(new Error(`${name} v ZIPu chybí`)));
  });
}

/** Projde CSV soubor ze ZIPu řádek po řádku; `onRow` dostane objekt podle hlavičky. */
async function eachRow(zipPath: string, name: string, onRow: (row: Record<string, string>) => void): Promise<void> {
  const zip = await openZip(zipPath);
  try {
    const stream = await entryStream(zip, name);
    let header: string[] | null = null;
    for await (const raw of createInterface({ input: stream, crlfDelay: Infinity })) {
      const line = raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw;
      if (!line) continue;
      const cells = parseCsvLine(line);
      if (!header) {
        header = cells;
        continue;
      }
      const row: Record<string, string> = {};
      for (let i = 0; i < header.length; i++) row[header[i]] = cells[i] ?? '';
      onRow(row);
    }
  } finally {
    zip.close();
  }
}

function relation(rel: string | undefined, key: string): string | undefined {
  return rel?.split('|').find((r) => r.startsWith(`${key}:`))?.slice(key.length + 1);
}

function timeToSec(t: string): number {
  const [h, m, s] = t.split(':').map(Number);
  return h * 3600 + m * 60 + (s || 0);
}

/** Stáhne GTFS, pokud je na serveru novější verze. Vrací true, když se stáhlo. */
export async function downloadGtfs(zipPath: string): Promise<boolean> {
  const head = await fetch(GTFS_URL, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } });
  const remote = Date.parse(head.headers.get('last-modified') ?? '');
  const local = await stat(zipPath).then((s) => s.mtimeMs, () => 0);
  if (local && remote && remote <= local) return false;

  const res = await fetch(GTFS_URL, { headers: { 'User-Agent': USER_AGENT } });
  if (!res.ok || !res.body) throw new Error(`GTFS: HTTP ${res.status}`);
  const tmp = `${zipPath}.part`;
  await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
  await rename(tmp, zipPath);
  return true;
}

/** Ořízne celostátní GTFS na oblast a uloží `area.json`. */
export async function buildArea(zipPath: string, outPath: string): Promise<AreaTimetable> {
  const t0 = Date.now();

  // 1) zastávky v oblasti (nástupiště i jejich nadřazené „stanice“)
  const stops: GtfsStop[] = [];
  const stopIdx = new Map<string, number>();
  const parentNames = new Map<string, string>();
  await eachRow(zipPath, 'stops.txt', (r) => {
    const lat = Number(r.stop_lat);
    const lon = Number(r.stop_lon);
    if (!inBbox(lat, lon, AREA)) return;
    if (r.location_type === '1') {
      parentNames.set(r.stop_id, r.stop_name);
      return;
    }
    stopIdx.set(r.stop_id, stops.length);
    stops.push({ id: r.stop_id, name: r.stop_name, lat, lon, station: r.parent_station || r.stop_id, platform: r.platform_code || undefined });
  });

  // 2) časy zastavení jen na zastávkách v oblasti (soubor má ~350 MB, jde se proudově)
  const tripStops = new Map<string, { seq: number; stop: number; arr: number; dep: number; flags: number }[]>();
  await eachRow(zipPath, 'stop_times.txt', (r) => {
    const s = stopIdx.get(r.stop_id);
    if (s === undefined) return;
    let list = tripStops.get(r.trip_id);
    if (!list) tripStops.set(r.trip_id, (list = []));
    // flags: 1 = nelze nastoupit, 2 = nelze vystoupit
    const flags = (r.pickup_type === '1' ? 1 : 0) | (r.drop_off_type === '1' ? 2 : 0);
    list.push({ seq: Number(r.stop_sequence), stop: s, arr: timeToSec(r.arrival_time), dep: timeToSec(r.departure_time), flags });
  });
  for (const [id, list] of tripStops) if (list.length < 2) tripStops.delete(id);

  // 3) jízdy, linky, kalendáře – jen ty, které se v oblasti opravdu použijí
  const trips: GtfsTrip[] = [];
  const routeIds = new Set<string>();
  const serviceIds = new Set<string>();
  await eachRow(zipPath, 'trips.txt', (r) => {
    const st = tripStops.get(r.trip_id);
    if (!st) return;
    st.sort((a, b) => a.seq - b.seq);
    const cis = relation(r.relations, 'CISJR');
    trips.push({
      id: r.trip_id,
      route: r.route_id,
      service: r.service_id,
      headsign: r.trip_headsign || undefined,
      shortName: r.trip_short_name || undefined,
      cisTrip: cis ? Number(cis) : undefined,
      stops: st.map((x) => x.stop),
      arr: st.map((x) => x.arr),
      dep: st.map((x) => x.dep),
      flags: st.some((x) => x.flags) ? st.map((x) => x.flags) : undefined,
    });
    routeIds.add(r.route_id);
    serviceIds.add(r.service_id);
  });
  tripStops.clear();

  const routes: Record<string, GtfsRoute> = {};
  await eachRow(zipPath, 'routes.txt', (r) => {
    if (!routeIds.has(r.route_id)) return;
    const isMhd = r.agency_id === DPMHK_AGENCY;
    const kind = r.route_type === '2' ? 'train' : isMhd ? 'mhd' : 'bus';
    // MHD: route_short_name je „615006“, číslo linky je v názvu („linka: 6“)
    const line = isMhd ? (/linka:\s*(\w+)/.exec(r.route_long_name)?.[1] ?? String(Number(r.route_short_name) % 1000)) : r.route_short_name;
    routes[r.route_id] = { line, kind, cisLine: Number(relation(r.relations, 'CISJR')) || undefined, agency: r.agency_id };
  });

  const services: Record<string, GtfsService> = {};
  await eachRow(zipPath, 'calendar.txt', (r) => {
    if (!serviceIds.has(r.service_id)) return;
    const days = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => r[d] === '1');
    services[r.service_id] = { days, from: r.start_date, to: r.end_date, add: [], remove: [] };
  });
  await eachRow(zipPath, 'calendar_dates.txt', (r) => {
    if (!serviceIds.has(r.service_id)) return;
    const s = (services[r.service_id] ??= { days: Array(7).fill(false), from: r.date, to: r.date, add: [], remove: [] });
    (r.exception_type === '1' ? s.add : s.remove).push(r.date);
  });

  const stations: Record<string, string> = {};
  for (const s of stops) stations[s.station] = parentNames.get(s.station) ?? s.name;

  const area: AreaTimetable = {
    builtAt: Date.now(),
    feedTime: await stat(zipPath).then((s) => s.mtimeMs),
    stops,
    stations,
    routes,
    trips,
    services,
  };
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(`${outPath}.part`, JSON.stringify(area));
  await rename(`${outPath}.part`, outPath);
  console.log(`[gtfs] oblast: ${stops.length} nástupišť, ${trips.length} jízd, ${Object.keys(routes).length} linek (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  return area;
}
