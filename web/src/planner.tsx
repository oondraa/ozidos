import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet';
import { getPlan, HAS_LIVE, searchPlaces, type Journey, type Leg, type Place, type PlanResult, type RideLeg } from './api';
import { KIND_COLOR } from './colors';
import { delayLevel, formatDelay } from './format';
import type { GeoState } from './geo';
import { setHome, useHome } from './home';
import {
  IconArrowRight,
  IconChevron,
  IconHistory,
  IconHome,
  IconNavigation,
  IconSearch,
  IconStar,
  IconStop,
  IconSwap,
  IconWalk,
} from './icons';

/** Místo ve výběru „Odkud/Kam“. `me` = aktuální poloha (aktualizuje se). */
export type PlaceSel = Place & { me?: boolean };

/** Domov není v kódu – uživatel si ho nastaví (viz home.ts). */
const QUICK: PlaceSel[] = [
  { name: 'Terminál HD', lat: 50.216942, lon: 15.81221 },
  { name: 'Hlavní nádraží', lat: 50.21381, lon: 15.81274 },
  { name: 'Centrum (Velké nám.)', lat: 50.20965, lon: 15.83275 },
];
const RECENT_KEY = 'ozidos.recent';
const REFRESH_MS = 30_000;

const clock = new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', hour: 'numeric', minute: '2-digit' });
export const hm = (ms: number) => clock.format(ms);
const minutes = (ms: number) => Math.max(0, Math.round(ms / 60_000));

export function shortName(name: string): string {
  return name.replace(/^Hradec Králové,\s*/, '');
}

function loadRecent(): PlaceSel[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
  } catch {
    return [];
  }
}

function remember(p: PlaceSel) {
  if (p.me || p.name === 'Domov') return;
  // bez duplicit a bez míst, která už jsou v rychlé volbě
  if (QUICK.some((q) => q.name === p.name)) return;
  const same = (r: PlaceSel) => shortName(r.name) === shortName(p.name) && Math.abs(r.lat - p.lat) < 0.002;
  const list = [p, ...loadRecent().filter((r) => !same(r))].slice(0, 6);
  localStorage.setItem(RECENT_KEY, JSON.stringify(list));
}

// ---------------------------------------------------------------- data

/** Hledá spojení a každých 30 s ho obnoví (kvůli živým zpožděním). */
export function usePlan(from: PlaceSel | null, to: PlaceSel | null, geo: GeoState, at: number | null) {
  const [result, setResult] = useState<PlanResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // poloha se mění pořád – na novou polohu se ptáme jen při obnově, ne při každém pohybu
  const geoRef = useRef(geo);
  geoRef.current = geo;

  useEffect(() => {
    setResult(null);
    setError(null);
    if (!from || !to) return;
    let alive = true;
    const resolve = (p: PlaceSel): Place | null =>
      p.me ? (geoRef.current.pos ? { name: 'Moje poloha', lat: geoRef.current.pos[0], lon: geoRef.current.pos[1] } : null) : p;
    const load = async () => {
      const f = resolve(from);
      const t = resolve(to);
      if (!f || !t) {
        setError('Čekám na tvoji polohu…');
        return;
      }
      setLoading(true);
      try {
        const r = await getPlan(f, t, at ?? undefined);
        if (alive) {
          setResult(r);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (alive) setLoading(false);
      }
    };
    void load();
    const timer = setInterval(load, REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
    // geo.pos záměrně ne – jen „je/není poloha“, ať se první hledání spustí, až přijde
  }, [from, to, at, !!geo.pos]);

  return { result, error, loading };
}

// ---------------------------------------------------------------- výběr místa

interface FieldProps {
  label: string;
  value: PlaceSel | null;
  onChange: (p: PlaceSel) => void;
  geo: GeoState;
}

function PlaceField({ label, value, onChange, geo }: FieldProps) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Place[]>([]);
  const home = useHome();
  /** Režim „vyber, kde bydlíš“: další vybrané místo se uloží jako domov. */
  const [settingHome, setSettingHome] = useState(false);

  useEffect(() => {
    if (q.trim().length < 2) {
      setHits([]);
      return;
    }
    const t = setTimeout(() => searchPlaces(q).then(setHits).catch(() => setHits([])), 200);
    return () => clearTimeout(t);
  }, [q]);

  const pick = (p: PlaceSel) => {
    if (settingHome) {
      setHome({ name: 'Domov', lat: p.lat, lon: p.lon });
      setSettingHome(false);
      p = { name: 'Domov', lat: p.lat, lon: p.lon };
    }
    remember(p);
    onChange(p);
    setEditing(false);
    setQ('');
  };

  if (!editing) {
    return (
      <button className="pf" onClick={() => setEditing(true)}>
        <span className="pf-label">{label}</span>
        <span className={`pf-value ${value ? '' : 'pf-empty'}`}>
          {value ? (
            value.me ? (
              <>
                <IconNavigation size={15} className="icon me" /> Moje poloha
              </>
            ) : (
              shortName(value.name)
            )
          ) : (
            'Vyber místo nebo zastávku'
          )}
        </span>
      </button>
    );
  }

  const recent = loadRecent();
  return (
    <div className="pf pf-open">
      <span className="pf-label">{label}</span>
      <div className="pf-search">
      <IconSearch size={16} />
      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === 'Escape' && setEditing(false)}
        placeholder="Zastávka… (např. Terminál, Svinary)"
      />
      </div>
      <div className="pf-list">
        {q.trim().length < 2 && (
          <>
            {geo.pos && (
              <button onClick={() => pick({ name: 'Moje poloha', lat: geo.pos![0], lon: geo.pos![1], me: true })}>
                <span className="pi pi-me">
                  <IconNavigation size={15} />
                </span>
                Moje poloha
              </button>
            )}
            {!geo.pos && geo.error && <small className="muted">Poloha: {geo.error}</small>}
            {settingHome && <small className="pf-hint">Vyber, kde bydlíš: svoji polohu nebo nejbližší zastávku.</small>}
            {!settingHome &&
              (home ? (
                <button onClick={() => pick({ name: 'Domov', lat: home.lat, lon: home.lon })}>
                  <span className="pi pi-home">
                    <IconHome size={15} />
                  </span>
                  Domů
                </button>
              ) : (
                <button onClick={() => setSettingHome(true)}>
                  <span className="pi pi-home">
                    <IconHome size={15} />
                  </span>
                  Nastavit domov
                </button>
              ))}
            {!settingHome &&
              QUICK.map((p) => (
                <button key={p.name} onClick={() => pick(p)}>
                  <span className="pi pi-star">
                    <IconStar size={15} />
                  </span>
                  {p.name}
                </button>
              ))}
            {!settingHome &&
              recent.map((p) => (
              <button key={`r-${p.name}`} onClick={() => pick(p)}>
                <span className="pi">
                  <IconHistory size={15} />
                </span>
                {shortName(p.name)}
              </button>
            ))}
            <small className="muted">Tip: místo vybereš i dlouhým podržením na mapě.</small>
          </>
        )}
        {hits.map((p) => (
          <button key={p.id ?? p.name} onClick={() => pick(p)}>
            <span className="pi pi-stop">
              <IconStop size={15} />
            </span>
            {p.name}
          </button>
        ))}
        {q.trim().length >= 2 && hits.length === 0 && <small className="muted">Nic nenalezeno</small>}
      </div>
      <button
        className="link"
        onClick={() => {
          setEditing(false);
          setSettingHome(false);
        }}
      >
        zrušit
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- panel

interface PanelProps {
  from: PlaceSel | null;
  to: PlaceSel | null;
  setFrom: (p: PlaceSel | null) => void;
  setTo: (p: PlaceSel | null) => void;
  geo: GeoState;
  now: number;
  plan: ReturnType<typeof usePlan>;
  selected: number | null;
  onSelect: (i: number | null) => void;
  onShowVehicle: (tripKey: string) => void;
  at: number | null;
  setAt: (t: number | null) => void;
}

export function PlannerCard(props: PanelProps) {
  const { from, to, setFrom, setTo, geo, now, plan, selected, onSelect, onShowVehicle, at, setAt } = props;
  const journeys = plan.result?.journeys ?? [];
  const chosen = selected != null ? journeys[selected] : null;

  return (
    <section className="planner">
      <div className="pf-row">
        <div className="pf-col">
          <PlaceField label="Odkud" value={from} onChange={setFrom} geo={geo} />
          <PlaceField label="Kam" value={to} onChange={setTo} geo={geo} />
        </div>
        <button
          className="swap"
          title="Prohodit"
          onClick={() => {
            setFrom(to);
            setTo(from);
          }}
        >
          <IconSwap size={20} />
        </button>
      </div>
      <WhenPicker at={at} setAt={setAt} now={now} />
      {(from || to) && (
        <button
          className="link pf-clear"
          onClick={() => {
            setTo(null);
            onSelect(null);
          }}
        >
          smazat cíl
        </button>
      )}

      {plan.error && <div className="error">{plan.error}</div>}
      {from && to && !plan.result && !plan.error && <p className="muted">Hledám spojení…</p>}
      {plan.result && journeys.length === 0 && <p className="muted">Do zítřka nic nejede. Klasika.</p>}

      {!chosen &&
        journeys.map((j, i) => {
          // nadpis dne, když se den změní (nebo první výsledek není dnes)
          const prev = journeys[i - 1];
          const showDay = prev ? dayKey(prev.dep) !== dayKey(j.dep) : dayKey(j.dep) !== dayKey(now);
          return (
            <div key={i}>
              {showDay && <div className="day-head">{dayHeading(j.dep, now)}</div>}
              <JourneyRow j={j} now={now} onClick={() => onSelect(i)} />
            </div>
          );
        })}
      {!chosen && journeys.length > 0 && (
        <div className="more">
          <button onClick={() => setAt(journeys[0].dep - 60 * 60_000)}>
            <IconChevron size={14} dir="up" /> Dřívější
          </button>
          <button onClick={() => setAt(journeys[journeys.length - 1].dep + 60_000)}>
            Pozdější <IconChevron size={14} dir="down" />
          </button>
        </div>
      )}

      {chosen && (
        <JourneyDetail j={chosen} now={now} onBack={() => onSelect(null)} onShowVehicle={onShowVehicle} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- dny

const TZ = 'Europe/Prague';
const keyFmt = new Intl.DateTimeFormat('sv-SE', { timeZone: TZ });
const longDay = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'numeric' });
const shortDay = new Intl.DateTimeFormat('cs-CZ', { timeZone: TZ, weekday: 'short', day: 'numeric', month: 'numeric' });

/** „2026-11-06“ v pražském čase */
export const dayKey = (ms: number) => keyFmt.format(ms);
const addDaysKey = (ms: number, n: number) => dayKey(ms + n * 86_400_000);

/** Nadpis dne: „Dnes“, „Zítra · pátek 6. 11.“, „Sobota 7. 11.“ */
function dayHeading(ms: number, now: number): string {
  const full = longDay.format(ms);
  if (dayKey(ms) === dayKey(now)) return 'Dnes';
  if (dayKey(ms) === addDaysKey(now, 1)) return `Zítra · ${full}`;
  return full.charAt(0).toUpperCase() + full.slice(1);
}

/** Krátce pro řádek výsledku: '' (dnes), „zítra“, „so 7. 11.“ */
function dayShort(ms: number, now: number): string {
  if (dayKey(ms) === dayKey(now)) return '';
  if (dayKey(ms) === addDaysKey(now, 1)) return 'zítra';
  return shortDay.format(ms);
}

/** Epoch ms z 'YYYY-MM-DD' a 'HH:MM' (místní čas prohlížeče = Praha). */
function toMs(date: string, time: string): number {
  return new Date(`${date}T${time}:00`).getTime();
}

/** Kdy jet: Teď / Dnes / Zítra / libovolné datum + čas. */
function WhenPicker({ at, setAt, now }: { at: number | null; setAt: (t: number | null) => void; now: number }) {
  const today = dayKey(now);
  const tomorrow = addDaysKey(now, 1);
  const date = at != null ? dayKey(at) : null;
  const time = at != null ? hm(at).padStart(5, '0') : '';
  const pickDay = (d: string) => {
    // čas zachovat; u budoucího dne bez zvoleného času ráno 7:00, dnes aktuální čas
    const t = time || (d === today ? hm(Date.now()).padStart(5, '0') : '07:00');
    setAt(toMs(d, t));
  };
  return (
    <div className="pf-when">
      <div className="seg">
        <button className={at == null ? 'on' : ''} onClick={() => setAt(null)}>
          Teď
        </button>
        <button className={date === today ? 'on' : ''} onClick={() => pickDay(today)}>
          Dnes
        </button>
        <button className={date === tomorrow ? 'on' : ''} onClick={() => pickDay(tomorrow)}>
          Zítra
        </button>
      </div>
      <input
        type="date"
        aria-label="Den"
        className={date && date !== today && date !== tomorrow ? 'on' : ''}
        value={date ?? ''}
        min={today}
        onChange={(e) => e.target.value && pickDay(e.target.value)}
      />
      <input
        type="time"
        aria-label="Čas odjezdu"
        value={time}
        onChange={(e) => {
          if (!e.target.value) return setAt(null);
          let d = date ?? today;
          // bez zvoleného dne: čas, který dnes už byl, = zítra
          if (!date && toMs(d, e.target.value) < Date.now() - 30 * 60_000) d = tomorrow;
          setAt(toMs(d, e.target.value));
        }}
      />
    </div>
  );
}

function liveOfFirstRide(j: Journey): RideLeg | undefined {
  return j.legs.find((l): l is RideLeg => l.type === 'ride');
}

/** Kdy vyrazit – u první jízdy počítá se zpožděním, pokud ho známe. */
function leaveIn(j: Journey, now: number): string {
  const ms = j.dep - now;
  if (ms < -60_000) return 'už jede';
  const m = minutes(ms);
  if (m === 0) return 'vyraz teď';
  if (m < 60) return `vyraz za ${m} min`;
  const day = dayShort(j.dep, now);
  return day ? `${day} v ${hm(j.dep)}` : `vyraz v ${hm(j.dep)}`;
}

function JourneyRow({ j, now, onClick }: { j: Journey; now: number; onClick: () => void }) {
  const ride = liveOfFirstRide(j);
  return (
    <div className="jr" onClick={onClick}>
      <div className="jr-top">
        <b>
          {hm(j.dep)} <IconArrowRight size={15} /> {hm(j.arr)}
        </b>
        <small>{minutes(j.arr - j.dep)} min</small>
        <span className="jr-leave">{leaveIn(j, now)}</span>
      </div>
      <div className="jr-legs">
        {j.legs.map((l, i) => (
          <span key={i} className="leg">
            {i > 0 && <IconChevron size={12} dir="right" className="icon leg-sep" />}
            <LegChip l={l} />
          </span>
        ))}
        {ride?.live?.delaySec != null && (
          <small className={`delay-text delay-${delayLevel(ride.live.delaySec)}`}>{formatDelay(ride.live.delaySec)}</small>
        )}
        {ride?.live?.onMap && <small className="jr-live">
            <i className="live-dot" /> jede
          </small>}
      </div>
    </div>
  );
}

function LegChip({ l }: { l: Leg }) {
  if (l.type === 'walk')
    return (
      <span className="walk-chip">
        <IconWalk size={14} />
        {minutes(l.arr - l.dep)}
      </span>
    );
  return <span className={`line-badge veh-${l.kind}`}>{l.line}</span>;
}

function JourneyDetail({
  j,
  now,
  onBack,
  onShowVehicle,
}: {
  j: Journey;
  now: number;
  onBack: () => void;
  onShowVehicle: (k: string) => void;
}) {
  return (
    <div className="jd">
      <div className="jd-head">
        <button className="link" onClick={onBack}>
          <IconChevron size={16} dir="left" /> zpět
        </button>
        <b>
          {hm(j.dep)} <IconArrowRight size={15} /> {hm(j.arr)}
        </b>
        <small>
          {dayKey(j.dep) !== dayKey(now) && <>{dayHeading(j.dep, now)} · </>}
          {minutes(j.arr - j.dep)} min · {j.transfers > 0 ? `${j.transfers}× přestup` : 'bez přestupu'}
        </small>
      </div>
      <ol className="jd-legs">
        {j.legs.map((l, i) =>
          l.type === 'walk' ? (
            <li key={i} className="jd-walk">
              <IconWalk size={16} /> Pěšky {minutes(l.arr - l.dep)} min ({l.meters} m) <IconArrowRight size={13} />{' '}
              {shortName(l.to.name)}
            </li>
          ) : (
            <li key={i} className="jd-ride">
              <div className="jd-ride-head">
                <span className={`line-badge veh-${l.kind}`}>{l.line}</span>
                <span className="dest">
                  <IconArrowRight size={14} /> {l.headsign ? shortName(l.headsign) : shortName(l.to.name)}
                </span>
              </div>
              <div className="jd-stop">
                <b>{hm(l.dep)}</b> {shortName(l.from.name)}
                {l.from.platform && <small> · stan. {l.from.platform}</small>}
              </div>
              <RideLive l={l} now={now} onShowVehicle={onShowVehicle} />
              <small className="muted">
                {l.stops.length - 2 > 0 ? `${l.stops.length - 2} zastávek mezi` : 'bez zastavení'} · {minutes(l.arr - l.dep)} min
              </small>
              <div className="jd-stop">
                <b>{hm(l.arr)}</b> {shortName(l.to.name)}
              </div>
            </li>
          ),
        )}
      </ol>
    </div>
  );
}

/** „Proč tu mrznu“: kde je bus a o kolik má zpoždění. */
function RideLive({ l, now, onShowVehicle }: { l: RideLeg; now: number; onShowVehicle: (k: string) => void }) {
  // bez serveru (GitHub Pages) živá data nejsou
  if (!HAS_LIVE || l.dep - now > 2 * 3_600_000) return null;
  const d = l.live?.delaySec;
  if (!l.live) {
    return <div className="jd-live muted">Živá data zatím nejsou (spoj ještě nevyjel nebo ho nevidím).</div>;
  }
  const expected = l.dep + (d ?? 0) * 1000;
  return (
    <div className="jd-live">
      <span className={`delay-text delay-${delayLevel(d ?? null)}`}>{formatDelay(d ?? null)}</span>
      {d != null && Math.abs(d) >= 60 && <span> · odjede asi v {hm(expected)}</span>}
      {expected > now && <span> · za {minutes(expected - now)} min</span>}
      {l.live.onMap && l.tripKey && (
        <button className="chip-btn" onClick={() => onShowVehicle(l.tripKey!)}>
          Kde je teď?
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- mapa

/** Vybrané spojení na mapě: chůze čárkovaně, jízdy v barvě dopravce, nástup/výstup zvýrazněné. */
export function JourneyLayer({ j }: { j: Journey }) {
  const map = useMap();
  const points = useMemo(
    () =>
      j.legs.flatMap((l) =>
        l.type === 'walk'
          ? [
              [l.from.lat, l.from.lon],
              [l.to.lat, l.to.lon],
            ]
          : (l.shape ?? l.stops.map((s) => [s.lat, s.lon])),
      ) as [number, number][],
    [j],
  );
  useEffect(() => {
    if (!points.length) return;
    // panel zakrývá kus mapy: na PC vlevo, na telefonu dole
    const mobile = window.innerWidth <= 700;
    map.fitBounds(points, {
      paddingTopLeft: mobile ? [30, 30] : [390, 40],
      paddingBottomRight: mobile ? [30, Math.round(window.innerHeight * 0.62) + 20] : [40, 40],
      maxZoom: 16,
    });
  }, [points, map]);

  const first = j.legs[0];
  const last = j.legs[j.legs.length - 1];
  const start = first.type === 'walk' ? first.from : first.from;
  const end = last.type === 'walk' ? last.to : last.to;

  return (
    <>
      {j.legs.map((l, i) =>
        l.type === 'walk' ? (
          <Polyline
            key={i}
            positions={[
              [l.from.lat, l.from.lon],
              [l.to.lat, l.to.lon],
            ]}
            interactive={false}
            pathOptions={{ color: '#fff', weight: 4, dashArray: '2 8', lineCap: 'round', opacity: 0.95 }}
          />
        ) : (
          <RideLine key={i} l={l} />
        ),
      )}
      <CircleMarker center={[start.lat, start.lon]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#16a34a', fillOpacity: 1 }}>
        <Tooltip direction="top" offset={[0, -8]}>Start</Tooltip>
      </CircleMarker>
      <CircleMarker center={[end.lat, end.lon]} radius={9} pathOptions={{ color: '#fff', weight: 3, fillColor: '#111827', fillOpacity: 1 }}>
        <Tooltip direction="top" offset={[0, -8]}>Cíl</Tooltip>
      </CircleMarker>
    </>
  );
}

function RideLine({ l }: { l: RideLeg }) {
  const pts = l.shape ?? l.stops.map((s) => [s.lat, s.lon] as [number, number]);
  const color = KIND_COLOR[l.kind];
  return (
    <>
      <Polyline positions={pts} interactive={false} pathOptions={{ color: '#fff', weight: 9, opacity: 0.9 }} />
      <Polyline positions={pts} interactive={false} pathOptions={{ color, weight: 5 }} />
      {l.stops.map((s, i) => {
        const edge = i === 0 || i === l.stops.length - 1;
        return (
          <CircleMarker
            key={i}
            center={[s.lat, s.lon]}
            radius={edge ? 7 : 4}
            bubblingMouseEvents={false}
            pathOptions={{ color, weight: edge ? 3 : 2, fillColor: '#fff', fillOpacity: 1 }}
          >
            <Tooltip direction="top" offset={[0, -6]}>
              <b>{hm(s.time)}</b> {shortName(s.name)}
            </Tooltip>
          </CircleMarker>
        );
      })}
    </>
  );
}
