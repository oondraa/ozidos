import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { getStops, getTrip, startCatalog } from './catalog.js';
import { getGroupDepartures } from './departures.js';
import { startTimetable } from './gtfs/timetable.js';
import { nearestPlaces, plan, resolvePlace, searchPlaces } from './planner.js';
import { startCollector, live } from './collector.js';
import { BBOX, PORT } from './config.js';
import { dbStats, stationHistory, tripHistory } from './db.js';

const app = new Hono();
app.use('/api/*', cors());

app.get('/api/config', (c) => c.json({ bbox: BBOX }));

/** Všechno živé najednou – web se ptá každých 10 s. */
app.get('/api/live', (c) =>
  c.json({
    now: Date.now(),
    vehicles: [...live.vehicles.iredo, ...live.vehicles.dpmhk],
    bikes: live.bikes,
    status: live.status,
  }),
);

/** Všechny zastávky v oblasti (bus, vlak, MHD). Mění se zřídka – prohlížeč může cachovat. */
app.get('/api/stops', (c) => {
  c.header('Cache-Control', 'public, max-age=3600');
  return c.json(getStops());
});

/** Přesná trasa a zastávky jednoho spoje. */
app.get('/api/trip/:tripKey', async (c) => {
  try {
    const trip = await getTrip(c.req.param('tripKey'));
    return trip ? c.json(trip) : c.json({ error: 'Spoj nenalezen (možná už dojel)' }, 404);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/** Odjezdy ze zastávky a zastávek hned vedle (id z /api/stops, např. „iredo:S-822“ nebo „dpmhk:508001226“). */
app.get('/api/departures/:stopId', async (c) => {
  const stopId = c.req.param('stopId');
  try {
    return c.json(await getGroupDepartures(stopId));
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 502);
  }
});

/** Hledání zastávek pro „Odkud/Kam“. */
app.get('/api/places', async (c) => c.json(await searchPlaces(c.req.query('q') ?? '')));

/** Nejbližší zastávky k bodu (?lat=&lon=). */
app.get('/api/places/near', async (c) =>
  c.json(await nearestPlaces(Number(c.req.query('lat')), Number(c.req.query('lon')))),
);

/** Vyhledání spojení. from/to = „station:SC27580“ nebo „lat,lon[,název]“, at = epoch ms (výchozí teď). */
app.get('/api/plan', async (c) => {
  try {
    const [from, to] = await Promise.all([resolvePlace(c.req.query('from') ?? ''), resolvePlace(c.req.query('to') ?? '')]);
    if (!from || !to) return c.json({ error: 'Neznámé místo odkud nebo kam' }, 400);
    const at = Number(c.req.query('at')) || Date.now();
    return c.json({ from, to, journeys: await plan(from, to, at) });
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

app.get('/api/status', (c) => c.json({ sources: live.status, db: dbStats() }));

/** Historie spojů jedné linky – „jezdí ten bus vůbec?“ */
app.get('/api/history/line/:line', (c) => c.json(tripHistory(c.req.param('line'), Number(c.req.query('days') ?? 14))));

/** Vývoj počtu kol na stanici. */
app.get('/api/history/bikes/:placeId', (c) =>
  c.json(stationHistory(c.req.param('placeId'), Number(c.req.query('hours') ?? 48))),
);

startCollector();
startCatalog();
startTimetable();
serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`OZIDOS server běží na http://localhost:${info.port}`);
});
