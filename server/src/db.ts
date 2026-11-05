import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { DB_PATH, POSITION_RETENTION_DAYS } from './config.js';
import type { BikePlace, Vehicle } from './types.js';
import { pragueDate } from './util.js';

mkdirSync(dirname(DB_PATH), { recursive: true });
export const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;

  -- Jeden řádek = jeden spoj v jednom dni. Odpovídá na „jel ten bus vůbec a s jakým zpožděním?“
  CREATE TABLE IF NOT EXISTS trip_runs (
    service_date TEXT NOT NULL,
    trip_key     TEXT NOT NULL,
    source       TEXT NOT NULL,
    kind         TEXT NOT NULL,
    line         TEXT,
    name         TEXT,
    origin       TEXT,
    destination  TEXT,
    dep_time     TEXT,
    arr_time     TEXT,
    first_seen   INTEGER NOT NULL,
    last_seen    INTEGER NOT NULL,
    obs_count    INTEGER NOT NULL DEFAULT 1,
    first_delay  INTEGER,
    last_delay   INTEGER,
    max_delay    INTEGER,
    first_lat REAL, first_lon REAL, last_lat REAL, last_lon REAL,
    PRIMARY KEY (service_date, trip_key)
  );
  CREATE INDEX IF NOT EXISTS trip_runs_line ON trip_runs(line, service_date);

  -- Vzorkovaná historie poloh (1× za minutu na vozidlo), mazaná po N dnech.
  CREATE TABLE IF NOT EXISTS vehicle_positions (
    ts       INTEGER NOT NULL,
    trip_key TEXT NOT NULL,
    lat REAL NOT NULL, lon REAL NOT NULL,
    delay    INTEGER
  );
  CREATE INDEX IF NOT EXISTS vehicle_positions_trip ON vehicle_positions(trip_key, ts);
  CREATE INDEX IF NOT EXISTS vehicle_positions_ts ON vehicle_positions(ts);

  -- Nextbike: stanice / místa
  CREATE TABLE IF NOT EXISTS bike_places (
    id TEXT PRIMARY KEY,
    name TEXT, city TEXT,
    lat REAL, lon REAL,
    is_station INTEGER NOT NULL,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL
  );
  -- Počet kol na stanici – zapisuje se jen při změně.
  CREATE TABLE IF NOT EXISTS bike_counts (
    ts INTEGER NOT NULL,
    place_id TEXT NOT NULL,
    bikes INTEGER NOT NULL,
    PRIMARY KEY (place_id, ts)
  );
  -- Kde se které kolo nacházelo – zapisuje se jen při přesunu kola.
  CREATE TABLE IF NOT EXISTS bike_sightings (
    ts INTEGER NOT NULL,
    bike_number TEXT NOT NULL,
    place_id TEXT,
    lat REAL, lon REAL
  );
  CREATE INDEX IF NOT EXISTS bike_sightings_bike ON bike_sightings(bike_number, ts);
`);

// ---------------------------------------------------------------- spoje

const upsertTrip = db.prepare(`
  INSERT INTO trip_runs (service_date, trip_key, source, kind, line, name, origin, destination, dep_time, arr_time,
                         first_seen, last_seen, obs_count, first_delay, last_delay, max_delay,
                         first_lat, first_lon, last_lat, last_lon)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (service_date, trip_key) DO UPDATE SET
    last_seen   = excluded.last_seen,
    obs_count   = obs_count + 1,
    last_delay  = coalesce(excluded.last_delay, last_delay),
    max_delay   = max(coalesce(max_delay, excluded.max_delay), coalesce(excluded.max_delay, max_delay)),
    first_delay = coalesce(first_delay, excluded.first_delay),
    origin      = coalesce(origin, excluded.origin),
    destination = coalesce(destination, excluded.destination),
    last_lat = excluded.last_lat, last_lon = excluded.last_lon
`);

const insertPosition = db.prepare(`INSERT INTO vehicle_positions (ts, trip_key, lat, lon, delay) VALUES (?, ?, ?, ?, ?)`);
const lastSampled = new Map<string, number>();

export function recordVehicles(vehicles: Vehicle[], sampleEveryMs: number): void {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const v of vehicles) {
      const date = pragueDate(v.updatedAt);
      upsertTrip.run(
        date, v.tripKey, v.source, v.kind, v.line, v.name, v.from ?? null, v.to ?? null,
        v.depTime ?? null, v.arrTime ?? null, v.updatedAt, v.updatedAt,
        v.delaySec, v.delaySec, v.delaySec, v.lat, v.lon, v.lat, v.lon,
      );
      const last = lastSampled.get(v.tripKey) ?? 0;
      if (now - last >= sampleEveryMs) {
        insertPosition.run(v.updatedAt, v.tripKey, v.lat, v.lon, v.delaySec);
        lastSampled.set(v.tripKey, now);
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------- Nextbike

const upsertPlace = db.prepare(`
  INSERT INTO bike_places (id, name, city, lat, lon, is_station, first_seen, last_seen)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (id) DO UPDATE SET name = excluded.name, lat = excluded.lat, lon = excluded.lon, last_seen = excluded.last_seen
`);
const insertCount = db.prepare(`INSERT OR REPLACE INTO bike_counts (ts, place_id, bikes) VALUES (?, ?, ?)`);
const insertSighting = db.prepare(`INSERT INTO bike_sightings (ts, bike_number, place_id, lat, lon) VALUES (?, ?, ?, ?, ?)`);

// Poslední známý stav – načte se z DB, aby restart serveru nevytvořil duplicitní záznamy.
const lastCount = new Map<string, number>(
  (db.prepare(`SELECT place_id, bikes FROM bike_counts c WHERE ts = (SELECT max(ts) FROM bike_counts WHERE place_id = c.place_id)`)
    .all() as { place_id: string; bikes: number }[]).map((r) => [r.place_id, r.bikes]),
);
const lastBikePlace = new Map<string, string>(
  (db.prepare(`SELECT bike_number, place_id FROM bike_sightings s WHERE ts = (SELECT max(ts) FROM bike_sightings WHERE bike_number = s.bike_number)`)
    .all() as { bike_number: string; place_id: string }[]).map((r) => [r.bike_number, r.place_id]),
);

export function recordBikes(places: BikePlace[]): void {
  const now = Date.now();
  db.exec('BEGIN');
  try {
    for (const p of places) {
      if (p.isStation) {
        upsertPlace.run(p.id, p.name, p.city, p.lat, p.lon, 1, now, now);
        if (lastCount.get(p.id) !== p.bikes) {
          insertCount.run(now, p.id, p.bikes);
          lastCount.set(p.id, p.bikes);
        }
      }
      for (const bike of p.bikeNumbers) {
        // Volné kolo má vlastní „místo“ s novým uid při každém odložení → klíčem je poloha.
        const placeKey = p.isStation ? p.id : `free:${p.lat.toFixed(4)},${p.lon.toFixed(4)}`;
        if (lastBikePlace.get(bike) !== placeKey) {
          insertSighting.run(now, bike, placeKey, p.lat, p.lon);
          lastBikePlace.set(bike, placeKey);
        }
      }
    }
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

// ---------------------------------------------------------------- dotazy

export function tripHistory(line: string, days = 14) {
  return db.prepare(`
    SELECT service_date, trip_key, name, origin, destination, dep_time, first_seen, last_seen, last_delay, max_delay
    FROM trip_runs WHERE line = ? AND service_date >= ? ORDER BY service_date DESC, dep_time
  `).all(line, pragueDate(Date.now() - days * 86_400_000));
}

export function stationHistory(placeId: string, hours = 48) {
  return db.prepare(`SELECT ts, bikes FROM bike_counts WHERE place_id = ? AND ts >= ? ORDER BY ts`)
    .all(placeId, Date.now() - hours * 3_600_000);
}

export function dbStats() {
  const count = (t: string) => (db.prepare(`SELECT count(*) AS n FROM ${t}`).get() as { n: number }).n;
  return {
    tripRuns: count('trip_runs'),
    positions: count('vehicle_positions'),
    bikePlaces: count('bike_places'),
    bikeCounts: count('bike_counts'),
    bikeSightings: count('bike_sightings'),
  };
}

export function pruneOldPositions(): void {
  const cutoff = Date.now() - POSITION_RETENTION_DAYS * 86_400_000;
  db.prepare('DELETE FROM vehicle_positions WHERE ts < ?').run(cutoff);
  for (const [k, t] of lastSampled) if (t < Date.now() - 3_600_000) lastSampled.delete(k);
}
