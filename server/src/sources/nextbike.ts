/** Nextbike – veřejné live API (stanice + volně odložená kola). */
import { BBOX, NEXTBIKE_CITY_IDS } from '../config.js';
import type { BikePlace } from '../types.js';
import { fetchJson, inBbox } from '../util.js';

interface NbPlace {
  uid: number;
  lat: number;
  lng: number;
  bike: boolean; // true = volně odložené kolo (ne stanice)
  name: string;
  spot: boolean;
  bikes: number;
  bikes_available_to_rent?: number;
  free_racks?: number;
  bike_racks?: number;
  bike_numbers?: string[];
  active_place?: number;
  maintenance?: boolean;
}

interface NbLive {
  countries: { cities: { uid: number; name: string; places: NbPlace[] }[] }[];
}

export async function fetchNextbike(): Promise<BikePlace[]> {
  const url = `https://maps.nextbike.net/maps/nextbike-live.json?city=${NEXTBIKE_CITY_IDS.join(',')}`;
  const data = await fetchJson<NbLive>(url);
  const out: BikePlace[] = [];
  for (const country of data.countries) {
    for (const city of country.cities) {
      for (const p of city.places) {
        if (!inBbox(p.lat, p.lng, BBOX)) continue;
        if (p.maintenance) continue;
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
    }
  }
  return out;
}
