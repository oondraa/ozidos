export type VehicleKind = 'train' | 'bus' | 'mhd';
export type SourceId = 'iredo' | 'dpmhk' | 'nextbike';

export interface Vehicle {
  tripKey: string;
  source: 'iredo' | 'dpmhk';
  kind: VehicleKind;
  line: string;
  name: string;
  from?: string;
  to?: string;
  depTime?: string;
  arrTime?: string;
  lat: number;
  lon: number;
  bearing?: number;
  delaySec: number | null;
  operator?: string;
  vehicleNo?: string;
  updatedAt: number;
}

export interface BikePlace {
  id: string;
  name: string;
  city: string;
  lat: number;
  lon: number;
  isStation: boolean;
  bikes: number;
  freeRacks: number | null;
  bikeNumbers: string[];
}

export interface SourceStatus {
  ok: boolean;
  lastSuccess: number | null;
  lastError: string | null;
  itemCount: number;
}

export interface LiveData {
  now: number;
  vehicles: Vehicle[];
  bikes: BikePlace[];
  status: Partial<Record<SourceId, SourceStatus>>;
}

export interface Stop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  kind: VehicleKind;
}

export interface TripStop {
  id?: string;
  name: string;
  lat: number | null;
  lon: number | null;
  plannedTime?: string;
  realTime?: string;
  passed: boolean;
}

export interface TripDetail {
  tripKey: string;
  shape: [number, number][];
  stops: TripStop[];
}

/** V dev režimu jde přes Vite proxy; jinde lze nastavit VITE_API_URL. */
const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/**
 * Režim bez serveru (GitHub Pages, `VITE_STATIC=1`): jízdní řády, vyhledávání a Nextbike
 * se počítají v prohlížeči, živé polohy busů nejsou. Viz static.ts.
 */
export const STATIC = import.meta.env.VITE_STATIC === '1';
/** Adresa prostředníka pro živé busy na GitHub Pages (Vercel, viz proxy/). */
export const LIVE_URL = (import.meta.env.VITE_LIVE_URL ?? '').replace(/\/$/, '');
/** Jsou k dispozici živé busy? (lokální server, nebo prostředník) */
export const HAS_LIVE = !STATIC || !!LIVE_URL;
const offline = () => import('./static');

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`);
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error ?? `Server odpověděl ${res.status}`);
  }
  return res.json();
}

export const getLive = () => (STATIC ? offline().then((m) => m.staticLive()) : get<LiveData>('/api/live'));
export const getStops = () => (STATIC ? offline().then((m) => m.staticStops()) : get<Stop[]>('/api/stops'));
export const getTrip = (tripKey: string) =>
  STATIC ? offline().then((m) => m.staticTrip(tripKey)) : get<TripDetail>(`/api/trip/${encodeURIComponent(tripKey)}`);

export interface Departure {
  tripKey: string;
  kind: VehicleKind;
  line: string;
  to?: string;
  plannedTime: string;
  expectedAt: number;
  delaySec: number | null;
  platform?: string;
  live: boolean;
}

export interface GroupDepartures {
  stops: Stop[];
  departures: Departure[];
  errors: string[];
}

export const getDepartures = (stopId: string) =>
  STATIC
    ? offline().then((m) => m.staticDepartures(stopId))
    : get<GroupDepartures>(`/api/departures/${encodeURIComponent(stopId)}`);

// ---------------------------------------------------------------- vyhledávání spojení

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** „station:SC27580“ u zastávky; u bodu chybí */
  id?: string;
}

export interface PlanStop {
  name: string;
  lat: number;
  lon: number;
  platform?: string;
  time: number;
}

export interface WalkLeg {
  type: 'walk';
  from: Place;
  to: Place;
  dep: number;
  arr: number;
  meters: number;
}

export interface RideLeg {
  type: 'ride';
  kind: VehicleKind;
  line: string;
  headsign?: string;
  from: PlanStop;
  to: PlanStop;
  stops: PlanStop[];
  dep: number;
  arr: number;
  tripKey?: string;
  /** tvar po silnici; chybí = rovně mezi zastávkami */
  shape?: [number, number][];
  live?: { delaySec: number | null; onMap: boolean; lat?: number; lon?: number };
}

export type Leg = WalkLeg | RideLeg;

export interface Journey {
  dep: number;
  arr: number;
  transfers: number;
  walkMeters: number;
  legs: Leg[];
}

export interface PlanResult {
  from: Place;
  to: Place;
  journeys: Journey[];
}

/** Místo jako parametr pro /api/plan. */
export function placeParam(p: Place): string {
  return p.id ?? `${p.lat.toFixed(6)},${p.lon.toFixed(6)},${encodeURIComponent(p.name)}`;
}

export const searchPlaces = (q: string) =>
  STATIC ? offline().then((m) => m.staticSearchPlaces(q)) : get<Place[]>(`/api/places?q=${encodeURIComponent(q)}`);
export const getPlan = (from: Place, to: Place, at?: number) =>
  STATIC
    ? offline().then((m) => m.staticPlan(from, to, at))
    : get<PlanResult>(
    `/api/plan?from=${encodeURIComponent(placeParam(from))}&to=${encodeURIComponent(placeParam(to))}${at ? `&at=${at}` : ''}`,
  );
