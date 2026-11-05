/**
 * Tvar trasy pro úseky nalezených spojení. GTFS ze spojenky tvary (shapes.txt) nemá,
 * takže bez tohohle by se kreslily rovné čáry mezi zastávkami (přes budovy).
 * - IREDO bus/vlak: tvar celé jízdy z `oredo/detail` podle čísla spoje,
 * - MHD: tvary tras linky z DPmHK; vybere se trasa, která vede přes zastávky úseku.
 * Z celé trasy se vyřízne jen kus mezi nástupem a výstupem.
 */
import { distM } from './gtfs/timetable.js';
import { getLines, getRouteShape } from './sources/dpmhk.js';
import { fetchIredoGeometry } from './sources/iredo.js';

type Pt = [number, number];
interface StopPt {
  lat: number;
  lon: number;
}

/** Zastávka smí být od trasy nejvýš takhle daleko, jinak tvar nepoužijeme. */
const MAX_STOP_OFFSET_M = 120;
const CACHE_MS = 6 * 3_600_000;

const iredoCache = new Map<string, { at: number; shape: Promise<Pt[]> }>();

function iredoShape(id: string): Promise<Pt[]> {
  const hit = iredoCache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.shape;
  const shape = fetchIredoGeometry(id);
  iredoCache.set(id, { at: Date.now(), shape });
  shape.catch(() => iredoCache.delete(id));
  if (iredoCache.size > 300) iredoCache.delete(iredoCache.keys().next().value!);
  return shape;
}

/**
 * Bod trasy u zastávky, hledaný od `start` dál. Bere PRVNÍ průjezd kolem zastávky
 * (okružní linky jedou kolem stejného místa dvakrát), v něm nejbližší bod.
 */
function nearestIdx(shape: Pt[], p: StopPt, start = 0): { idx: number; d: number } {
  const dist = (i: number) => distM(p.lat, p.lon, shape[i][0], shape[i][1]);
  for (let i = start; i < shape.length; i++) {
    if (dist(i) > MAX_STOP_OFFSET_M) continue;
    // první bod v dosahu → dojít k místnímu minimu
    let idx = i;
    let d = dist(i);
    for (let j = i + 1; j < shape.length; j++) {
      const dj = dist(j);
      if (dj > MAX_STOP_OFFSET_M) break;
      if (dj < d) {
        d = dj;
        idx = j;
      }
    }
    return { idx, d };
  }
  return { idx: -1, d: Infinity };
}

/**
 * Vyřízne z trasy úsek přes zastávky `stops` (v pořadí jízdy). Postupuje po trase dopředu,
 * takže zvládne i okružní linky, které jedou kolem stejného místa dvakrát.
 * Vrací null, když zastávky na trase neleží.
 */
function cut(shape: Pt[], stops: StopPt[]): { pts: Pt[]; worst: number } | null {
  if (shape.length < 2 || stops.length < 2) return null;
  let pos = 0;
  let first = -1;
  let worst = 0;
  for (const s of stops) {
    const { idx, d } = nearestIdx(shape, s, pos);
    if (idx < 0) return null;
    worst = Math.max(worst, d);
    if (first < 0) first = idx;
    pos = idx;
  }
  if (worst > MAX_STOP_OFFSET_M || pos <= first) return null;
  const a = stops[0];
  const b = stops[stops.length - 1];
  return { pts: [[a.lat, a.lon], ...shape.slice(first, pos + 1), [b.lat, b.lon]], worst };
}

async function mhdShape(line: string, stops: StopPt[]): Promise<Pt[] | null> {
  const dpLine = (await getLines()).get(line);
  if (!dpLine) return null;
  let best: { pts: Pt[]; worst: number } | null = null;
  // Trasy linky postupně (a z cache) – na neoficiální API se neptáme hromadně.
  for (const r of dpLine.routes) {
    const shape = await getRouteShape(dpLine.id, r.id).catch(() => [] as Pt[]);
    const c = cut(shape, stops);
    if (c && (!best || c.worst < best.worst)) best = c;
  }
  return best?.pts ?? null;
}

export interface ShapeRequest {
  kind: 'bus' | 'mhd' | 'train';
  line: string;
  tripKey?: string;
  stops: StopPt[];
}

/** Tvar úseku po silnici/kolejích, nebo null (pak se kreslí rovně mezi zastávkami). */
export async function legShape(req: ShapeRequest): Promise<Pt[] | null> {
  try {
    if (req.kind === 'mhd') return await mhdShape(req.line, req.stops);
    if (req.tripKey?.startsWith('iredo:')) {
      const shape = await iredoShape(req.tripKey.slice(6));
      return cut(shape, req.stops)?.pts ?? null;
    }
  } catch {
    /* tvar je jen pro krásu – bez něj to funguje taky */
  }
  return null;
}
