/**
 * Jádro jízdních řádů a vyhledávání spojení OZIDOS – běží stejně na serveru i v prohlížeči
 * (GitHub Pages bez serveru). Žádné závislosti na Node ani DOM.
 *
 * Data: `area.json` = celostátní GTFS ořezané na oblast (viz server/src/gtfs/import.ts).
 * Algoritmus: CSA (Connection Scan) – projde spojení podle odjezdu a hledá nejdřívější příjezd;
 * další možnosti = stejné hledání s pozdějším odjezdem.
 */

export type VehicleKind = 'train' | 'bus' | 'mhd';

// ---------------------------------------------------------------- data (area.json)

/** Nástupiště (stop_times odkazují na něj). `station` = id nadřazené zastávky. */
export interface GtfsStop {
  id: string;
  name: string;
  lat: number;
  lon: number;
  station: string;
  platform?: string;
}

export interface GtfsRoute {
  /** Číslo linky pro cestující („17“, „115“). */
  line: string;
  kind: VehicleKind;
  /** Číslo linky v CIS JŘ (např. 661115) – pro párování s živými spoji IREDO. */
  cisLine?: number;
  agency: string;
}

export interface GtfsTrip {
  id: string;
  route: string;
  service: string;
  headsign?: string;
  /** U vlaků např. „Os 5180“. */
  shortName?: string;
  /** Číslo spoje v CIS JŘ (IREDO: linka 661115 + spoj 12 = živý „S-661115-12“). */
  cisTrip?: number;
  /** Indexy do `stops`, jen zastávky v oblasti, v pořadí jízdy. */
  stops: number[];
  /** Sekundy od půlnoci provozního dne (mohou být > 24 h). */
  arr: number[];
  dep: number[];
  /** Bit 1 = nelze nastoupit, bit 2 = nelze vystoupit. Chybí = vše povoleno. */
  flags?: number[];
}

export interface GtfsService {
  /** Po–Ne */
  days: boolean[];
  from: string; // YYYYMMDD
  to: string;
  add: string[];
  remove: string[];
}

export interface AreaTimetable {
  builtAt: number;
  feedTime: number;
  stops: GtfsStop[];
  /** id stanice → název */
  stations: Record<string, string>;
  routes: Record<string, GtfsRoute>;
  trips: GtfsTrip[];
  services: Record<string, GtfsService>;
}

export interface Footpath {
  to: number;
  sec: number;
}

export interface Timetable extends AreaTimetable {
  /** Pro každé nástupiště pěší přestupy na okolní (včetně jiných nástupišť téže zastávky). */
  footpaths: Footpath[][];
}

// ---------------------------------------------------------------- výsledky

export interface Place {
  name: string;
  lat: number;
  lon: number;
  /** „station:SC27580“ pro zastávku */
  id?: string;
}

export interface PlanStop {
  name: string;
  lat: number;
  lon: number;
  platform?: string;
  /** plánovaný čas (epoch ms) */
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
  /** všechny zastávky úseku včetně nástupní a výstupní */
  stops: PlanStop[];
  dep: number;
  arr: number;
  /** Klíč živého spoje (stejný jako u vozidel na mapě), pokud ho známe. */
  tripKey?: string;
  /** Tvar úseku po silnici/kolejích [lat, lon]; chybí = kreslit rovně mezi zastávkami. */
  shape?: [number, number][];
  live?: {
    delaySec: number | null;
    /** vozidlo právě jede a je na mapě */
    onMap: boolean;
    lat?: number;
    lon?: number;
  };
}

export type Leg = WalkLeg | RideLeg;

export interface Journey {
  dep: number;
  arr: number;
  transfers: number;
  walkMeters: number;
  legs: Leg[];
}

// ---------------------------------------------------------------- čas (Praha)

const TIMEZONE = 'Europe/Prague';
const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE });
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'longOffset' });
const clockFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

/** Provozní den v Praze jako YYYY-MM-DD. */
export function pragueDate(ms = Date.now()): string {
  return dateFmt.format(ms);
}

/** Posun pražského času vůči UTC v ms (zohledňuje letní čas). */
export function pragueOffsetMs(ms = Date.now()): number {
  const name = offsetFmt.formatToParts(ms).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT';
  const m = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
  if (!m) return 0;
  const sign = m[1] === '-' ? -1 : 1;
  return sign * (Number(m[2]) * 60 + Number(m[3])) * 60_000;
}

/** Místní pražský čas zapsaný s „Z“ (např. „2026-11-05T17:14:00Z“) → skutečný epoch. */
export function parseShiftedUtc(s: string): number {
  const asUtc = Date.parse(s);
  return asUtc - pragueOffsetMs(asUtc);
}

/** Epoch ms → „HH:MM“ v pražském čase. */
export function formatPragueClock(ms: number): string {
  return clockFmt.format(ms);
}

function addDays(date: string, n: number): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Sekundy od půlnoci dne `date` (pražský čas) → epoch ms. Zvládne i časy po půlnoci (> 24 h). */
export function toEpoch(date: string, sec: number): number {
  const days = Math.floor(sec / 86_400);
  const s = sec - days * 86_400;
  const day = addDays(date, days);
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor(s / 60) % 60).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return parseShiftedUtc(`${day}T${hh}:${mm}:${ss}Z`);
}

export function secOfDay(ms: number): number {
  const local = new Date(ms + pragueOffsetMs(ms));
  return local.getUTCHours() * 3600 + local.getUTCMinutes() * 60 + local.getUTCSeconds();
}

// ---------------------------------------------------------------- vzdálenosti a chůze

/** Chůze: 4,5 km/h, vzdušná vzdálenost × 1,25 (ulice nejsou rovné). */
export const WALK_SPEED = 1.25;
export const WALK_DETOUR = 1.25;
/** Nejdelší pěší přestup mezi zastávkami. */
const MAX_TRANSFER_M = 450;

export function distM(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const r = Math.PI / 180;
  const x = (bLon - aLon) * r * Math.cos(((aLat + bLat) / 2) * r);
  const y = (bLat - aLat) * r;
  return 6_371_000 * Math.hypot(x, y);
}

export function walkSec(m: number): number {
  return Math.round((m * WALK_DETOUR) / WALK_SPEED);
}

/** Z načteného area.json připraví jízdní řád k hledání (pěší přestupy mezi nástupišti). */
export function prepareTimetable(area: AreaTimetable): Timetable {
  const footpaths: Footpath[][] = area.stops.map(() => []);
  for (let i = 0; i < area.stops.length; i++) {
    const a = area.stops[i];
    for (let j = i + 1; j < area.stops.length; j++) {
      const b = area.stops[j];
      const d = distM(a.lat, a.lon, b.lat, b.lon);
      if (d > MAX_TRANSFER_M && a.station !== b.station) continue;
      // I na stejné zastávce počítáme aspoň minutu na přejití.
      const sec = Math.max(60, walkSec(d));
      footpaths[i].push({ to: j, sec });
      footpaths[j].push({ to: i, sec });
    }
  }
  return { ...area, footpaths };
}

// ---------------------------------------------------------------- spoje v daný den

function runsOn(s: GtfsService, date: string): boolean {
  const d = date.replaceAll('-', '');
  if (s.remove.includes(d)) return false;
  if (s.add.includes(d)) return true;
  if (d < s.from || d > s.to) return false;
  const [y, m, dd] = date.split('-').map(Number);
  const dow = (new Date(Date.UTC(y, m - 1, dd)).getUTCDay() + 6) % 7; // Po = 0
  return s.days[dow];
}

/** Jedno „spojení“ mezi dvěma po sobě jdoucími zastávkami jedné jízdy (pro CSA). */
export interface Connection {
  trip: number;
  /** pořadí v jízdě (index do trip.stops) */
  idx: number;
  from: number;
  to: number;
  /** sekundy od půlnoci dne dotazu */
  dep: number;
  arr: number;
}

const connCaches = new WeakMap<Timetable, Map<string, Connection[]>>();

/**
 * Všechna spojení platná v den `date` (YYYY-MM-DD), seřazená podle odjezdu.
 * Zahrnuje i noční jízdy předchozího dne, které jedou po půlnoci (časy > 24 h).
 */
export function connectionsFor(tt: Timetable, date: string): Connection[] {
  let cache = connCaches.get(tt);
  if (!cache) connCaches.set(tt, (cache = new Map()));
  const hit = cache.get(date);
  if (hit) return hit;
  const today = new Set<string>();
  const yesterday = new Set<string>();
  const prev = addDays(date, -1);
  for (const [id, s] of Object.entries(tt.services)) {
    if (runsOn(s, date)) today.add(id);
    if (runsOn(s, prev)) yesterday.add(id);
  }
  const out: Connection[] = [];
  tt.trips.forEach((t, ti) => {
    const shifts: number[] = [];
    if (today.has(t.service)) shifts.push(0);
    if (yesterday.has(t.service) && t.dep[t.dep.length - 1] >= 86_400) shifts.push(-86_400);
    for (const shift of shifts) {
      for (let i = 0; i < t.stops.length - 1; i++) {
        const dep = t.dep[i] + shift;
        if (dep < 0) continue;
        out.push({ trip: ti, idx: i, from: t.stops[i], to: t.stops[i + 1], dep, arr: t.arr[i + 1] + shift });
      }
    }
  });
  out.sort((a, b) => a.dep - b.dep || a.arr - b.arr);
  cache.set(date, out);
  if (cache.size > 3) cache.delete(cache.keys().next().value!);
  return out;
}

// ---------------------------------------------------------------- místa

export function stationCoords(tt: Timetable, stationId: string): { lat: number; lon: number } | null {
  const ps = tt.stops.filter((s) => s.station === stationId);
  if (!ps.length) return null;
  return { lat: ps.reduce((a, s) => a + s.lat, 0) / ps.length, lon: ps.reduce((a, s) => a + s.lon, 0) / ps.length };
}

function norm(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Krátký název bez „Hradec Králové, “ – ten je v oblasti u skoro všeho. */
export function shortStopName(name: string): string {
  return name.replace(/^Hradec Králové,\s*/, '');
}

/** Hledání zastávek podle názvu (bez diakritiky, na pořadí slov nezáleží). */
export function searchStations(tt: Timetable, q: string, limit = 10): Place[] {
  const words = norm(q).split(' ').filter(Boolean);
  if (!words.length) return [];
  const out: (Place & { score: number })[] = [];
  for (const [id, name] of Object.entries(tt.stations)) {
    const n = norm(name);
    if (!words.every((w) => n.includes(w))) continue;
    const c = stationCoords(tt, id);
    if (!c) continue;
    const short = norm(shortStopName(name));
    // přednost: začíná hledaným textem, pak kratší názvy
    const score = (short.startsWith(words[0]) ? 0 : n.startsWith(words[0]) ? 1 : 2) * 1000 + name.length;
    out.push({ id: `station:${id}`, name, ...c, score });
  }
  return out
    .sort((a, b) => a.score - b.score)
    .slice(0, limit)
    .map(({ score: _, ...p }) => p);
}

/** Nejbližší zastávky k bodu. */
export function nearestStations(tt: Timetable, lat: number, lon: number, limit = 5): (Place & { meters: number })[] {
  return Object.keys(tt.stations)
    .map((id) => {
      const c = stationCoords(tt, id)!;
      return { id: `station:${id}`, name: tt.stations[id], ...c, meters: Math.round(distM(lat, lon, c.lat, c.lon)) };
    })
    .sort((a, b) => a.meters - b.meters)
    .slice(0, limit);
}

/** „station:SC27580“ nebo „lat,lon[,název]“ → místo. */
export function resolvePlaceSpec(tt: Timetable, spec: string): Place | null {
  if (spec.startsWith('station:')) {
    const id = spec.slice(8);
    const c = stationCoords(tt, id);
    return c && tt.stations[id] ? { id: spec, name: tt.stations[id], ...c } : null;
  }
  const m = /^(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)(?:,(.*))?$/.exec(spec);
  if (!m) return null;
  return { lat: Number(m[1]), lon: Number(m[2]), name: m[3] ? decodeURIComponent(m[3]) : 'Vybrané místo' };
}

/** Zastávky (stanice) v oblasti pro mapu – druh podle toho, co z nich jezdí (MHD > bus > vlak). */
export function stationList(tt: Timetable): { id: string; name: string; lat: number; lon: number; kind: VehicleKind }[] {
  const kinds = new Map<string, Set<VehicleKind>>();
  for (const t of tt.trips) {
    const k = tt.routes[t.route]?.kind;
    if (!k) continue;
    for (const si of t.stops) {
      const st = tt.stops[si].station;
      let set = kinds.get(st);
      if (!set) kinds.set(st, (set = new Set()));
      set.add(k);
    }
  }
  return Object.keys(tt.stations).flatMap((id) => {
    const c = stationCoords(tt, id);
    const set = kinds.get(id);
    if (!c || !set) return [];
    const kind: VehicleKind = set.has('mhd') ? 'mhd' : set.has('bus') ? 'bus' : 'train';
    return [{ id: `station:${id}`, name: tt.stations[id], ...c, kind }];
  });
}

// ---------------------------------------------------------------- odjezdy podle jízdního řádu

export interface TimetableDeparture {
  tripKey?: string;
  kind: VehicleKind;
  line: string;
  to?: string;
  plannedTime: string;
  expectedAt: number;
  delaySec: number | null;
  platform?: string;
  live: boolean;
}

/** Odjezdy ze zastávky (a zastávek do 150 m) podle jízdního řádu – dnes a zítra. */
export function timetableDepartures(tt: Timetable, stationId: string, at = Date.now(), limit = 30): TimetableDeparture[] {
  const c = stationCoords(tt, stationId);
  if (!c) return [];
  const platforms = new Set<number>();
  tt.stops.forEach((s, i) => {
    if (s.station === stationId || distM(c.lat, c.lon, s.lat, s.lon) <= 150) platforms.add(i);
  });
  const out: TimetableDeparture[] = [];
  const today = pragueDate(at);
  for (const date of [today, addDays(today, 1)]) {
    for (const cn of connectionsFor(tt, date)) {
      if (!platforms.has(cn.from)) continue;
      const when = toEpoch(date, cn.dep);
      if (when < at - 60_000) continue;
      const trip = tt.trips[cn.trip];
      if (trip.flags && trip.flags[cn.idx] & 1) continue;
      const route = tt.routes[trip.route];
      out.push({
        tripKey: iredoTripKey(route.kind, route.cisLine, trip.cisTrip, trip.shortName),
        kind: route.kind,
        line: route.kind === 'train' && trip.shortName ? trip.shortName : route.line,
        to: trip.headsign,
        plannedTime: formatPragueClock(when),
        expectedAt: when,
        delaySec: null,
        platform: tt.stops[cn.from].platform,
        live: false,
      });
    }
    if (out.length >= limit) break;
  }
  return out.sort((a, b) => a.expectedAt - b.expectedAt).slice(0, limit);
}

/** Klíč živého spoje IREDO z čísel CIS JŘ (bus: „S-661115-12“, vlak: „K-5180“). */
export function iredoTripKey(kind: VehicleKind, cisLine?: number, cisTrip?: number, shortName?: string): string | undefined {
  if (kind === 'bus' && cisLine && cisTrip) return `iredo:S-${cisLine}-${cisTrip}`;
  if (kind === 'train' && shortName) {
    const num = /(\d+)\s*$/.exec(shortName)?.[1];
    return num ? `iredo:K-${num}` : undefined;
  }
  return undefined; // MHD se páruje jinak (odjezdová tabule DPmHK)
}

// ---------------------------------------------------------------- CSA

/** Jak daleko k zastávce/od zastávky jsme ochotni jít pěšky. */
const MAX_ACCESS_M = 1200;
/** …a když se nic nenajde, zkusit delší chůzi. */
const MAX_ACCESS_FALLBACK_M = 2500;
/** Čas na přestup na stejném nástupišti. */
const MIN_TRANSFER_S = 60;
/** Jak dlouho dopředu hledat. */
const HORIZON_S = 5 * 3600;
const MAX_RESULTS = 5;
/** Kratší cestu radši ujít, než čekat na bus. */
const WALK_ONLY_MAX_S = 30 * 60;

type Ptr =
  | { t: 'access'; sec: number; meters: number }
  | { t: 'walk'; from: number; sec: number }
  | { t: 'ride'; enter: number; exit: number };

interface Access {
  stop: number;
  sec: number;
  meters: number;
}

function accessStops(tt: Timetable, p: Place, maxM: number): Access[] {
  const out: Access[] = [];
  const stationId = p.id?.startsWith('station:') ? p.id.slice(8) : null;
  tt.stops.forEach((s, i) => {
    const m = distM(p.lat, p.lon, s.lat, s.lon);
    if (s.station === stationId) out.push({ stop: i, sec: 0, meters: 0 });
    else if (m <= maxM) out.push({ stop: i, sec: walkSec(m), meters: Math.round(m * WALK_DETOUR) });
  });
  return out;
}

interface RawJourney {
  date: string;
  legs: (
    | { t: 'walk'; from: number | 'origin'; to: number | 'dest'; dep: number; arr: number; meters: number }
    | { t: 'ride'; enter: number; exit: number }
  )[];
}

function scan(tt: Timetable, date: string, t0: number, origin: Access[], dest: Access[], horizon = HORIZON_S): RawJourney | null {
  const conns = connectionsFor(tt, date);
  const n = tt.stops.length;
  const ready = new Float64Array(n).fill(Infinity); // kdy můžu na nástupišti nastoupit
  const arrAt = new Float64Array(n).fill(Infinity); // kdy tam skutečně jsem
  const ptr: (Ptr | undefined)[] = new Array(n);
  const tripEnter = new Map<number, number>();
  const destWalk = new Map(dest.map((d) => [d.stop, d]));

  for (const a of origin) {
    const t = t0 + a.sec;
    if (t < ready[a.stop]) {
      ready[a.stop] = arrAt[a.stop] = t;
      ptr[a.stop] = { t: 'access', sec: a.sec, meters: a.meters };
    }
  }

  const bestDest = () => {
    let best = Infinity;
    let stop = -1;
    for (const d of dest) {
      const t = arrAt[d.stop] + d.sec;
      if (t < best) {
        best = t;
        stop = d.stop;
      }
    }
    return { best, stop };
  };

  // binární hledání prvního spojení s odjezdem >= t0
  let lo = 0;
  let hi = conns.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (conns[mid].dep < t0) lo = mid + 1;
    else hi = mid;
  }

  let best = bestDest().best;
  for (let ci = lo; ci < conns.length; ci++) {
    const c = conns[ci];
    if (c.dep > t0 + horizon || c.dep >= best) break;
    const trip = tt.trips[c.trip];
    const flags = trip.flags;
    let entered = tripEnter.has(c.trip);
    if (!entered && ready[c.from] <= c.dep && !(flags && flags[c.idx] & 1)) {
      tripEnter.set(c.trip, ci);
      entered = true;
    }
    if (!entered) continue;
    if (flags && flags[c.idx + 1] & 2) continue; // tady se vystoupit nedá
    if (c.arr < arrAt[c.to]) {
      arrAt[c.to] = c.arr;
      ready[c.to] = Math.min(ready[c.to], c.arr + MIN_TRANSFER_S);
      ptr[c.to] = { t: 'ride', enter: tripEnter.get(c.trip)!, exit: ci };
      for (const f of tt.footpaths[c.to]) {
        const t = c.arr + f.sec;
        if (t < arrAt[f.to]) {
          arrAt[f.to] = ready[f.to] = t;
          ptr[f.to] = { t: 'walk', from: c.to, sec: f.sec };
        }
      }
      if (destWalk.has(c.to) || tt.footpaths[c.to].some((f) => destWalk.has(f.to))) best = bestDest().best;
    }
  }

  const { best: arrival, stop } = bestDest();
  if (!Number.isFinite(arrival) || stop < 0) return null;

  // zpětné složení cesty
  const legs: RawJourney['legs'] = [];
  const d = destWalk.get(stop)!;
  if (d.sec > 0) legs.push({ t: 'walk', from: stop, to: 'dest', dep: arrAt[stop], arr: arrAt[stop] + d.sec, meters: d.meters });
  let p = stop;
  for (let guard = 0; guard < 50; guard++) {
    const q = ptr[p];
    if (!q) return null;
    if (q.t === 'access') {
      if (q.sec > 0) legs.unshift({ t: 'walk', from: 'origin', to: p, dep: arrAt[p] - q.sec, arr: arrAt[p], meters: q.meters });
      break;
    }
    if (q.t === 'walk') {
      const fromStop = tt.stops[q.from];
      const toStop = tt.stops[p];
      legs.unshift({
        t: 'walk',
        from: q.from,
        to: p,
        dep: arrAt[p] - q.sec,
        arr: arrAt[p],
        meters: Math.round(distM(fromStop.lat, fromStop.lon, toStop.lat, toStop.lon) * WALK_DETOUR),
      });
      p = q.from;
    } else {
      legs.unshift({ t: 'ride', enter: q.enter, exit: q.exit });
      p = conns[q.enter].from;
    }
  }
  if (!legs.some((l) => l.t === 'ride')) return null;
  return { date, legs };
}

function placeOfStop(s: GtfsStop): Place {
  return { name: s.name, lat: s.lat, lon: s.lon, id: `station:${s.station}` };
}

function materialize(tt: Timetable, raw: RawJourney, from: Place, to: Place): Journey {
  const conns = connectionsFor(tt, raw.date);
  const legs: Leg[] = raw.legs.map((l): Leg => {
    if (l.t === 'walk') {
      return {
        type: 'walk',
        from: l.from === 'origin' ? from : placeOfStop(tt.stops[l.from as number]),
        to: l.to === 'dest' ? to : placeOfStop(tt.stops[l.to as number]),
        dep: toEpoch(raw.date, l.dep),
        arr: toEpoch(raw.date, l.arr),
        meters: l.meters,
      };
    }
    const enter = conns[l.enter];
    const exit = conns[l.exit];
    const trip = tt.trips[enter.trip];
    const route = tt.routes[trip.route];
    const shift = enter.dep - trip.dep[enter.idx]; // 0 nebo −1 den u nočních
    const stops: PlanStop[] = [];
    for (let i = enter.idx; i <= exit.idx + 1; i++) {
      const s = tt.stops[trip.stops[i]];
      const t = i === enter.idx ? trip.dep[i] : trip.arr[i];
      stops.push({ name: s.name, lat: s.lat, lon: s.lon, platform: s.platform, time: toEpoch(raw.date, t + shift) });
    }
    return {
      type: 'ride',
      kind: route.kind,
      line: route.kind === 'train' && trip.shortName ? trip.shortName : route.line,
      headsign: trip.headsign,
      from: stops[0],
      to: stops[stops.length - 1],
      stops,
      dep: stops[0].time,
      arr: stops[stops.length - 1].time,
      tripKey: iredoTripKey(route.kind, route.cisLine, trip.cisTrip, trip.shortName),
    };
  });
  // Úvodní chůzi posunout tak, aby se odcházelo „na poslední chvíli“, ne v čase hledání.
  const firstRide = legs.find((l): l is RideLeg => l.type === 'ride')!;
  const firstIdx = legs.indexOf(firstRide);
  if (firstIdx > 0) {
    let t = firstRide.dep;
    for (let i = firstIdx - 1; i >= 0; i--) {
      const w = legs[i] as WalkLeg;
      const dur = w.arr - w.dep;
      w.arr = t;
      w.dep = t - dur;
      t = w.dep;
    }
  }
  return {
    dep: legs[0].dep,
    arr: legs[legs.length - 1].arr,
    transfers: legs.filter((l) => l.type === 'ride').length - 1,
    walkMeters: legs.reduce((a, l) => a + (l.type === 'walk' ? l.meters : 0), 0),
    legs,
  };
}

/** j je zbytečné, pokud jiné spojení odjíždí stejně nebo později a dojede stejně nebo dřív (a v něčem je lepší). */
function dominated(j: Journey, k: Journey): boolean {
  if (k === j) return false;
  // k odjíždí nejvýš o 5 min dřív a dojede aspoň o 10 min dřív → j nikdo nechce
  if (k.dep >= j.dep - 5 * 60_000 && k.arr <= j.arr - 10 * 60_000) return true;
  if (k.dep < j.dep || k.arr > j.arr) return false;
  return k.dep > j.dep || k.arr < j.arr || k.transfers < j.transfers || k.walkMeters < j.walkMeters;
}

function search(tt: Timetable, from: Place, to: Place, at: number, accessM: number): Journey[] {
  const origin = accessStops(tt, from, accessM);
  const dest = accessStops(tt, to, accessM);
  const found: Journey[] = [];
  const seen = new Set<string>();
  const directSec = walkSec(distM(from.lat, from.lon, to.lat, to.lon));

  let date = pragueDate(at);
  let t0 = secOfDay(at);
  let rolledOver = false;
  for (let i = 0; i < MAX_RESULTS * 3; i++) {
    // po přechodu na další den hledat celý den (ráno, hlavně o víkendu, dlouho nic nejede)
    const raw = scan(tt, date, t0, origin, dest, rolledOver ? 20 * 3600 : HORIZON_S);
    if (!raw) {
      // ten den už nic nejede → jednou přejít na ráno dalšího dne (funguje pro jakýkoli den)
      if (!rolledOver) {
        rolledOver = true;
        date = addDays(date, 1);
        t0 = 3 * 3600;
        continue;
      }
      break;
    }
    const j = materialize(tt, raw, from, to);
    // pěšky by to bylo rychlejší → dál hledat nemá smysl
    if (directSec <= WALK_ONLY_MAX_S && j.arr - j.dep >= directSec * 1000) break;
    const sig = j.legs.map((l) => (l.type === 'ride' ? `${l.line}@${l.dep}` : 'w')).join('|');
    if (!seen.has(sig)) {
      seen.add(sig);
      found.push(j);
    }
    if (found.filter((x) => !found.some((k) => dominated(x, k))).length >= MAX_RESULTS) break;
    // další hledání: první vozidlo musí odjet později
    const firstRide = j.legs.find((l): l is RideLeg => l.type === 'ride')!;
    const firstWalk = j.legs[0].type === 'walk' ? j.legs[0].arr - j.legs[0].dep : 0;
    const next = firstRide.dep - firstWalk + 60_000;
    date = pragueDate(next);
    t0 = secOfDay(next);
  }
  if (!found.length) return [];
  // Zbytečně dlouhé objížďky s přestupy (např. 75 min místo 25) vyhodit.
  const minDur = Math.min(...found.map((j) => j.arr - j.dep));
  const sensible = (j: Journey) => {
    const dur = j.arr - j.dep;
    return j.transfers === 0 || dur <= minDur * 1.8 || dur - minDur <= 25 * 60_000;
  };
  return found
    .filter((j) => sensible(j) && !found.some((k) => dominated(j, k)))
    .sort((a, b) => a.arr - b.arr || b.dep - a.dep)
    .slice(0, MAX_RESULTS);
}

/** Vyhledá spojení (bez živých dat). Kratší cestu nabídne i pěšky. */
export function planJourneys(tt: Timetable, from: Place, to: Place, at = Date.now()): Journey[] {
  // Nejdřív s rozumnou chůzí; teprve když nic, povolit delší.
  let out = search(tt, from, to, at, MAX_ACCESS_M);
  if (!out.length) out = search(tt, from, to, at, MAX_ACCESS_FALLBACK_M);

  const direct = distM(from.lat, from.lon, to.lat, to.lon);
  const directSec = walkSec(direct);
  if (directSec <= WALK_ONLY_MAX_S) {
    const meters = Math.round(direct * WALK_DETOUR);
    out.unshift({
      dep: at,
      arr: at + directSec * 1000,
      transfers: 0,
      walkMeters: meters,
      legs: [{ type: 'walk', from, to, dep: at, arr: at + directSec * 1000, meters }],
    });
  }
  return out;
}
