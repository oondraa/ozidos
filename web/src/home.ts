/**
 * Domov uživatele – NENÍ v kódu (repo je veřejné). Nastaví se v aplikaci a uloží jen
 * v tomhle prohlížeči (localStorage; v nainstalované PWA přežije i zavření aplikace).
 */
import { useSyncExternalStore } from 'react';

export interface Home {
  name: string;
  lat: number;
  lon: number;
}

const KEY = 'ozidos.home';
const listeners = new Set<() => void>();

function read(): Home | null {
  try {
    const h = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    return h && typeof h.lat === 'number' && typeof h.lon === 'number' ? h : null;
  } catch {
    return null;
  }
}

let current = read();

export function setHome(h: Home | null): void {
  current = h;
  if (h) localStorage.setItem(KEY, JSON.stringify(h));
  else localStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

/** Aktuální domov (nebo null, dokud ho uživatel nenastaví). */
export function useHome(): Home | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      // změna v jiné záložce
      const onStorage = (e: StorageEvent) => {
        if (e.key === KEY) {
          current = read();
          l();
        }
      };
      window.addEventListener('storage', onStorage);
      return () => {
        listeners.delete(l);
        window.removeEventListener('storage', onStorage);
      };
    },
    () => current,
  );
}
