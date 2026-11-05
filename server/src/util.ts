import { TIMEZONE, USER_AGENT } from './config.js';

const dateFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TIMEZONE });
const offsetFmt = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, timeZoneName: 'longOffset' });

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

/** Některé systémy posílají místní čas s chybným „Z“ na konci. Převede ho na skutečný epoch. */
export function parseShiftedUtc(s: string): number {
  const asUtc = Date.parse(s);
  return asUtc - pragueOffsetMs(asUtc);
}

/** „HH:MM[:SS]“ v pražském čase → epoch ms (nejbližší výskyt, ne v budoucnosti o víc než 1 h). */
export function pragueClockToEpoch(hms: string, now = Date.now()): number | null {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hms);
  if (!m) return null;
  const day = pragueDate(now);
  let t = parseShiftedUtc(`${day}T${m[1].padStart(2, '0')}:${m[2]}:${m[3] ?? '00'}Z`);
  if (t - now > 3_600_000) t -= 86_400_000;
  return t;
}

const clockFmt = new Intl.DateTimeFormat('cs-CZ', { timeZone: TIMEZONE, hour: '2-digit', minute: '2-digit', hour12: false });

/** Epoch ms → „HH:MM“ v pražském čase. */
export function formatPragueClock(ms: number): string {
  return clockFmt.format(ms);
}

export async function fetchJson<T>(url: string, init: RequestInit = {}, timeoutMs = 15_000): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...init.headers },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} (${url})`);
  return (await res.json()) as T;
}

export function inBbox(lat: number, lon: number, b: { w: number; s: number; e: number; n: number }): boolean {
  return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
}
