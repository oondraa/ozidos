/**
 * Režim bez serveru (GitHub Pages): všechno se počítá v prohlížeči.
 * - jízdní řády: `data/area.json` (staví GitHub Actions denně z GTFS),
 * - vyhledávání spojení a odjezdy: společné jádro shared/transit.ts,
 * - Nextbike: přímo z jejich API (má CORS).
 * Živé busy IREDO/DPmHK jdou přes prostředníka (proxy/, Vercel), pokud je nastavený VITE_LIVE_URL –
 * jejich API z prohlížeče přímo volat nejde.
 */
import { BBOX, inBbox, NEXTBIKE_CITY_IDS } from '../../shared/area';
import {
  planJourneys,
  prepareTimetable,
  searchStations,
  stationList,
  timetableDepartures,
  type AreaTimetable,
  type Timetable,
} from '../../shared/transit';
import { LIVE_URL, type BikePlace, type GroupDepartures, type LiveData, type Place, type PlanResult, type Stop, type TripDetail, type Vehicle } from './api';

let ttPromise: Promise<Timetable> | null = null;

/** Jízdní řády se stáhnou jednou (2,7 MB, komprimovaně ~0,5 MB) a drží v paměti. */
function timetable(): Promise<Timetable> {
  ttPromise ??= fetch(`${import.meta.env.BASE_URL}data/area.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`Jízdní řády se nenačetly (${r.status})`);
      return r.json() as Promise<AreaTimetable>;
    })
    .then(prepareTimetable);
  ttPromise.catch(() => (ttPromise = null));
  return ttPromise;
}

let stopsCache: Stop[] | null = null;

export async function staticStops(): Promise<Stop[]> {
  stopsCache ??= stationList(await timetable());
  return stopsCache;
}

export async function staticDepartures(stopId: string): Promise<GroupDepartures> {
  const tt = await timetable();
  const stop = (await staticStops()).find((s) => s.id === stopId);
  const byKey = await liveByKey();
  const departures = timetableDepartures(tt, stopId.replace(/^station:/, '')).map((d) => {
    const v = d.tripKey ? byKey.get(d.tripKey) : undefined;
    // spoj, který právě jede: zvýraznit (dá se na něj kliknout) a doplnit zpoždění
    return v
      ? { ...d, tripKey: v.tripKey, live: true, delaySec: v.delaySec, expectedAt: d.expectedAt + (v.delaySec ?? 0) * 1000 }
      : { ...d, tripKey: d.tripKey ?? '' };
  });
  return { stops: stop ? [stop] : [], departures, errors: [] };
}

export async function staticSearchPlaces(q: string): Promise<Place[]> {
  return searchStations(await timetable(), q);
}

export async function staticPlan(from: Place, to: Place, at?: number): Promise<PlanResult> {
  const tt = await timetable();
  const journeys = planJourneys(tt, from, to, at ?? Date.now());
  // Živé zpoždění u spojů IREDO (spárují se číslem spoje). MHD potřebuje odjezdovou tabuli – jen se serverem.
  const byKey = await liveByKey();
  for (const j of journeys)
    for (const l of j.legs) {
      const v = l.type === 'ride' && l.tripKey ? byKey.get(l.tripKey) : undefined;
      if (l.type === 'ride' && v) l.live = { delaySec: v.delaySec, onMap: true, lat: v.lat, lon: v.lon };
    }
  return { from, to, journeys };
}

// ---------------------------------------------------------------- živé busy přes prostředníka

const LIVE_TTL_MS = 8000;
let liveCache: { at: number; data: Promise<{ vehicles: Vehicle[]; status: LiveData['status'] }> } | null = null;

/** Živé busy z prostředníka (sdílené pro mapu, odjezdy i spojení; max. 1 dotaz za 8 s). */
function liveVehicles(): Promise<{ vehicles: Vehicle[]; status: LiveData['status'] }> {
  if (!LIVE_URL) return Promise.resolve({ vehicles: [], status: {} });
  if (liveCache && Date.now() - liveCache.at < LIVE_TTL_MS) return liveCache.data;
  const data = fetch(`${LIVE_URL}/api/live`)
    .then((r) => {
      if (!r.ok) throw new Error(`Živá data: ${r.status}`);
      return r.json() as Promise<LiveData>;
    })
    .then((d) => ({ vehicles: d.vehicles, status: d.status }))
    .catch((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      const err = { ok: false, lastSuccess: null, lastError: msg, itemCount: 0 };
      return { vehicles: [] as Vehicle[], status: { iredo: err, dpmhk: err } };
    });
  liveCache = { at: Date.now(), data };
  return data;
}

async function liveByKey(): Promise<Map<string, Vehicle>> {
  return new Map((await liveVehicles()).vehicles.map((v) => [v.tripKey, v]));
}

/** Trasa a zastávky spoje (klik na bus). */
export async function staticTrip(tripKey: string): Promise<TripDetail> {
  if (!LIVE_URL) throw new Error('Trasa spoje je jen s živými daty');
  const r = await fetch(`${LIVE_URL}/api/trip/${encodeURIComponent(tripKey)}`);
  const body = await r.json().catch(() => null);
  if (!r.ok) throw new Error(body?.error ?? `Prostředník odpověděl ${r.status}`);
  return body as TripDetail;
}

// ---------------------------------------------------------------- Nextbike

interface NbPlace {
  uid: number;
  lat: number;
  lng: number;
  bike: boolean;
  name: string;
  bikes: number;
  bikes_available_to_rent?: number;
  free_racks?: number;
  bike_racks?: number;
  bike_numbers?: string[];
  maintenance?: boolean;
}

async function nextbike(): Promise<BikePlace[]> {
  const res = await fetch(`https://maps.nextbike.net/maps/nextbike-live.json?city=${NEXTBIKE_CITY_IDS.join(',')}`);
  if (!res.ok) throw new Error(`Nextbike: ${res.status}`);
  const data = (await res.json()) as { countries: { cities: { name: string; places: NbPlace[] }[] }[] };
  const out: BikePlace[] = [];
  for (const country of data.countries)
    for (const city of country.cities)
      for (const p of city.places) {
        if (!inBbox(p.lat, p.lng, BBOX) || p.maintenance) continue;
        out.push({
          id: String(p.uid),
          name: p.bike ? `Kolo ${p.bike_numbers?.[0] ?? ''}`.trim() : p.name,
          city: city.name,
          lat: p.lat,
          lon: p.lng,
          isStation: !p.bike,
          bikes: p.bikes_available_to_rent ?? p.bikes,
          freeRacks: p.bike_racks ? (p.free_racks ?? null) : null,
          bikeNumbers: p.bike_numbers ?? [],
        });
      }
  return out;
}

/** Živá data bez serveru: Nextbike přímo + busy přes prostředníka (když je nastavený). */
export async function staticLive(): Promise<LiveData> {
  const now = Date.now();
  const [bikesR, liveR] = await Promise.allSettled([nextbike(), liveVehicles()]);
  const lv = liveR.status === 'fulfilled' ? liveR.value : { vehicles: [], status: {} };
  const bikes = bikesR.status === 'fulfilled' ? bikesR.value : [];
  const nb =
    bikesR.status === 'fulfilled'
      ? { ok: true, lastSuccess: now, lastError: null, itemCount: bikes.length }
      : { ok: false, lastSuccess: null, lastError: String((bikesR.reason as Error)?.message ?? bikesR.reason), itemCount: 0 };
  return { now, vehicles: lv.vehicles, bikes, status: { ...lv.status, nextbike: nb } };
}
