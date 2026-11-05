/**
 * Vyhledávání spojení na serveru = společné jádro (shared/transit.ts) + to, co umí jen server:
 * živá zpoždění (IREDO/DPmHK) a tvary tras po silnici.
 */
import {
  distM,
  formatPragueClock,
  nearestStations,
  planJourneys,
  resolvePlaceSpec,
  searchStations,
  type Journey,
  type Place,
  type VehicleKind,
} from '../../shared/transit.js';
import { getStops } from './catalog.js';
import { live } from './collector.js';
import { getDepartures } from './departures.js';
import { waitForTimetable } from './gtfs/timetable.js';
import { legShape } from './shapes.js';

export type { Journey, Leg, Place, RideLeg, WalkLeg } from '../../shared/transit.js';

export async function searchPlaces(q: string, limit = 10): Promise<Place[]> {
  const tt = await waitForTimetable();
  return tt ? searchStations(tt, q, limit) : [];
}

export async function nearestPlaces(lat: number, lon: number, limit = 5) {
  const tt = await waitForTimetable();
  return tt ? nearestStations(tt, lat, lon, limit) : [];
}

export async function resolvePlace(spec: string): Promise<Place | null> {
  const tt = await waitForTimetable();
  return tt ? resolvePlaceSpec(tt, spec) : null;
}

export async function plan(from: Place, to: Place, at = Date.now()): Promise<Journey[]> {
  const tt = await waitForTimetable();
  if (!tt) throw new Error('Jízdní řády se ještě načítají, zkus to za chvíli');
  const out = planJourneys(tt, from, to, at);
  await Promise.all([addLive(out), addShapes(out)]);
  return out;
}

// ---------------------------------------------------------------- živá data

const LIVE_WINDOW_MS = 2 * 3_600_000;

async function addLive(journeys: Journey[]): Promise<void> {
  const now = Date.now();
  const vehicles = new Map([...live.vehicles.iredo, ...live.vehicles.dpmhk].map((v) => [v.tripKey, v]));
  const tasks: Promise<void>[] = [];
  for (const j of journeys) {
    for (const leg of j.legs) {
      if (leg.type !== 'ride' || leg.dep - now > LIVE_WINDOW_MS || leg.arr < now - 60_000) continue;
      tasks.push(
        (async () => {
          let delaySec: number | null = null;
          // Odjezdová tabule nástupní zastávky – zná zpoždění i u spojů, které ještě nevyjely,
          // a u MHD je to jediný způsob, jak spoj spárovat s živým vozem.
          const near = nearestCatalogStop(leg.from.lat, leg.from.lon, leg.kind);
          if (near) {
            try {
              const deps = await getDepartures(near);
              const hhmm = formatPragueClock(leg.dep);
              const m = deps.departures.find(
                (d) => (leg.tripKey && d.tripKey === leg.tripKey) || (d.line === leg.line && d.plannedTime === hhmm),
              );
              if (m) {
                leg.tripKey ??= m.tripKey;
                delaySec = m.delaySec;
              }
            } catch {
              /* tabule nedostupná – zkusíme aspoň živé vozidlo */
            }
          }
          const v = leg.tripKey ? vehicles.get(leg.tripKey) : undefined;
          if (v && v.delaySec != null) delaySec = v.delaySec;
          if (v || delaySec != null) leg.live = { delaySec, onMap: !!v, lat: v?.lat, lon: v?.lon };
        })(),
      );
    }
  }
  await Promise.allSettled(tasks);
}

function nearestCatalogStop(lat: number, lon: number, kind: VehicleKind): string | null {
  const prefix = kind === 'mhd' ? 'dpmhk:' : 'iredo:';
  return (
    getStops()
      .map((s) => ({ s, d: distM(lat, lon, s.lat, s.lon) }))
      .filter((x) => x.d <= 150 && x.s.id.startsWith(prefix))
      .sort((a, b) => a.d - b.d)[0]?.s.id ?? null
  );
}

// ---------------------------------------------------------------- tvary tras

const SHAPES_TIMEOUT_MS = 4000;

/** Doplní tvary tras; co se nestihne, zůstane rovně (a příště už bude v cache). */
async function addShapes(journeys: Journey[]): Promise<void> {
  const tasks = journeys.flatMap((j) =>
    j.legs.flatMap((l) =>
      l.type === 'ride'
        ? [legShape({ kind: l.kind, line: l.line, tripKey: l.tripKey, stops: l.stops }).then((sh) => sh && (l.shape = sh))]
        : [],
    ),
  );
  await Promise.race([Promise.allSettled(tasks), new Promise((r) => setTimeout(r, SHAPES_TIMEOUT_MS))]);
}
