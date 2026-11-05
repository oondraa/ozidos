import { fileURLToPath } from 'node:url';

// Oblast a Nextbike jsou společné pro server i web.
export { BBOX, NEXTBIKE_CITY_IDS } from '../../shared/area.js';

/** Intervaly dotazů – odpovídají tomu, jak často se ptají oficiální weby, ne častěji. */
export const POLL_MS = {
  iredo: 10_000,
  dpmhk: 10_000,
  nextbike: 60_000,
} as const;

/** Jak často ukládat polohu každého vozidla do historie. */
export const POSITION_SAMPLE_MS = 60_000;
/** Jak dlouho držet detailní historii poloh (souhrny spojů se drží napořád). */
export const POSITION_RETENTION_DAYS = 14;

export const PORT = Number(process.env.PORT ?? 8787);
export const DB_PATH = process.env.DB_PATH ?? fileURLToPath(new URL('../data/ozidos.db', import.meta.url));
export const USER_AGENT = 'OZIDOS/0.1 (osobni mapa spoju)';
export const TIMEZONE = 'Europe/Prague';
