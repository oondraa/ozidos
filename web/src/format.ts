import type { VehicleKind } from './api';

export type DelayLevel = 'unknown' | 'early' | 'ontime' | 'late' | 'verylate';

export function delayLevel(sec: number | null): DelayLevel {
  if (sec == null) return 'unknown';
  if (sec <= -60) return 'early';
  if (sec < 180) return 'ontime';
  if (sec < 600) return 'late';
  return 'verylate';
}

export function formatDelay(sec: number | null): string {
  if (sec == null) return 'zpoždění neznámé';
  const min = Math.round(sec / 60);
  if (min === 0) return 'včas';
  if (min < 0) return `${-min} min napřed`;
  return `+${min} min`;
}

export function formatAgo(ms: number, now: number): string {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 60) return `před ${s} s`;
  return `před ${Math.round(s / 60)} min`;
}

export const KIND_LABEL: Record<VehicleKind, string> = {
  train: 'Vlak',
  bus: 'Bus IREDO',
  mhd: 'MHD Hradec',
};
