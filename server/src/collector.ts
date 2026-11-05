import { POLL_MS, POSITION_SAMPLE_MS } from './config.js';
import { pruneOldPositions, recordBikes, recordVehicles } from './db.js';
import { fetchDpmhk } from './sources/dpmhk.js';
import { fetchIredo } from './sources/iredo.js';
import { fetchNextbike } from './sources/nextbike.js';
import type { BikePlace, SourceId, SourceStatus, Vehicle } from './types.js';

/** Aktuální živý stav v paměti – z něj čte API. */
export const live = {
  vehicles: { iredo: [] as Vehicle[], dpmhk: [] as Vehicle[] },
  bikes: [] as BikePlace[],
  status: {} as Record<SourceId, SourceStatus>,
};

function poll<T>(source: SourceId, intervalMs: number, fetcher: () => Promise<T[]>, onData: (items: T[]) => void) {
  live.status[source] = { ok: false, lastSuccess: null, lastError: null, lastErrorAt: null, itemCount: 0 };
  let failures = 0;

  const tick = async () => {
    const st = live.status[source];
    try {
      const items = await fetcher();
      onData(items);
      Object.assign(st, { ok: true, lastSuccess: Date.now(), itemCount: items.length });
      failures = 0;
    } catch (e) {
      failures++;
      Object.assign(st, { ok: false, lastError: e instanceof Error ? e.message : String(e), lastErrorAt: Date.now() });
      console.warn(`[${source}] chyba (${failures}×): ${st.lastError}`);
    }
    // Při opakovaných chybách zpomalit (max. 5 min), ať zdroj zbytečně nezatěžujeme.
    const delay = Math.min(intervalMs * 2 ** Math.min(failures, 5), 5 * 60_000);
    setTimeout(tick, delay);
  };
  void tick();
}

export function startCollector(): void {
  poll('iredo', POLL_MS.iredo, fetchIredo, (v) => {
    live.vehicles.iredo = v;
    recordVehicles(v, POSITION_SAMPLE_MS);
  });
  poll('dpmhk', POLL_MS.dpmhk, fetchDpmhk, (v) => {
    live.vehicles.dpmhk = v;
    recordVehicles(v, POSITION_SAMPLE_MS);
  });
  poll('nextbike', POLL_MS.nextbike, fetchNextbike, (b) => {
    live.bikes = b;
    recordBikes(b);
  });
  setInterval(pruneOldPositions, 3_600_000);
}
