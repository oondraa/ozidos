/** Katalog zastávek (obnovuje se denně) a detail spojů (krátká cache). */
import { fetchDpmhkPlatformMap, fetchDpmhkStops, fetchDpmhkTrip } from './sources/dpmhk.js';
import { fetchIredoStops, fetchIredoTrip } from './sources/iredo.js';
import type { Stop, TripDetail } from './types.js';

const STOPS_REFRESH_MS = 24 * 3_600_000;
const TRIP_TTL_MS = 20_000;

let stops: Stop[] = [];
const stopById = new Map<string, Stop>();
/** MHD zastávka → id jejích platforem (sloupků) pro odjezdové tabule. */
let dpmhkPlatforms = new Map<string, number[]>();

async function loadStops(): Promise<void> {
  fetchDpmhkPlatformMap()
    .then((m) => (dpmhkPlatforms = m))
    .catch((e) => console.warn('[platformy MHD] chyba:', e instanceof Error ? e.message : e));
  const results = await Promise.allSettled([fetchIredoStops(), fetchDpmhkStops()]);
  const next: Stop[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') next.push(...r.value);
    else console.warn('[zastávky] chyba:', r.reason instanceof Error ? r.reason.message : r.reason);
  }
  if (next.length === 0) return; // radši nechat staré než nic
  stops = next;
  stopById.clear();
  for (const s of stops) stopById.set(s.id, s);
  console.log(`[zastávky] načteno ${stops.length}`);
}

export function startCatalog(): void {
  void loadStops();
  setInterval(() => void loadStops(), STOPS_REFRESH_MS);
}

export function getStops(): Stop[] {
  return stops;
}

export function getStop(id: string): Stop | undefined {
  return stopById.get(id);
}

/** Zastávky do `radiusM` metrů od dané (včetně ní) – IREDO a MHD mívají stejné místo pod jiným id. */
export function getStopGroup(id: string, radiusM = 150): Stop[] {
  const s = stopById.get(id);
  if (!s) return [];
  const r = Math.PI / 180;
  const near = stops.filter((o) => {
    const dy = (o.lat - s.lat) * r;
    const dx = (o.lon - s.lon) * r * Math.cos(s.lat * r);
    return 6_371_000 * Math.hypot(dx, dy) <= radiusM;
  });
  return [s, ...near.filter((o) => o.id !== id)].slice(0, 4);
}

export function getDpmhkPlatforms(stopId: string): number[] {
  return dpmhkPlatforms.get(stopId) ?? [];
}

const tripCache = new Map<string, { at: number; data: Promise<TripDetail | null> }>();

/** Trasa a zastávky spoje. Souběžné dotazy na stejný spoj sdílí jeden požadavek. */
export function getTrip(tripKey: string): Promise<TripDetail | null> {
  const hit = tripCache.get(tripKey);
  if (hit && Date.now() - hit.at < TRIP_TTL_MS) return hit.data;

  const data = (async () => {
    if (tripKey.startsWith('iredo:')) return fetchIredoTrip(tripKey, (id) => stopById.get(id));
    if (tripKey.startsWith('dpmhk:')) return fetchDpmhkTrip(tripKey);
    return null;
  })();
  tripCache.set(tripKey, { at: Date.now(), data });
  data.catch(() => tripCache.delete(tripKey));

  for (const [k, v] of tripCache) if (Date.now() - v.at > 10 * TRIP_TTL_MS) tripCache.delete(k);
  return data;
}
