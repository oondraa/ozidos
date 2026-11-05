import { useEffect, useState } from 'react';
import { getDepartures, HAS_LIVE, STATIC, type Departure, type GroupDepartures, type Stop } from './api';
import { delayLevel, formatDelay } from './format';
import { IconClose, IconStop } from './icons';

const REFRESH_MS = 30_000;

/** Odjezdy z vybrané zastávky, obnovované každých 30 s. */
export function useDepartures(stopId: string | null) {
  const [data, setData] = useState<GroupDepartures | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setData(null);
    setError(null);
    if (!stopId) return;
    let alive = true;
    const load = () =>
      getDepartures(stopId)
        .then((d) => alive && (setData(d), setError(null)))
        .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [stopId]);

  return { data, error };
}

const dayFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Prague' });

/** „za 4 min“ / „17:14“ / „zítra 7:15“ */
function whenLabel(d: Departure, now: number): string {
  const min = Math.round((d.expectedAt - now) / 60_000);
  if (min <= 0) return 'teď';
  if (min < 60) return `za ${min} min`;
  const time = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: 'numeric', minute: '2-digit' }).format(
    d.expectedAt,
  );
  return dayFmt.format(d.expectedAt) === dayFmt.format(now) ? time : `zítra ${time}`;
}

interface Props {
  stop: Stop;
  now: number;
  onClose: () => void;
  onSelectTrip: (tripKey: string) => void;
}

export function DeparturesCard({ stop, now, onClose, onSelectTrip }: Props) {
  const { data, error } = useDepartures(stop.id);
  const names = [...new Set((data?.stops ?? [stop]).map((s) => s.name))];
  const hasIredo = (data?.stops ?? [stop]).some((s) => s.id.startsWith('iredo:'));

  return (
    <section className="trip-card">
      <div className="trip-head">
        <span className="stop-badge">
          <IconStop size={18} />
        </span>
        <div className="trip-title">
          <b>{names[0]}</b>
          <small>{names.length > 1 ? `+ ${names.slice(1).join(', ')}` : 'Odjezdy'}</small>
        </div>
        <button className="close" onClick={onClose} title="Zavřít">
          <IconClose />
        </button>
      </div>
      {error && <div className="error">Odjezdy se nepodařilo načíst: {error}</div>}
      {!data && !error && <p className="muted">Načítám odjezdy…</p>}
      {data && data.departures.length === 0 && <p className="muted">Teď odsud nic nejede.</p>}
      {data && data.departures.length > 0 && (
        <div className="deps">
          {data.departures.map((d, i) => (
            <div
              key={`${d.tripKey}-${d.expectedAt}-${i}`}
              className={`dep ${d.live ? 'dep-live' : ''}`}
              onClick={d.live ? () => onSelectTrip(d.tripKey) : undefined}
              title={d.live ? 'Ukázat spoj na mapě' : 'Spoj ještě nevyjel'}
            >
              <span className={`line-badge veh-${d.kind}`}>{d.line}</span>
              <span className="row-main">
                {d.to ?? '?'}
                <small>
                  {' '}
                  {d.plannedTime}
                  {d.platform && ` · stan. ${d.platform}`}
                  {d.delaySec != null && (
                    <span className={`delay-text delay-${delayLevel(d.delaySec)}`}> · {formatDelay(d.delaySec)}</span>
                  )}
                </small>
              </span>
              <b className="dep-when">{whenLabel(d, now)}</b>
            </div>
          ))}
        </div>
      )}
      {data && data.errors.length > 0 && <small className="muted">Část zdrojů neodpověděla: {data.errors.join('; ')}</small>}
      {hasIredo && <small className="muted">Busy a vlaky IREDO jen zhruba hodinu dopředu.</small>}
      {STATIC && (
        <small className="muted">
          {HAS_LIVE ? 'Podle jízdního řádu; spoje, které právě jedou, jsou zvýrazněné.' : 'Podle jízdního řádu, bez živých zpoždění.'}
        </small>
      )}
    </section>
  );
}
