import { useEffect, useState } from 'react';
import { CircleMarker, Polyline, Tooltip } from 'react-leaflet';
import { getTrip, type TripDetail, type Vehicle } from './api';

const TRIP_REFRESH_MS = 20_000;
import { KIND_COLOR } from './colors';

/** Načte trasu vybraného spoje a průběžně ji obnovuje (projeté zastávky). */
export function useTrip(tripKey: string | null) {
  const [trip, setTrip] = useState<TripDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTrip(null);
    setError(null);
    if (!tripKey) return;
    let alive = true;
    const load = () =>
      getTrip(tripKey)
        .then((t) => alive && (setTrip(t), setError(null)))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const timer = setInterval(load, TRIP_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [tripKey]);

  return { trip, error };
}

export function TripLayer({ trip, kind }: { trip: TripDetail; kind: Vehicle['kind'] }) {
  const color = KIND_COLOR[kind];
  return (
    <>
      {/* bílý okraj, aby byla trasa vidět i přes silnice */}
      <Polyline positions={trip.shape} pathOptions={{ color: '#fff', weight: 9, opacity: 0.9 }} interactive={false} />
      <Polyline positions={trip.shape} pathOptions={{ color, weight: 5, opacity: 0.95 }} interactive={false} />
      {trip.stops.map((s, i) =>
        s.lat == null || s.lon == null ? null : (
          <CircleMarker
            key={`${s.id ?? s.name}-${i}`}
            center={[s.lat, s.lon]}
            radius={6}
            bubblingMouseEvents={false}
            pathOptions={{
              color: s.passed ? '#94a3b8' : color,
              weight: 3,
              fillColor: s.passed ? '#e2e8f0' : '#fff',
              fillOpacity: 1,
            }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <b>{s.name}</b> {s.plannedTime}
              {s.realTime && s.realTime !== s.plannedTime && <> (skutečně {s.realTime})</>}
            </Tooltip>
          </CircleMarker>
        ),
      )}
    </>
  );
}

/** Jízdní řád vybraného spoje do panelu. */
export function TripTimeline({ trip }: { trip: TripDetail }) {
  const nextIdx = trip.stops.findIndex((s) => !s.passed);
  return (
    <ol className="timeline">
      {trip.stops.map((s, i) => (
        <li key={`${s.id ?? s.name}-${i}`} className={s.passed ? 'passed' : i === nextIdx ? 'next' : ''}>
          <span className="tl-time">
            {s.plannedTime}
            {s.realTime && s.realTime !== s.plannedTime && <small> {s.realTime}</small>}
          </span>
          <span className="tl-name">{s.name}</span>
        </li>
      ))}
    </ol>
  );
}
