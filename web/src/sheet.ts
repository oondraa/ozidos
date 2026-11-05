/**
 * Spodní vysouvací panel na telefonu (jako Mapy Google): tahá se prstem za lištu,
 * po puštění „docvakne“ do nejbližší polohy – dole (jen lišta), půlka, nahoře.
 * Rychlé švihnutí nahoru/dolů posune o polohu dál. Klepnutí přepíná dole ↔ půlka.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

export type SheetLevel = 'peek' | 'half' | 'full';

const MOBILE_QUERY = '(max-width: 700px)';
/** Výška lišty s logem, když je panel dole. */
const PEEK_PX = 64;
/** Rychlost švihnutí (px/ms), od které se poloha přeskočí ve směru pohybu. */
const FLICK_SPEED = 0.5;

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY);
    const on = () => setMobile(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return mobile;
}

function useViewportHeight(): number {
  const [h, setH] = useState(() => window.innerHeight);
  useEffect(() => {
    const on = () => setH(window.innerHeight);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return h;
}

export function useBottomSheet(initial: SheetLevel = 'half') {
  const isMobile = useIsMobile();
  const vh = useViewportHeight();
  const [level, setLevel] = useState<SheetLevel>(initial);
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; t: number; lastY: number; lastT: number; moved: boolean } | null>(null);

  const heights: Record<SheetLevel, number> = {
    peek: PEEK_PX,
    half: Math.round(vh * 0.5),
    full: Math.round(vh * 0.9),
  };
  const height = dragH ?? heights[level];

  const onPointerDown = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      if (!isMobile) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      const now = performance.now();
      drag.current = { y: e.clientY, h: heights[level], t: now, lastY: e.clientY, lastT: now, moved: false };
    },
    [isMobile, level, heights.half, heights.full],
  );

  const onPointerMove = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      if (!d) return;
      const dy = e.clientY - d.y;
      if (Math.abs(dy) > 6) d.moved = true;
      if (!d.moved) return;
      d.lastY = e.clientY;
      d.lastT = performance.now();
      setDragH(Math.max(PEEK_PX, Math.min(heights.full, d.h - dy)));
    },
    [heights.full],
  );

  const onPointerUp = useCallback(
    (e: PointerEvent<HTMLElement>) => {
      const d = drag.current;
      drag.current = null;
      if (!d) return;
      if (!d.moved) {
        // klepnutí na lištu
        setLevel((l) => (l === 'peek' ? 'half' : 'peek'));
        setDragH(null);
        return;
      }
      const h = Math.max(PEEK_PX, Math.min(heights.full, d.h - (e.clientY - d.y)));
      const speed = (d.lastY - e.clientY) / Math.max(1, performance.now() - d.lastT + 16); // + = nahoru
      const order: SheetLevel[] = ['peek', 'half', 'full'];
      let next: SheetLevel;
      if (Math.abs(speed) > FLICK_SPEED) {
        // švihnutí: o polohu dál ve směru pohybu od místa, kde prst začal
        const from = order.indexOf(level);
        next = order[Math.max(0, Math.min(2, from + (speed > 0 ? 1 : -1)))];
      } else {
        next = order.reduce((best, l) => (Math.abs(heights[l] - h) < Math.abs(heights[best] - h) ? l : best), 'peek');
      }
      setLevel(next);
      setDragH(null);
    },
    [level, heights.half, heights.full],
  );

  /** Ukázat obsah (např. po kliknutí na bus) – panel dole se vysune do půlky. */
  const reveal = useCallback(() => setLevel((l) => (l === 'peek' ? 'half' : l)), []);

  return {
    isMobile,
    level,
    setLevel,
    reveal,
    height,
    dragging: dragH != null,
    handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
