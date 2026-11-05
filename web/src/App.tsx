import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents, CircleMarker, Popup, Tooltip } from 'react-leaflet';
import { getLive, HAS_LIVE, type LiveData, type SourceId, type Stop, type Vehicle, type VehicleKind } from './api';
import { DeparturesCard } from './departures';
import { IconArrowRight, IconChevron, IconCity, IconClose, IconHome, IconLocate, IconMap, IconSatellite, IconSliders } from './icons';
import { delayLevel, formatAgo, formatDelay, KIND_LABEL } from './format';
import { BikeMarkers, VehicleMarkers } from './layers';
import { StopsLayer, STOPS_MIN_ZOOM } from './stops';
import { TripLayer, TripTimeline, useTrip } from './trip';
import { MyLocation, useGeolocation } from './geo';
import { JourneyLayer, PlannerCard, usePlan, type PlaceSel } from './planner';
import { setHome, useHome } from './home';
import { useBottomSheet } from './sheet';

const HK_CENTER: [number, number] = [50.2, 15.86];
/** Sledovaná oblast (stejná jako BBOX na serveru) s malou rezervou – dál mapa nepustí. */
const AREA_BOUNDS: [[number, number], [number, number]] = [
  [50.095, 15.69],
  [50.295, 16.05],
];
const REFRESH_MS = 10_000;
const NEAR_HOME_KM = 3;

type LayerId = VehicleKind | 'bikes' | 'stops';
const LAYERS: { id: LayerId; label: string }[] = [
  { id: 'train', label: 'Vlaky' },
  { id: 'bus', label: 'Busy IREDO' },
  { id: 'mhd', label: 'MHD Hradec' },
  { id: 'bikes', label: 'Nextbike' },
  { id: 'stops', label: 'Zastávky' },
];
const SOURCE_LABEL: Record<SourceId, string> = { iredo: 'IREDO', dpmhk: 'DPmHK', nextbike: 'Nextbike' };

function distanceKm(a: [number, number], b: [number, number]): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[0] - a[0]);
  const dLon = toRad(b[1] - a[1]) * Math.cos(toRad((a[0] + b[0]) / 2));
  return 6371 * Math.hypot(dLat, dLon);
}

function useLive() {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      try {
        const d = await getLive();
        if (alive) {
          setData(d);
          setError(null);
        }
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : String(e));
      }
      // Na skryté záložce se neptat zbytečně.
      if (alive) timer = setTimeout(load, document.hidden ? REFRESH_MS * 6 : REFRESH_MS);
    };
    const onVisible = () => {
      if (!document.hidden) {
        clearTimeout(timer);
        void load();
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    void load();
    return () => {
      alive = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return { data, error };
}

function FlyTo({ target }: { target: { pos: [number, number]; zoom: number; n: number } | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target.pos, target.zoom, { duration: 0.8 });
  }, [target, map]);
  return null;
}

/** Třída na kontejneru mapy podle zoomu – CSS podle ní zmenšuje/zvětšuje vozidla. */
function ZoomClass() {
  const map = useMap();
  // jen pro ladění výkonu z konzole prohlížeče (v produkci se nepřidá)
  if (import.meta.env.DEV) (window as unknown as { __map: unknown }).__map = map;
  useEffect(() => {
    const apply = () => {
      const z = map.getZoom();
      const el = map.getContainer();
      el.classList.toggle('zoom-far', z <= 11);
      el.classList.toggle('zoom-mid', z >= 12 && z <= 13);
      el.classList.toggle('zoom-near', z >= 16);
    };
    apply();
    map.on('zoomend', apply);
    return () => {
      map.off('zoomend', apply);
    };
  }, [map]);
  return null;
}

type Basemap = 'satellite' | 'map';
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const ESRI_ATTR = 'Snímky &copy; Esri, Maxar, Earthstar Geographics';
/** Dlaždice načítat až po dokončení zoomu (ne v každém snímku animace) a držet víc okolních v paměti. */
const TILE_PERF = { updateWhenZooming: false, keepBuffer: 4 } as const;

function Basemaps({ basemap }: { basemap: Basemap }) {
  if (basemap === 'map') {
    return (
      <TileLayer
        key="osm"
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
        maxZoom={19}
        {...TILE_PERF}
      />
    );
  }
  return (
    <>
      <TileLayer key="sat" url={`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`} attribution={ESRI_ATTR} maxZoom={19} {...TILE_PERF} />
      {/* silnice a názvy obcí přes satelit, ať se dá orientovat */}
      <TileLayer
        key="sat-roads"
        url={`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`}
        maxZoom={19}
        opacity={0.55}
        {...TILE_PERF}
      />
      <TileLayer key="sat-labels" url={`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`} maxZoom={19} {...TILE_PERF} />
    </>
  );
}

/** useState, který si hodnotu pamatuje v prohlížeči. */
function useStored<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? { ...initial, ...JSON.parse(raw) } : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);
  return [value, setValue] as const;
}

function MapClick({ onClick, onLongPress }: { onClick: () => void; onLongPress: (pos: [number, number]) => void }) {
  // contextmenu = pravé tlačítko na PC, dlouhé podržení na mobilu
  useMapEvents({ click: onClick, contextmenu: (e) => onLongPress([e.latlng.lat, e.latlng.lng]) });
  return null;
}

/** Třída „has-selection“ na mapě → CSS ztlumí všechno kromě vybraného. */
function SelectionClass({ active }: { active: boolean }) {
  const map = useMap();
  useEffect(() => {
    map.getContainer().classList.toggle('has-selection', active);
  }, [active, map]);
  return null;
}

export function App() {
  const { data, error } = useLive();
  const geo = useGeolocation();
  const home = useHome();
  const homePos: [number, number] | null = home ? [home.lat, home.lon] : null;
  // Vlaky uživatel moc nepoužívá → ve výchozím stavu skryté. Nastavení se pamatuje.
  const [enabled, setEnabled] = useStored<Record<LayerId, boolean>>('ozidos.layers', {
    train: false,
    bus: true,
    mhd: true,
    bikes: true,
    stops: true,
  });
  const [view, setView] = useStored<{ basemap: Basemap }>('ozidos.view', { basemap: 'satellite' });
  const [flyTarget, setFlyTarget] = useState<{ pos: [number, number]; zoom: number; n: number } | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  // telefon: panel jako spodní list tahaný prstem (sheet.ts); PC: rozbalit/sbalit klikem
  const sheet = useBottomSheet();
  const open = sheet.isMobile ? sheet.level !== 'peek' : panelOpen;
  const openPanel = () => {
    setPanelOpen(true);
    sheet.reveal();
  };
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [selectedSnapshot, setSelectedSnapshot] = useState<Vehicle | null>(null);
  const { trip, error: tripError } = useTrip(selectedKey);
  const [selectedStop, setSelectedStop] = useState<Stop | null>(null);

  // ---- vyhledávání spojení
  const [from, setFrom] = useState<PlaceSel | null>(null);
  const [to, setTo] = useState<PlaceSel | null>(null);
  const [at, setAt] = useState<number | null>(null);
  const [journeyIdx, setJourneyIdx] = useState<number | null>(null);
  const [pickAt, setPickAt] = useState<[number, number] | null>(null);
  const planState = usePlan(from, to, geo, at);
  const journey = journeyIdx != null ? (planState.result?.journeys[journeyIdx] ?? null) : null;
  // Odkud = moje poloha, jakmile ji prohlížeč dá (dokud si uživatel nevybere jinak).
  useEffect(() => {
    if (geo.pos && !from) setFrom({ name: 'Moje poloha', lat: geo.pos[0], lon: geo.pos[1], me: true });
  }, [geo.pos, from]);
  useEffect(() => setJourneyIdx(null), [from, to, at]);
  // Při prvním zjištění polohy přeletět na ni (jen když je v oblasti, kterou sledujeme).
  const [centeredOnMe, setCenteredOnMe] = useState(false);
  useEffect(() => {
    if (!geo.pos || centeredOnMe) return;
    setCenteredOnMe(true);
    const [[s, w], [n, e]] = AREA_BOUNDS;
    if (geo.pos[0] > s && geo.pos[0] < n && geo.pos[1] > w && geo.pos[1] < e) fly(geo.pos, 14);
  }, [geo.pos, centeredOnMe]);

  // Vybrané vozidlo – živá data, a když z feedu zmizí (dojelo), poslední známý stav.
  const liveSelected = selectedKey ? data?.vehicles.find((v) => v.tripKey === selectedKey) : undefined;
  useEffect(() => {
    if (liveSelected) setSelectedSnapshot(liveSelected);
  }, [liveSelected]);
  const selected = liveSelected ?? (selectedSnapshot?.tripKey === selectedKey ? selectedSnapshot : null);

  const select = (tripKey: string | null) => {
    setSelectedKey(tripKey);
    if (tripKey) openPanel();
  };
  const selectStop = (stop: Stop | null) => {
    setSelectedStop(stop);
    if (stop) openPanel();
  };
  /** Klik do prázdné mapy zruší výběr spoje i zastávky (vybrané spojení zůstává). */
  const clearSelection = () => {
    select(null);
    selectStop(null);
    setPickAt(null);
  };

  // Spoje vybraného spojení zůstanou při ztlumení vidět.
  const journeyKeys = useMemo(
    () => new Set((journey?.legs ?? []).flatMap((l) => (l.type === 'ride' && l.tripKey ? [l.tripKey] : []))),
    [journey],
  );
  const dimming = !!selectedKey || !!journey;

  const vehicles = useMemo(
    () => (data?.vehicles ?? []).filter((v) => enabled[v.kind] || journeyKeys.has(v.tripKey)),
    [data, enabled, journeyKeys],
  );
  const bikes = enabled.bikes ? (data?.bikes ?? []) : [];

  // „Teď kolem“ – kolem mě, nebo kolem domova, když polohu nemám (a bez obojího kolem centra HK).
  const center: [number, number] = geo.pos ?? homePos ?? HK_CENTER;
  const nearLabel = geo.pos ? 'Teď kolem tebe' : homePos ? 'Teď kolem domova' : 'Teď v Hradci';
  const nearHome = useMemo(
    () =>
      vehicles
        .map((v) => ({ v, km: distanceKm(center, [v.lat, v.lon]) }))
        .filter((x) => x.km <= NEAR_HOME_KM)
        .sort((a, b) => a.km - b.km)
        .slice(0, 6),
    [vehicles, center[0], center[1]],
  );
  const homeBikes = useMemo(
    () =>
      (data?.bikes ?? [])
        .filter((b) => b.isStation)
        .map((b) => ({ b, km: distanceKm(center, [b.lat, b.lon]) }))
        .sort((a, b) => a.km - b.km)
        .slice(0, 3),
    [data, center[0], center[1]],
  );

  const fly = (pos: [number, number], zoom: number) => setFlyTarget((t) => ({ pos, zoom, n: (t?.n ?? 0) + 1 }));
  const counts = (k: VehicleKind) => data?.vehicles.filter((v) => v.kind === k).length ?? 0;
  const now = data?.now ?? Date.now();

  const showVehicle = (key: string) => {
    select(key);
    const v = data?.vehicles.find((x) => x.tripKey === key);
    if (v) fly([v.lat, v.lon], 15);
  };

  return (
    <div className="app">
      <MapContainer
        center={HK_CENTER}
        zoom={12}
        minZoom={11}
        maxBounds={AREA_BOUNDS}
        maxBoundsViscosity={0.9}
        className="map"
        zoomControl={false}
        preferCanvas
      >
        <Basemaps basemap={view.basemap} />
        <ZoomClass />
        <SelectionClass active={dimming} />
        {homePos && (
          <CircleMarker center={homePos} radius={9} pathOptions={{ color: '#d7232f', weight: 3, fillOpacity: 0.15 }}>
            <Tooltip direction="top" offset={[0, -8]}>Domov</Tooltip>
          </CircleMarker>
        )}
        {enabled.stops && <StopsLayer onSelect={selectStop} selectedId={selectedStop?.id} />}
        {journey && <JourneyLayer j={journey} />}
        {trip && selected && <TripLayer trip={trip} kind={selected.kind} />}
        {enabled.bikes && <BikeMarkers places={bikes} />}
        <VehicleMarkers vehicles={vehicles} selectedKey={selectedKey} highlight={journeyKeys} onSelect={select} />
        <MyLocation geo={geo} />
        <MapClick onClick={clearSelection} onLongPress={setPickAt} />
        {pickAt && (
          <Popup position={pickAt} closeButton={false} eventHandlers={{ remove: () => setPickAt(null) }}>
            <div className="pick">
              <button
                onClick={() => {
                  setFrom({ name: 'Bod na mapě', lat: pickAt[0], lon: pickAt[1] });
                  setPickAt(null);
                  openPanel();
                }}
              >
                Odsud
              </button>
              <button
                onClick={() => {
                  setTo({ name: 'Bod na mapě', lat: pickAt[0], lon: pickAt[1] });
                  setPickAt(null);
                  openPanel();
                }}
              >
                Sem
              </button>
              <button
                className="pick-home"
                title="Uložit jako domov (jen v tomhle prohlížeči)"
                onClick={() => {
                  setHome({ name: 'Domov', lat: pickAt[0], lon: pickAt[1] });
                  setPickAt(null);
                }}
              >
                <IconHome size={16} /> Domov
              </button>
            </div>
          </Popup>
        )}
        <FlyTo target={flyTarget} />
      </MapContainer>

      <button
        className="locate"
        title="Kde jsem"
        style={sheet.isMobile ? { bottom: sheet.height + 12 } : undefined}
        onClick={() => (geo.pos ? fly(geo.pos, 16) : alertNoGeo(geo.error))}
      >
        <IconLocate size={22} />
      </button>

      <aside
        className={`panel ${open ? '' : 'panel-collapsed'} ${sheet.dragging ? 'panel-dragging' : ''}`}
        style={sheet.isMobile ? { height: sheet.height } : undefined}
      >
        <header
          className="panel-head"
          onClick={sheet.isMobile ? undefined : () => setPanelOpen((o) => !o)}
          {...(sheet.isMobile ? sheet.handlers : {})}
        >
          <span className="grabber" />
          <h1>
            <img src={`${import.meta.env.BASE_URL}logo.png`} alt="OZIDOS" />
          </h1>
          <span className="panel-toggle">
            <IconChevron dir={open ? 'down' : 'up'} />
          </span>
        </header>

        {/* na telefonu obsah vždy (při tahání je vidět), oříznutý výškou listu */}
        {(open || sheet.isMobile) && (
          <div className="panel-body">
            {error && <div className="error">Server nedostupný: {error}</div>}

            <PlannerCard
              from={from}
              to={to}
              setFrom={setFrom}
              setTo={setTo}
              geo={geo}
              now={now}
              plan={planState}
              selected={journeyIdx}
              onSelect={setJourneyIdx}
              onShowVehicle={showVehicle}
              at={at}
              setAt={setAt}
            />

            {selectedStop && (
              <DeparturesCard
                stop={selectedStop}
                now={now}
                onClose={() => selectStop(null)}
                onSelectTrip={showVehicle}
              />
            )}

            {selected && (
              <section className="trip-card">
                <div className="trip-head">
                  <span className={`line-badge veh-${selected.kind}`}>{selected.line}</span>
                  <div className="trip-title">
                    <b className="dest">
                      {selected.to ? (
                        <>
                          <IconArrowRight size={14} /> {selected.to}
                        </>
                      ) : (
                        selected.name
                      )}
                    </b>
                    <small>
                      {KIND_LABEL[selected.kind]} · {selected.name}
                      {selected.operator && ` · ${selected.operator}`}
                      {selected.vehicleNo && ` · vůz ${selected.vehicleNo}`}
                    </small>
                  </div>
                  <button className="close" onClick={() => select(null)} title="Zavřít">
                    <IconClose />
                  </button>
                </div>
                <div className="trip-meta">
                  <span className={`delay-text delay-${delayLevel(selected.delaySec)}`}>{formatDelay(selected.delaySec)}</span>
                  <small>{liveSelected ? `poloha ${formatAgo(selected.updatedAt, now)}` : 'už není v provozu'}</small>
                  <button className="link" onClick={() => fly([selected.lat, selected.lon], 15)}>
                    ukázat
                  </button>
                </div>
                {tripError && <div className="error">Trasu se nepodařilo načíst: {tripError}</div>}
                {!trip && !tripError && <p className="muted">Načítám trasu…</p>}
                {trip && <TripTimeline trip={trip} />}
              </section>
            )}

            {!journey && !selected && !selectedStop && !planState.result?.journeys.length && (
              <>
                {/* bez serveru živé busy nemáme */}
                {HAS_LIVE && (
                  <section>
                    <h2>
                      {nearLabel} ({NEAR_HOME_KM} km)
                    </h2>
                    {nearHome.length === 0 && <p className="muted">Nic nejede. Klasika.</p>}
                    {nearHome.map(({ v, km }) => (
                      <NearRow key={v.tripKey} v={v} km={km} onClick={() => showVehicle(v.tripKey)} />
                    ))}
                  </section>
                )}

                <section>
                  <h2>Nextbike nejblíž</h2>
                  {homeBikes.map(({ b, km }) => (
                    <div key={b.id} className="row" onClick={() => fly([b.lat, b.lon], 16)}>
                      <span className={`bike-badge ${b.bikes === 0 ? 'bike-empty' : ''}`}>{b.bikes}</span>
                      <span className="row-main">{b.name.replace(/\s*\(.*\)$/, '')}</span>
                      <small>{km.toFixed(1)} km</small>
                    </div>
                  ))}
                </section>
              </>
            )}

            <section className="settings">
              <button className="link" onClick={() => setSettingsOpen((o) => !o)}>
                <IconSliders size={16} /> Vrstvy a mapa <IconChevron size={14} dir={settingsOpen ? 'down' : 'right'} />
              </button>
              {settingsOpen && (
                <>
                  <div className="sources">
                    {(Object.keys(SOURCE_LABEL) as SourceId[]).filter((s) => HAS_LIVE || s === 'nextbike').map((s) => {
                      const st = data?.status[s];
                      return (
                        <span key={s} className={`source ${st?.ok ? 'ok' : st ? 'err' : ''}`} title={st?.lastError ?? ''}>
                          {SOURCE_LABEL[s]}
                        </span>
                      );
                    })}
                  </div>
                  <div className="layers">
                    {LAYERS.filter((l) => HAS_LIVE || l.id === 'bikes' || l.id === 'stops').map((l) => (
                      <label key={l.id} className={`chip chip-${l.id} ${enabled[l.id] ? 'on' : ''}`}>
                        <input
                          type="checkbox"
                          checked={enabled[l.id]}
                          onChange={(e) => setEnabled((s) => ({ ...s, [l.id]: e.target.checked }))}
                        />
                        {l.label}
                        <small>
                          {l.id === 'bikes'
                            ? (data?.bikes.reduce((n, b) => n + b.bikes, 0) ?? 0)
                            : l.id === 'stops'
                              ? `od z${STOPS_MIN_ZOOM}`
                              : counts(l.id)}
                        </small>
                      </label>
                    ))}
                  </div>
                  <div className="buttons">
                    {homePos && (
                      <button onClick={() => fly(homePos, 14)}>
                        <IconHome size={16} /> Domov
                      </button>
                    )}
                    <button onClick={() => fly(HK_CENTER, 12)}>
                      <IconCity size={16} /> Hradec
                    </button>
                    <button onClick={() => setView((v) => ({ basemap: v.basemap === 'satellite' ? 'map' : 'satellite' }))}>
                      {view.basemap === 'satellite' ? (
                        <>
                          <IconMap size={16} /> Mapa
                        </>
                      ) : (
                        <>
                          <IconSatellite size={16} /> Satelit
                        </>
                      )}
                    </button>
                  </div>
                  <div className="home-row">
                    <IconHome size={16} />
                    {home ? (
                      <>
                        <span>Domov je uložený jen v tomhle prohlížeči.</span>
                        <button className="link" onClick={() => setHome(null)}>
                          smazat
                        </button>
                      </>
                    ) : (
                      <span>Domov nastavíš v poli Kam, nebo podržením prstu na mapě.</span>
                    )}
                    {geo.pos && (
                      <button className="link" onClick={() => setHome({ name: 'Domov', lat: geo.pos![0], lon: geo.pos![1] })}>
                        {home ? 'změnit na moji polohu' : 'nastavit na moji polohu'}
                      </button>
                    )}
                  </div>
                </>
              )}
            </section>
          </div>
        )}
      </aside>
    </div>
  );
}

function alertNoGeo(err: string | null) {
  console.warn('Poloha:', err ?? 'zatím neznámá');
}

function NearRow({ v, km, onClick }: { v: Vehicle; km: number; onClick: () => void }) {
  return (
    <div className="row" onClick={onClick}>
      <span className={`line-badge veh-${v.kind}`}>{v.line}</span>
      <span className="row-main">
        {v.to ? (
          <>
            <IconArrowRight size={12} /> {v.to}
          </>
        ) : (
          KIND_LABEL[v.kind]
        )}
        <small className={`delay-text delay-${delayLevel(v.delaySec)}`}> {formatDelay(v.delaySec)}</small>
      </span>
      <small>{km.toFixed(1)} km</small>
    </div>
  );
}
