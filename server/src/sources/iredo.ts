/**
 * IDS IREDO – regionální autobusy a vlaky (Královéhradecký + Pardubický kraj).
 * Neoficiální API, které používá web https://iredo.online (mapa „Aktuální poloha spojů“).
 * Pokud přestane fungovat, podívej se do main.js na iredo.online (HttpService.getMapData).
 */
import { BBOX } from '../config.js';
import type { Departure, Stop, TripDetail, Vehicle } from '../types.js';
import { fetchJson, inBbox, parseShiftedUtc, pragueClockToEpoch } from '../util.js';

const BASE = 'https://iredo.online';
const MAX_SILENCE_MS = 10 * 60_000;

interface IredoConnection {
  id: string; // „S-650628-8“ (bus: linka-spoj) nebo „K-1388“ (vlak)
  name: string;
  vehicleType: 'A' | 'V' | string; // A = autobus, V = vlak
  sourceType: string;
  delay?: number; // minuty
  operator?: string;
  dep?: string;
  dest?: string;
  depTime?: string;
  destTime?: string;
  time?: string; // čas poslední polohy HH:MM:SS
  lat: number;
  lon: number;
  lineNumber?: number;
  extLineName?: string;
  trainNumber?: string;
  angle?: number;
  isDetour?: boolean;
  passengerCount?: number;
}

interface IredoStop {
  id: string; // „S-30675“ (bus) / „K-5453020“ (vlak)
  name: string;
  sourceType: string;
  lat: number;
  lon: number;
}

interface IredoMapData {
  connections: IredoConnection[] | null;
  stops: IredoStop[] | null;
}

function mapData(zoom: number): Promise<IredoMapData> {
  return fetchJson<IredoMapData>(`${BASE}/map/mapData`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...BBOX, zoom }),
  });
}

/** „Hradec Králové,,Terminál HD“ → „Hradec Králové, Terminál HD“ */
function cleanStop(s?: string): string | undefined {
  return s?.split(',').filter(Boolean).join(', ');
}

export async function fetchIredo(): Promise<Vehicle[]> {
  const data = await mapData(12);
  const now = Date.now();
  const vehicles = (data.connections ?? []).map((c): Vehicle => {
    const isTrain = c.vehicleType === 'V';
    return {
      tripKey: `iredo:${c.id}`,
      source: 'iredo',
      kind: isTrain ? 'train' : 'bus',
      line: c.extLineName ?? (c.lineNumber != null ? String(c.lineNumber) : c.name),
      name: c.name,
      from: cleanStop(c.dep),
      to: cleanStop(c.dest),
      depTime: c.depTime,
      arrTime: c.destTime,
      lat: c.lat,
      lon: c.lon,
      bearing: c.angle,
      delaySec: c.delay != null ? c.delay * 60 : null,
      operator: c.operator,
      updatedAt: (c.time && pragueClockToEpoch(c.time, now)) || now,
    };
  });
  // Spoje, které už dojely, v API chvíli zůstávají – bez čerstvé polohy je nezobrazujeme.
  return vehicles.filter((v) => now - v.updatedAt <= MAX_SILENCE_MS && inBbox(v.lat, v.lon, BBOX));
}

/** Všechny zastávky a stanice v oblasti (server je vrací až od zoomu 15). */
export async function fetchIredoStops(): Promise<Stop[]> {
  const data = await mapData(15);
  return (data.stops ?? []).filter((s) => inBbox(s.lat, s.lon, BBOX)).map((s) => ({
    id: `iredo:${s.id}`,
    name: cleanStop(s.name) ?? s.name,
    lat: s.lat,
    lon: s.lon,
    kind: s.sourceType === 'K' ? 'train' : 'bus',
  }));
}

interface IredoDetail {
  geometry?: string | null; // WKT LINESTRING(lon lat, …)
  stations: {
    id: string;
    name: string;
    arrivalTime?: string;
    departureTime?: string;
    passed?: boolean;
  }[];
}

/** „LINESTRING(16.26 50.16, …)“ → [[lat, lon], …] */
function parseWkt(wkt: string): [number, number][] {
  const out: [number, number][] = [];
  for (const m of wkt.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)) out.push([Number(m[2]), Number(m[1])]);
  return out;
}

/** Souřadnice zastávky, která není v katalogu (mimo oblast) – zeptáme se a zapamatujeme. */
const stationCache = new Map<string, { lat: number; lon: number } | null>();
async function stationCoords(id: string): Promise<{ lat: number; lon: number } | null> {
  if (stationCache.has(id)) return stationCache.get(id)!;
  try {
    const s = await fetchJson<IredoStop>(`${BASE}/oredo/getStation?id=${encodeURIComponent(id)}`);
    const c = s?.lat ? { lat: s.lat, lon: s.lon } : null;
    stationCache.set(id, c);
    return c;
  } catch {
    return null;
  }
}

export async function fetchIredoTrip(
  tripKey: string,
  lookupStop: (id: string) => { lat: number; lon: number } | undefined,
): Promise<TripDetail> {
  const id = tripKey.replace(/^iredo:/, '');
  const d = await fetchJson<IredoDetail>(`${BASE}/oredo/detail/${encodeURIComponent(id)}?geom=true`);
  const stops = await Promise.all(
    (d.stations ?? []).map(async (st) => {
      const c = lookupStop(`iredo:${st.id}`) ?? (await stationCoords(st.id));
      return {
        id: `iredo:${st.id}`,
        name: cleanStop(st.name) ?? st.name,
        lat: c?.lat ?? null,
        lon: c?.lon ?? null,
        plannedTime: st.departureTime ?? st.arrivalTime,
        passed: !!st.passed,
      };
    }),
  );
  const shape = d.geometry ? parseWkt(d.geometry) : [];
  return {
    tripKey,
    shape: shape.length ? shape : stops.filter((s) => s.lat != null).map((s) => [s.lat!, s.lon!]),
    stops,
  };
}

// ---------------------------------------------------------------- odjezdy ze zastávky

interface IredoDeparture {
  id: string; // stejné jako id spoje na mapě („S-661115-12“, „K-5180“)
  destStation?: string;
  sourceType: string; // S = bus, K = vlak
  depTime: string; // místní čas bez zóny, „2026-11-05T17:14:00“
  name?: string; // u vlaků „V23 (Os 5180)“
  extLineName?: string;
  lineNumber?: number;
  delay?: number; // minuty; chybí = neznámé
  platform?: string;
}

/** Odjezdová tabule IREDO (vrací zhruba nejbližší hodinu). */
export async function fetchIredoDepartures(stationId: string, maxCount = 30): Promise<Departure[]> {
  const rows = await fetchJson<IredoDeparture[]>(
    `${BASE}/crws/departures/${encodeURIComponent(stationId)}?maxCount=${maxCount}&langId=0`,
  );
  return (rows ?? []).map((r) => {
    const planned = parseShiftedUtc(`${r.depTime}Z`);
    const delaySec = r.delay != null ? r.delay * 60 : null;
    return {
      tripKey: `iredo:${r.id}`,
      kind: r.sourceType === 'K' ? 'train' : 'bus',
      line: r.extLineName ?? (r.lineNumber != null ? String(r.lineNumber) : (r.name ?? '?')),
      to: cleanStop(r.destStation),
      plannedTime: r.depTime.slice(11, 16),
      expectedAt: planned + (delaySec ?? 0) * 1000,
      delaySec,
      platform: r.platform?.trim() || undefined,
      live: false,
    };
  });
}

/** Tvar celé jízdy spoje (funguje i pro spoje, které ještě nevyjely). */
export async function fetchIredoGeometry(id: string): Promise<[number, number][]> {
  const d = await fetchJson<IredoDetail>(`${BASE}/oredo/detail/${encodeURIComponent(id)}?geom=true`);
  return d.geometry ? parseWkt(d.geometry) : [];
}
