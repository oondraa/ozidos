/**
 * Odjezdy ze zastávky – živé odjezdové tabule obou dopravců:
 * - IREDO (busy, vlaky): `crws/departures` (zhruba hodinu dopředu, se zpožděním),
 * - DPmHK (MHD): `getDeparturesOnPlatformWeb` nad platformami zastávky.
 * U spojů, které jsou právě na mapě, doplníme zpoždění z živé polohy.
 */
import { getDpmhkPlatforms, getStopGroup } from './catalog.js';
import { live } from './collector.js';
import { fetchDpmhkDepartures } from './sources/dpmhk.js';
import { fetchIredoDepartures } from './sources/iredo.js';
import type { Departure, StopDepartures, Stop } from './types.js';

/** Stejný rytmus jako zbytek – zdroje se neptáme častěji než jednou za 30 s na zastávku. */
const CACHE_MS = 30_000;
const MAX_ROWS = 30;
/** Číslo spoje se opakuje každý den – s živým vozem párujeme jen odjezdy v nejbližších hodinách. */
const LIVE_MATCH_WINDOW_MS = 3 * 3_600_000;

const cache = new Map<string, { at: number; data: Promise<StopDepartures> }>();

export function getDepartures(stopId: string): Promise<StopDepartures> {
  const hit = cache.get(stopId);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const data = load(stopId);
  cache.set(stopId, { at: Date.now(), data });
  data.catch(() => cache.delete(stopId));
  for (const [k, v] of cache) if (Date.now() - v.at > 10 * CACHE_MS) cache.delete(k);
  return data;
}

async function load(stopId: string): Promise<StopDepartures> {
  let deps: Departure[];
  if (stopId.startsWith('iredo:')) {
    deps = await fetchIredoDepartures(stopId.replace(/^iredo:/, ''));
  } else if (stopId.startsWith('dpmhk:')) {
    const platforms = getDpmhkPlatforms(stopId);
    if (!platforms.length) throw new Error('Pro zastávku MHD nemám seznam sloupků (zkus to za chvíli)');
    deps = await fetchDpmhkDepartures(platforms);
  } else {
    throw new Error('Neznámá zastávka');
  }

  const liveByKey = new Map([...live.vehicles.iredo, ...live.vehicles.dpmhk].map((v) => [v.tripKey, v]));
  const now = Date.now();
  for (const d of deps) {
    if (d.expectedAt - now > LIVE_MATCH_WINDOW_MS) continue;
    const v = liveByKey.get(d.tripKey);
    if (!v) continue;
    d.live = true;
    if (d.delaySec == null && v.delaySec != null) {
      d.delaySec = v.delaySec;
      d.expectedAt += v.delaySec * 1000;
    }
  }
  deps.sort((a, b) => a.expectedAt - b.expectedAt);
  return { stopId, departures: deps.filter((d) => d.expectedAt > now - 60_000).slice(0, MAX_ROWS) };
}

/**
 * Odjezdy z celé skupiny zastávek kolem kliknuté (např. Běleč: bus IREDO + MHD).
 * Chyba jednoho zdroje nevadí, dokud aspoň jeden odpoví.
 */
export async function getGroupDepartures(stopId: string): Promise<{ stops: Stop[]; departures: Departure[]; errors: string[] }> {
  const group = getStopGroup(stopId);
  const ids = group.length ? group.map((s) => s.id) : [stopId];
  const results = await Promise.allSettled(ids.map((id) => getDepartures(id)));
  const departures: Departure[] = [];
  const errors: string[] = [];
  for (const r of results) {
    if (r.status === 'fulfilled') departures.push(...r.value.departures);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }
  if (departures.length === 0 && errors.length === ids.length) throw new Error(errors[0]);
  departures.sort((a, b) => a.expectedAt - b.expectedAt);
  return { stops: group, departures: departures.slice(0, MAX_ROWS), errors };
}
