/**
 * Jízdní řády oblasti v paměti serveru: načtení `area.json` a denní obnova z GTFS.
 * Samotné hledání a výpočty jsou ve společném jádře (shared/transit.ts), které používá i web.
 */
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { prepareTimetable, type AreaTimetable, type Timetable } from '../../../shared/transit.js';
import { buildArea, downloadGtfs } from './import.js';

export { connectionsFor, distM, WALK_DETOUR, walkSec, type Timetable } from '../../../shared/transit.js';

const DIR = fileURLToPath(new URL('../../data/gtfs/', import.meta.url));
export const GTFS_ZIP = `${DIR}jizdnirady-gtfs.zip`;
export const AREA_JSON = `${DIR}area.json`;
/** Nový balík vychází kolem 4:30; kontrolujeme každých 6 h. */
const REFRESH_MS = 6 * 3_600_000;

let current: Timetable | null = null;
let loading: Promise<void> | null = null;

export function getTimetable(): Timetable | null {
  return current;
}

async function loadFromDisk(): Promise<boolean> {
  try {
    const area = JSON.parse(await readFile(AREA_JSON, 'utf8')) as AreaTimetable;
    current = prepareTimetable(area);
    console.log(`[gtfs] načteno ${area.trips.length} jízd (balík z ${new Date(area.feedTime).toLocaleString('cs-CZ')})`);
    return true;
  } catch {
    return false;
  }
}

async function refresh(): Promise<void> {
  try {
    const downloaded = await downloadGtfs(GTFS_ZIP);
    const zipTime = await stat(GTFS_ZIP).then((s) => s.mtimeMs);
    if (downloaded || !current || current.feedTime < zipTime) {
      console.log('[gtfs] zpracovávám nové jízdní řády…');
      current = prepareTimetable(await buildArea(GTFS_ZIP, AREA_JSON));
    }
  } catch (e) {
    console.warn('[gtfs] obnova selhala:', e instanceof Error ? e.message : e);
  }
}

export function startTimetable(): void {
  loading = (async () => {
    await loadFromDisk();
    await refresh();
  })();
  setInterval(() => void refresh(), REFRESH_MS);
}

export async function waitForTimetable(): Promise<Timetable | null> {
  if (loading) await loading.catch(() => {});
  return current;
}
