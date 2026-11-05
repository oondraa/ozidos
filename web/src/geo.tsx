import { useEffect, useState } from 'react';
import { Circle, CircleMarker } from 'react-leaflet';

export interface GeoState {
  pos: [number, number] | null;
  accuracy: number | null;
  error: string | null;
}

/**
 * Sleduje polohu telefonu/PC. Pozor: prohlížeč polohu dá jen přes HTTPS nebo na localhost.
 */
export function useGeolocation(): GeoState {
  const [state, setState] = useState<GeoState>({ pos: null, accuracy: null, error: null });
  useEffect(() => {
    if (!('geolocation' in navigator)) {
      setState((s) => ({ ...s, error: 'Prohlížeč polohu neumí' }));
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (p) => setState({ pos: [p.coords.latitude, p.coords.longitude], accuracy: p.coords.accuracy, error: null }),
      (e) =>
        setState((s) => ({
          ...s,
          error: e.code === e.PERMISSION_DENIED ? 'Poloha není povolená' : 'Polohu se nepodařilo zjistit',
        })),
      { enableHighAccuracy: true, maximumAge: 15_000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, []);
  return state;
}

/** Modrá tečka „tady jsem“ s kruhem přesnosti. */
export function MyLocation({ geo }: { geo: GeoState }) {
  if (!geo.pos) return null;
  return (
    <>
      {geo.accuracy != null && geo.accuracy < 2000 && (
        <Circle
          center={geo.pos}
          radius={geo.accuracy}
          interactive={false}
          pathOptions={{ color: '#3b82f6', weight: 1, fillColor: '#3b82f6', fillOpacity: 0.12 }}
        />
      )}
      <CircleMarker
        center={geo.pos}
        radius={8}
        interactive={false}
        pathOptions={{ color: '#fff', weight: 3, fillColor: '#2563eb', fillOpacity: 1 }}
      />
    </>
  );
}
