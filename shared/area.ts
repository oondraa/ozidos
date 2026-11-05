/**
 * Oblast, kterou OZIDOS sleduje – podle uživatele jen to, co potřebuje:
 * západ za Stěžery, sever za Všestary a Předměřice n. L., východ za Třebechovice p. O., jih za Čeperku.
 * Všechno mimo (vozidla, zastávky, Nextbike) se zahazuje. Společné pro server i web.
 */
export const BBOX = { w: 15.725, s: 50.115, e: 16.015, n: 50.275 } as const;

/** Nextbike „města“ (systémy), jejichž stanice leží v oblasti. */
export const NEXTBIKE_CITY_IDS = [682, 1140, 1253, 1254, 708, 768];

export function inBbox(lat: number, lon: number, b: { w: number; s: number; e: number; n: number } = BBOX): boolean {
  return lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e;
}
