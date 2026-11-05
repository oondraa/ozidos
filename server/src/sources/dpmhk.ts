/**
 * MHD Hradec Králové (DPmHK) – autobusy a trolejbusy, včetně linek do Běleče.
 * Neoficiální API mapy https://dpmhk.qrbus.me (systém „wertyz“ / PIS).
 * Pole vozidla: ln = linka, tn = číslo spoje, rn = název trasy (např. „17001“), o = OBU,
 * li = ev. číslo vozu, la/lo = souřadnice × 1e5, d = zpoždění v s, l = poslední komunikace (místní čas s „Z“).
 */
import type { Departure, TripDetail, TripStop, Vehicle } from '../types.js';
import { BBOX } from '../config.js';
import { fetchJson, formatPragueClock, inBbox, parseShiftedUtc, pragueOffsetMs } from '../util.js';

const BASE = 'https://dpmhk.qrbus.me';
const COORD = 1e-5;
/** Stejný filtr jako oficiální mapa: vozidla bez komunikace > 5 min se nezobrazují. */
const MAX_SILENCE_MS = 5 * 60_000;
const MAX_PLAUSIBLE_DELAY_S = 3 * 3600;
const LINES_TTL_MS = 6 * 3_600_000;

function post<T>(path: string, body?: unknown): Promise<T> {
  return fetchJson<T>(`${BASE}/index/${path}`, {
    method: 'POST',
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// ---------------------------------------------------------------- linky a trasy (cache)

export interface DpRoute { id: number; name: string; endName2?: string; startName2?: string }
export interface DpLine { id: number; lineNumberText: string; routes: DpRoute[] }

let linesCache: { at: number; byNumber: Map<string, DpLine> } | null = null;

export async function getLines(): Promise<Map<string, DpLine>> {
  if (linesCache && Date.now() - linesCache.at < LINES_TTL_MS) return linesCache.byNumber;
  const data = await fetchJson<{ lines: DpLine[] }>(`${BASE}/index/getLinesWithRoutes`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  linesCache = { at: Date.now(), byNumber: new Map(data.lines.map((l) => [l.lineNumberText, l])) };
  return linesCache.byNumber;
}

function findRoute(ln: string, rn: string): { line: DpLine; route: DpRoute } | null {
  const line = linesCache?.byNumber.get(ln);
  const route = line?.routes.find((r) => r.name === rn);
  return line && route ? { line, route } : null;
}

interface DpSegment { segmentOrder: number; points: { order: number; latitude: number; longitude: number }[] }
const shapeCache = new Map<number, { at: number; shape: [number, number][] }>();

export async function getRouteShape(lineId: number, routeId: number): Promise<[number, number][]> {
  const hit = shapeCache.get(routeId);
  if (hit && Date.now() - hit.at < LINES_TTL_MS) return hit.shape;
  const data = await post<{ lines: { routes: { segments: DpSegment[] }[] }[] }>('getRoute', { lineId, routeId });
  const segments = [...(data.lines?.[0]?.routes?.[0]?.segments ?? [])].sort((a, b) => a.segmentOrder - b.segmentOrder);
  const shape: [number, number][] = [];
  for (const s of segments) {
    for (const p of [...s.points].sort((a, b) => a.order - b.order)) shape.push([p.latitude * COORD, p.longitude * COORD]);
  }
  shapeCache.set(routeId, { at: Date.now(), shape });
  return shape;
}

// ---------------------------------------------------------------- živá vozidla

interface RtdVehicle {
  vid: number;
  li: string;
  ln?: string;
  tn?: number;
  rn?: string;
  o?: number;
  la: number;
  lo: number;
  d?: number;
  l: string;
  az?: number;
}

interface RtdResponse {
  vehicles: RtdVehicle[];
  actualTimestamp: number; // epoch s
}

/** Údaje potřebné k dotazu na detail spoje, podle tripKey. */
const tripRefs = new Map<string, { ln: string; tn: number; rn: string; o: number }>();

export async function fetchDpmhk(): Promise<Vehicle[]> {
  await getLines().catch(() => null); // kvůli cílové zastávce; bez ní to taky jde
  const data = await post<RtdResponse>('getAllRtdVehicles');
  const serverNow = Math.min(data.actualTimestamp * 1000, Date.now());

  const out: Vehicle[] = [];
  tripRefs.clear();
  for (const v of data.vehicles) {
    if (!v.ln || !v.tn || !v.rn) continue; // není na spoji (deponie, manipulace)
    if (!/^\d+$/.test(v.ln)) continue; // „Přejezd“ apod. – jede bez cestujících
    if (!(v.lo < v.la)) continue; // nesmyslné souřadnice
    if (!inBbox(v.la * COORD, v.lo * COORD, BBOX)) continue;
    const updatedAt = parseShiftedUtc(v.l);
    if (serverNow - updatedAt > MAX_SILENCE_MS) continue;
    const tripKey = `dpmhk:${v.ln}-${v.tn}`;
    tripRefs.set(tripKey, { ln: v.ln, tn: v.tn, rn: v.rn, o: v.o ?? -1 });
    const route = findRoute(v.ln, v.rn)?.route;
    out.push({
      tripKey,
      source: 'dpmhk',
      kind: 'mhd',
      line: String(Number(v.ln)),
      name: `${Number(v.ln)} / ${v.tn}`,
      from: route?.startName2,
      to: route?.endName2,
      lat: v.la * COORD,
      lon: v.lo * COORD,
      bearing: v.az || undefined,
      // Nesmyslné hodnoty (např. −18181 s u vozů mimo jízdní řád) bereme jako neznámé.
      delaySec: typeof v.d === 'number' && Math.abs(v.d) < MAX_PLAUSIBLE_DELAY_S ? v.d : null,
      operator: 'DPmHK',
      vehicleNo: v.li,
      updatedAt,
    });
  }
  // Občas dva vozy hlásí stejný spoj (výměna vozu na trase) – necháme ten s čerstvější polohou.
  const byKey = new Map<string, Vehicle>();
  for (const v of out) {
    const prev = byKey.get(v.tripKey);
    if (!prev || v.updatedAt > prev.updatedAt) byKey.set(v.tripKey, v);
  }
  return [...byKey.values()];
}

// ---------------------------------------------------------------- detail spoje

interface DpPlatformRow {
  platformId: number;
  stopName: string;
  stopOrder: number;
  latitude: number;
  longitude: number;
  departureTime: number; // plán, „posunutý“ epoch s (místní čas jako UTC)
  realArrival: number; // skutečný epoch s, −1 = zatím ne
  realDeparture: number;
}

export async function fetchDpmhkTrip(tripKey: string): Promise<TripDetail | null> {
  const ref = tripRefs.get(tripKey);
  if (!ref) return null;
  await getLines();
  const [platforms, shape] = await Promise.all([
    post<{ platforms: DpPlatformRow[] }>('getPlatformsDataWithHistory', {
      lineNumber: ref.ln,
      tripNumber: ref.tn,
      routeNumber: ref.rn,
      obuNumber: ref.o,
    }),
    (async () => {
      const r = findRoute(ref.ln, ref.rn);
      return r ? getRouteShape(r.line.id, r.route.id) : [];
    })(),
  ]);

  const stops: TripStop[] = [...(platforms.platforms ?? [])]
    .sort((a, b) => a.stopOrder - b.stopOrder)
    .map((p) => {
      const real = p.realDeparture > 0 ? p.realDeparture : p.realArrival > 0 ? p.realArrival : null;
      return {
        id: `dpmhk:${p.platformId}`,
        name: p.stopName,
        lat: p.latitude * COORD,
        lon: p.longitude * COORD,
        plannedTime: new Date(p.departureTime * 1000).toISOString().slice(11, 16),
        realTime: real ? formatPragueClock(real * 1000) : undefined,
        passed: real != null,
      };
    });

  return { tripKey, shape: shape.length ? shape : stops.map((s) => [s.lat!, s.lon!]), stops };
}

// ---------------------------------------------------------------- zastávky

interface DpStop { id: number; name: string; lat: number; long: number }

export async function fetchDpmhkStops() {
  const data = await post<{ stops?: DpStop[] } | DpStop[]>('getAllStops');
  const arr = Array.isArray(data) ? data : (data.stops ?? []);
  return arr
    .filter((s) => s.lat && s.long && inBbox(s.lat * COORD, s.long * COORD, BBOX))
    .map((s) => ({ id: `dpmhk:${s.id}`, name: s.name, lat: s.lat * COORD, lon: s.long * COORD, kind: 'mhd' as const }));
}

// ---------------------------------------------------------------- odjezdy

/**
 * Odjezdové tabule fungují nad „platformami“ (sloupky, id např. 8979), ne nad zastávkami
 * z getAllStops (id 508001226). Proto si držíme převod zastávka → její platformy.
 */
interface DpPlatform { id: number; stopId: number }

export async function fetchDpmhkPlatformMap(): Promise<Map<string, number[]>> {
  const data = await fetchJson<{ platforms: DpPlatform[] }>(`${BASE}/index/getAllPlatforms`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
  });
  const map = new Map<string, number[]>();
  for (const p of data.platforms ?? []) {
    const key = `dpmhk:${p.stopId}`;
    map.set(key, [...(map.get(key) ?? []), p.id]);
  }
  return map;
}

interface DpDeparture {
  cancelled: boolean;
  departureDate: number; // očekávaný odjezd, skutečný epoch s
  plan: number; // plánovaný odjezd, sekundy od půlnoci (místní čas)
  destinationName: string;
  lineNumberText: string;
  tripNumber: number;
  platformNumber?: string;
  realTimePaired: number; // 1 = čas je podle živé polohy vozu
}

export async function fetchDpmhkDepartures(platformIds: number[]): Promise<Departure[]> {
  const data = await post<{ departures?: DpDeparture[] }>('getDeparturesOnPlatformWeb', { platformIds });
  return (data.departures ?? [])
    .filter((d) => !d.cancelled)
    .map((d) => {
      const expectedAt = d.departureDate * 1000;
      const hhmm = `${String(Math.floor(d.plan / 3600) % 24).padStart(2, '0')}:${String(Math.floor(d.plan / 60) % 60).padStart(2, '0')}`;
      // Plán převedeme na epoch stejného dne jako očekávaný odjezd (kvůli půlnoci).
      const day = parseShiftedUtc(`${new Date(expectedAt + pragueOffsetMs(expectedAt)).toISOString().slice(0, 10)}T00:00:00Z`);
      let planned = day + d.plan * 1000;
      if (planned - expectedAt > 12 * 3_600_000) planned -= 86_400_000;
      return {
        tripKey: `dpmhk:${d.lineNumberText}-${d.tripNumber}`,
        kind: 'mhd' as const,
        line: String(Number(d.lineNumberText) || d.lineNumberText),
        to: d.destinationName,
        plannedTime: hhmm,
        expectedAt,
        delaySec: d.realTimePaired ? Math.round((expectedAt - planned) / 1000) : null,
        platform: d.platformNumber?.trim() || undefined,
        live: false,
      };
    });
}
