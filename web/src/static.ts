/**
 * Režim bez serveru (GitHub Pages): všechno se počítá v prohlížeči.
 * - jízdní řády: `data/area.json` (staví GitHub Actions denně z GTFS),
 * - vyhledávání spojení a odjezdy: společné jádro shared/transit.ts,
 * - Nextbike: přímo z jejich API (má CORS).
 * Živé polohy busů IREDO/DPmHK tu nejsou – jejich API z prohlížeče volat nejde.
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
import type { BikePlace, GroupDepartures, LiveData, Place, PlanResult, Stop } from './api';

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
  const departures = timetableDepartures(tt, stopId.replace(/^station:/, '')).map((d) => ({ ...d, tripKey: d.tripKey ?? '' }));
  return { stops: stop ? [stop] : [], departures, errors: [] };
}

export async function staticSearchPlaces(q: string): Promise<Place[]> {
  return searchStations(await timetable(), q);
}

export async function staticPlan(from: Place, to: Place, at?: number): Promise<PlanResult> {
  const tt = await timetable();
  return { from, to, journeys: planJourneys(tt, from, to, at ?? Date.now()) };
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

/** „Živá“ data bez serveru: jen Nextbike (busy nejsou). */
export async function staticLive(): Promise<LiveData> {
  const now = Date.now();
  try {
    const bikes = await nextbike();
    return {
      now,
      vehicles: [],
      bikes,
      status: { nextbike: { ok: true, lastSuccess: now, lastError: null, itemCount: bikes.length } },
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { now, vehicles: [], bikes: [], status: { nextbike: { ok: false, lastSuccess: null, lastError: msg, itemCount: 0 } } };
  }
}
