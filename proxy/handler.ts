/**
 * Prostředník pro živé busy na GitHub Pages (Vercel, Node funkce).
 * IREDO a DPmHK nemají CORS, takže je prohlížeč volat nemůže – tahle funkce je zavolá za něj.
 * Používá stejné adaptéry jako lokální server (server/src/sources). Nic neukládá.
 *
 *   GET /api/live            → { now, vehicles, bikes: [], status }
 *   GET /api/trip/:tripKey   → trasa a zastávky spoje (klik na bus)
 *
 * Odpovědi drží CDN Vercelu pár sekund, takže zdroje dostanou nejvýš jeden dotaz za ~8 s,
 * ať je otevřených prohlížečů kolik chce.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fetchDpmhk, fetchDpmhkTrip } from '../server/src/sources/dpmhk.js';
import { fetchIredo, fetchIredoStops, fetchIredoTrip } from '../server/src/sources/iredo.js';
import type { SourceStatus, Stop, Vehicle } from '../server/src/types.js';

/** Odkud se smí volat (web na GitHub Pages + lokální vývoj). */
const ALLOWED_ORIGINS = ['https://oondraa.github.io', 'http://localhost:5173', 'http://127.0.0.1:4187'];

function send(req: IncomingMessage, res: ServerResponse, status: number, body: unknown, cache: string) {
  const origin = req.headers.origin ?? '';
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache);
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.end(JSON.stringify(body));
}

function status(r: PromiseSettledResult<unknown[]>): SourceStatus {
  const now = Date.now();
  return r.status === 'fulfilled'
    ? { ok: true, lastSuccess: now, lastError: null, lastErrorAt: null, itemCount: r.value.length }
    : { ok: false, lastSuccess: null, lastError: String((r.reason as Error)?.message ?? r.reason), lastErrorAt: now, itemCount: 0 };
}

// Katalog zastávek IREDO (souřadnice pro trasu spoje) – drží se, dokud funkce „žije“.
let iredoStops: { at: number; byId: Map<string, Stop> } | null = null;
async function iredoStop(id: string): Promise<Stop | undefined> {
  if (!iredoStops || Date.now() - iredoStops.at > 24 * 3_600_000) {
    const list = await fetchIredoStops().catch(() => [] as Stop[]);
    iredoStops = { at: Date.now(), byId: new Map(list.map((s) => [s.id, s])) };
  }
  return iredoStops.byId.get(id);
}

async function live() {
  const [iredo, dpmhk] = await Promise.allSettled([fetchIredo(), fetchDpmhk()]);
  const vehicles: Vehicle[] = [
    ...(iredo.status === 'fulfilled' ? iredo.value : []),
    ...(dpmhk.status === 'fulfilled' ? dpmhk.value : []),
  ];
  return { now: Date.now(), vehicles, bikes: [], status: { iredo: status(iredo), dpmhk: status(dpmhk) } };
}

async function trip(tripKey: string) {
  if (tripKey.startsWith('dpmhk:')) {
    // detail MHD potřebuje údaje z aktuálního seznamu vozů (trasa, OBU)
    await fetchDpmhk();
    return fetchDpmhkTrip(tripKey);
  }
  if (tripKey.startsWith('iredo:')) {
    await iredoStop(''); // načíst katalog
    return fetchIredoTrip(tripKey, (id) => iredoStops?.byId.get(id));
  }
  return null;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', 'http://x');
  try {
    if (url.pathname === '/api/live') {
      return send(req, res, 200, await live(), 'public, s-maxage=8, stale-while-revalidate=4');
    }
    const m = /^\/api\/trip\/(.+)$/.exec(url.pathname);
    if (m) {
      const t = await trip(decodeURIComponent(m[1]));
      return t
        ? send(req, res, 200, t, 'public, s-maxage=20')
        : send(req, res, 404, { error: 'Spoj nenalezen (možná už dojel)' }, 'no-store');
    }
    return send(req, res, 404, { error: 'Neznámá adresa' }, 'no-store');
  } catch (e) {
    return send(req, res, 502, { error: e instanceof Error ? e.message : String(e) }, 'no-store');
  }
}
