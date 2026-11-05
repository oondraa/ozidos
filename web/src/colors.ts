import type { VehicleKind } from './api';

/**
 * Barvy podle skutečných vozů: MHD Hradec = červená, IREDO = tmavě modrá s tyrkysovým pruhem.
 * Stejné hodnoty jsou v CSS proměnných --mhd / --bus / --train (styles.css).
 */
export const KIND_COLOR: Record<VehicleKind, string> = {
  mhd: '#dc2626',
  bus: '#1e40af',
  train: '#7c3aed',
};

/** Karoserie shora: [bok, střed střechy, doplňkový pruh]. */
export const BODY: Record<VehicleKind, [string, string, string]> = {
  mhd: ['#991b1b', '#ef4444', '#fee2e2'],
  bus: ['#172554', '#1e40af', '#2dd4bf'],
  train: ['#4c1d95', '#8b5cf6', '#ede9fe'],
};

/** Nextbike: tmavě modrý rám, stříbrná kola. */
export const NEXTBIKE_BLUE = '#0b4ea2';
