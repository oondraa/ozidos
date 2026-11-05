import L from 'leaflet';
import { useEffect, useMemo, useState } from 'react';
import { Marker, Tooltip, useMap, useMapEvents } from 'react-leaflet';
import { getStops, type Stop } from './api';
import { KIND_COLOR } from './colors';

/** Od jakého přiblížení se zastávky zobrazují (dřív by to byl jen šum). */
export const STOPS_MIN_ZOOM = 14;

/** Piktogram na ceduli: autobus, nebo vlak. */
function glyph(kind: Stop['kind']): string {
  return kind === 'train'
    ? '<rect x="3.5" y="2.6" width="5" height="4.6" rx="1.2" fill="#fff"/><rect x="4.3" y="3.4" width="3.4" height="1.6" fill="currentColor"/><path d="M4 8.4 L3.2 9.4 M8 8.4 L8.8 9.4" stroke="#fff" stroke-width=".7"/>'
    : '<rect x="2.6" y="3" width="6.8" height="4.4" rx="1" fill="#fff"/><rect x="3.3" y="3.7" width="5.4" height="1.6" fill="currentColor"/><circle cx="4.2" cy="7.6" r=".8" fill="#fff"/><circle cx="7.8" cy="7.6" r=".8" fill="#fff"/>';
}

const iconCache = new Map<string, L.DivIcon>();

/** Malý označník zastávky: sloupek s cedulí v barvě dopravce. Kotva = pata sloupku. */
function stopIcon(kind: Stop['kind'], selected: boolean): L.DivIcon {
  const key = `${kind}|${selected}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const c = KIND_COLOR[kind];
    icon = L.divIcon({
      className: '',
      iconSize: [20, 32],
      iconAnchor: [10, 31],
      tooltipAnchor: [0, -28],
      html: `<div class="stop-sign${selected ? ' stop-sign-selected' : ''}" style="color:${c}">
  <svg width="14" height="24" viewBox="0 0 14 24" aria-hidden="true">
    <ellipse cx="7" cy="23" rx="3" ry="1" fill="#000" opacity=".35"/>
    <rect x="6.3" y="9" width="1.4" height="14" rx=".5" fill="#cbd5e1" stroke="#475569" stroke-width=".4"/>
    <rect x="1" y="1" width="12" height="10" rx="1.6" fill="currentColor" stroke="#fff" stroke-width="1.2"/>
    <g transform="translate(1 0.6)">${glyph(kind)}</g>
  </svg></div>`,
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export function StopsLayer({ onSelect, selectedId }: { onSelect?: (s: Stop) => void; selectedId?: string }) {
  const map = useMap();
  const [stops, setStops] = useState<Stop[]>([]);
  /**
   * Oblast, pro kterou jsou zastávky vykreslené (širší než výřez). Mění se, jen když z ní
   * výřez vyjede nebo se přejde hranice zoomu – jinak se při každém zoomu/posunu stovky
   * značek mazaly a vytvářely znovu a mapa se sekala.
   */
  const [area, setArea] = useState<L.LatLngBounds | null>(() =>
    map.getZoom() >= STOPS_MIN_ZOOM ? map.getBounds().pad(0.6) : null,
  );

  useEffect(() => {
    getStops().then(setStops).catch((e) => console.warn('Zastávky se nenačetly', e));
  }, []);

  useMapEvents({
    moveend: () => {
      if (map.getZoom() < STOPS_MIN_ZOOM) return setArea(null);
      const b = map.getBounds();
      setArea((cur) => (cur && cur.contains(b) ? cur : b.pad(0.6)));
    },
  });

  const visible = useMemo(() => {
    // Vybraná zastávka zůstane vidět i při oddálení.
    if (!area) return stops.filter((s) => s.id === selectedId);
    return stops.filter((s) => s.id === selectedId || area.contains([s.lat, s.lon]));
  }, [stops, area, selectedId]);

  return (
    <>
      {visible.map((s) => (
        <Marker
          key={s.id}
          position={[s.lat, s.lon]}
          icon={stopIcon(s.kind, s.id === selectedId)}
          zIndexOffset={s.id === selectedId ? 1500 : -1000}
          eventHandlers={{ click: () => onSelect?.(s) }}
        >
          <Tooltip direction="top">{s.name}</Tooltip>
        </Marker>
      ))}
    </>
  );
}
