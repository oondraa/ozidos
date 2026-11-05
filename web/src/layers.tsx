import L from 'leaflet';
import { Marker, Popup } from 'react-leaflet';
import type { BikePlace, Vehicle } from './api';
import { BODY, NEXTBIKE_BLUE } from './colors';
import { delayLevel } from './format';

const iconCache = new Map<string, L.DivIcon>();

function cachedIcon(key: string, make: () => L.DivIcon): L.DivIcon {
  let icon = iconCache.get(key);
  if (!icon) {
    icon = make();
    iconCache.set(key, icon);
  }
  return icon;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}


/**
 * Autobus z ptačí perspektivy (předek nahoře). Přechody na bocích a odlesky dělají
 * dojem zaoblené karoserie, stín se kreslí přes CSS na nerotovaném obalu (světlo je pořád ze stejné strany).
 */
function busSvg(kind: 'bus' | 'mhd'): string {
  const [side, mid, accent] = BODY[kind];
  const g = `b3d-${kind}`;
  return `<svg class="v3d-body" width="19" height="41" viewBox="-1 -1 19 41" aria-hidden="true">
  <defs>
    <linearGradient id="${g}" x1="0" x2="1">
      <stop offset="0" stop-color="${side}"/><stop offset=".35" stop-color="${mid}"/>
      <stop offset=".65" stop-color="${mid}"/><stop offset="1" stop-color="${side}"/>
    </linearGradient>
    <linearGradient id="${g}-glass" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0b1220"/><stop offset="1" stop-color="#334155"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2.2" width="15" height="37" rx="3.2" fill="#000" opacity=".38"/>
  <rect x=".5" y=".5" width="15" height="37" rx="3.2" fill="url(#${g})" stroke="#0f172a" stroke-opacity=".55"/>
  <path d="M2 2.2 Q8 .6 14 2.2 L13.4 6.4 Q8 5.4 2.6 6.4 Z" fill="url(#${g}-glass)"/>
  <rect x="1.1" y="8" width="1.3" height="26" rx=".6" fill="#0f172a" opacity=".75"/>
  <rect x="13.6" y="8" width="1.3" height="26" rx=".6" fill="#0f172a" opacity=".75"/>
  <rect x="2.6" y="7.5" width=".9" height="27" fill="${accent}"/>
  <rect x="12.5" y="7.5" width=".9" height="27" fill="${accent}"/>
  <rect x="4.3" y="9" width="7.4" height="5" rx="1" fill="#e2e8f0"/>
  <rect x="4.9" y="9.6" width="6.2" height="3.8" rx=".6" fill="#94a3b8" opacity=".6"/>
  <rect x="4.8" y="22" width="6.4" height="3" rx=".8" fill="#cbd5e1" opacity=".85"/>
  <path d="M3 34.6 L13 34.6 L12.6 36.4 L3.4 36.4 Z" fill="url(#${g}-glass)"/>
  <rect x="3.4" y="1" width="2" height=".9" rx=".4" fill="#fef9c3"/>
  <rect x="10.6" y="1" width="2" height=".9" rx=".4" fill="#fef9c3"/>
  <line x1="8" y1="7.5" x2="8" y2="33" stroke="#fff" stroke-opacity=".18" stroke-width="2"/>
</svg>`;
}

/** Vlak: dva vozy za sebou, sběrač na střeše. */
function trainSvg(): string {
  const [side, mid, light] = BODY.train;
  const car = (y: number) =>
    `<rect x=".5" y="${y}" width="13" height="23" rx="2.5" fill="url(#b3d-train)" stroke="#0f172a" stroke-opacity=".55"/>` +
    `<rect x="1" y="${y + 4}" width="1.2" height="15" fill="#0f172a" opacity=".7"/><rect x="11.8" y="${y + 4}" width="1.2" height="15" fill="#0f172a" opacity=".7"/>`;
  return `<svg class="v3d-body" width="17" height="51" viewBox="-1 -1 17 51" aria-hidden="true">
  <defs><linearGradient id="b3d-train" x1="0" x2="1">
    <stop offset="0" stop-color="${side}"/><stop offset=".4" stop-color="${mid}"/><stop offset=".6" stop-color="${mid}"/><stop offset="1" stop-color="${side}"/>
  </linearGradient></defs>
  <rect x="2" y="2.2" width="13" height="47" rx="2.5" fill="#000" opacity=".38"/>
  ${car(0.5)}${car(24.5)}
  <path d="M2 1.8 Q7 .4 12 1.8 L11.5 4.6 Q7 3.8 2.5 4.6 Z" fill="#0b1220"/>
  <path d="M4 9 L10 13 M10 9 L4 13" stroke="${light}" stroke-width=".9"/>
</svg>`;
}

function vehicleIcon(v: Vehicle, selected: boolean, hl: boolean): L.DivIcon {
  const level = delayLevel(v.delaySec);
  // Směr zaokrouhlený na 10°, ať se ikony dají cachovat.
  const bearing = v.bearing != null ? Math.round(v.bearing / 10) * 10 : 0;
  const key = `${v.kind}|${v.line}|${level}|${bearing}|${selected}|${hl}`;
  const label = escapeHtml(v.line.length > 4 ? v.line.slice(-3) : v.line);
  return cachedIcon(key, () =>
    L.divIcon({
      className: '',
      iconSize: [48, 48],
      iconAnchor: [24, 24],
      popupAnchor: [0, -20],
      html:
        `<div class="v3d v3d-${v.kind}${selected ? ' v3d-selected' : ''}${hl ? ' v3d-hl' : ''}">` +
        `<div class="v3d-shadow"><div class="v3d-rot" style="transform:rotate(${bearing}deg)">` +
        (v.kind === 'train' ? trainSvg() : busSvg(v.kind)) +
        `</div></div>` +
        `<span class="v3d-label veh-${v.kind} delay-${level}">${label}</span></div>`,
    }),
  );
}

/** Kolo Nextbike z boku: modrý rám s nízkým nástupem, košík vpředu, nosič vzadu. */
const BIKE_SVG = `<svg class="nb-bike" width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">
  <g fill="none" stroke-linecap="round" stroke-linejoin="round">
    <circle cx="5.5" cy="11" r="4.3" stroke="#1e293b" stroke-width="1.7"/>
    <circle cx="20.5" cy="11" r="4.3" stroke="#1e293b" stroke-width="1.7"/>
    <circle cx="5.5" cy="11" r="3.2" stroke="#cbd5e1" stroke-width=".6"/>
    <circle cx="20.5" cy="11" r="3.2" stroke="#cbd5e1" stroke-width=".6"/>
    <path d="M5.5 11 L11 11.4 L17.6 5 M11 11.4 L9.6 4.6 M17.6 5 L20.5 11" stroke="${NEXTBIKE_BLUE}" stroke-width="2"/>
    <path d="M2.6 5.6 L9.4 5.6" stroke="${NEXTBIKE_BLUE}" stroke-width="1.4"/>
    <path d="M8 3.6 L11.2 3.6" stroke="#0f172a" stroke-width="1.6"/>
    <path d="M17.6 5 L18.4 2.2 L20.6 2.2" stroke="#0f172a" stroke-width="1.2"/>
  </g>
  <rect x="19.2" y="3.4" width="5.6" height="3.8" rx=".8" fill="${NEXTBIKE_BLUE}" stroke="#fff" stroke-width=".6"/>
</svg>`;

/** Prázdná stanice: stojan (držáky kol) bez kol. */
const RACK_SVG = `<svg width="20" height="12" viewBox="0 0 20 12" aria-hidden="true">
  <g fill="none" stroke="#e2e8f0" stroke-width="1.6" stroke-linecap="round">
    <path d="M3 11 V5 a2.5 2.5 0 0 1 5 0 V11"/><path d="M12 11 V5 a2.5 2.5 0 0 1 5 0 V11"/>
    <path d="M1 11.2 H19"/>
  </g>
  <g fill="none" stroke="#475569" stroke-width=".7" stroke-linecap="round">
    <path d="M3 11 V5 a2.5 2.5 0 0 1 5 0 V11"/><path d="M12 11 V5 a2.5 2.5 0 0 1 5 0 V11"/>
  </g>
</svg>`;

function bikeIcon(p: BikePlace): L.DivIcon {
  const n = Math.min(p.bikes, 99);
  const key = `bike|${p.isStation}|${n}`;
  return cachedIcon(key, () => {
    if (!p.isStation) {
      return L.divIcon({ className: '', iconSize: [22, 14], iconAnchor: [11, 7], html: `<div class="nb nb-free">${BIKE_SVG}</div>` });
    }
    if (n === 0) {
      return L.divIcon({ className: '', iconSize: [24, 16], iconAnchor: [12, 8], popupAnchor: [0, -8], html: `<div class="nb nb-empty">${RACK_SVG}</div>` });
    }
    return L.divIcon({
      className: '',
      iconSize: [32, 22],
      iconAnchor: [16, 11],
      popupAnchor: [0, -10],
      html: `<div class="nb">${BIKE_SVG}<b class="nb-count">${n}</b></div>`,
    });
  });
}

interface VehicleMarkersProps {
  vehicles: Vehicle[];
  selectedKey: string | null;
  /** Spoje vybraného spojení – při ztlumení zůstanou vidět. */
  highlight?: Set<string>;
  onSelect: (tripKey: string) => void;
}

export function VehicleMarkers({ vehicles, selectedKey, highlight, onSelect }: VehicleMarkersProps) {
  return (
    <>
      {vehicles.map((v) => (
        <Marker
          key={v.tripKey}
          position={[v.lat, v.lon]}
          icon={vehicleIcon(v, v.tripKey === selectedKey, !!highlight?.has(v.tripKey))}
          zIndexOffset={v.tripKey === selectedKey ? 2000 : v.kind === 'train' ? 500 : 0}
          eventHandlers={{ click: () => onSelect(v.tripKey) }}
        />
      ))}
    </>
  );
}

export function BikeMarkers({ places }: { places: BikePlace[] }) {
  return (
    <>
      {places.map((p) => (
        <Marker key={p.id} position={[p.lat, p.lon]} icon={bikeIcon(p)} zIndexOffset={-500}>
          <Popup>
            <div className="popup">
              <div className="popup-title">
                <b>{p.isStation ? p.name : 'Volně odložené kolo'}</b> <small>Nextbike {p.city}</small>
              </div>
              <div>
                Kol k dispozici: <b>{p.bikes}</b>
                {p.freeRacks != null && <> · volné stojany: {p.freeRacks}</>}
              </div>
              {p.bikeNumbers.length > 0 && <small>Kola: {p.bikeNumbers.join(', ')}</small>}
            </div>
          </Popup>
        </Marker>
      ))}
    </>
  );
}
