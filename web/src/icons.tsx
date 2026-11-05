/**
 * Ikony OZIDOS – jednotná sada obrysových SVG (24×24, čára 1,8, barva = currentColor).
 * Místo emoji: vypadají všude stejně (Windows/Android/iOS) a ladí s písmem.
 */
import type { ReactNode, SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="icon"
      {...rest}
    >
      {children}
    </svg>
  );
}

/** Zaměřovač – „kde jsem“. */
export const IconLocate = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="7" />
    <circle cx="12" cy="12" r="2.6" fill="currentColor" stroke="none" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3" />
  </Svg>
);

/** Moje poloha (navigační šipka). */
export const IconNavigation = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 11.5 20 4l-7.5 16-2-6.5z" fill="currentColor" fillOpacity={0.15} />
  </Svg>
);

export const IconHome = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4.5v-5.5h-5V20H5a1 1 0 0 1-1-1z" />
  </Svg>
);

export const IconStar = (p: IconProps) => (
  <Svg {...p}>
    <path d="m12 4 2.4 4.9 5.4.8-3.9 3.8.9 5.4L12 16.4l-4.8 2.5.9-5.4-3.9-3.8 5.4-.8z" />
  </Svg>
);

export const IconHistory = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5" />
    <path d="M4 4v4.5h4.5M12 8v4.2l3 1.8" />
  </Svg>
);

/** Označník zastávky. */
export const IconStop = (p: IconProps) => (
  <Svg {...p}>
    <rect x="6" y="3" width="12" height="9" rx="2" />
    <path d="M12 12v9M9 21h6M9 7.5h6" />
  </Svg>
);

export const IconPin = (p: IconProps) => (
  <Svg {...p}>
    <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
    <circle cx="12" cy="10" r="2.3" />
  </Svg>
);

export const IconSwap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M8 4v15M4.5 7.5 8 4l3.5 3.5M16 20V5M12.5 16.5 16 20l3.5-3.5" />
  </Svg>
);

export const IconClose = (p: IconProps) => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Svg>
);

export const IconChevron = ({ dir = 'down', ...p }: IconProps & { dir?: 'down' | 'up' | 'left' | 'right' }) => {
  const d = { down: 'M6 9l6 6 6-6', up: 'M6 15l6-6 6 6', left: 'M15 6l-6 6 6 6', right: 'M9 6l6 6-6 6' }[dir];
  return (
    <Svg {...p}>
      <path d={d} />
    </Svg>
  );
};

export const IconArrowRight = (p: IconProps) => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
);

/** Chodec. */
export const IconWalk = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="13" cy="4.5" r="1.7" fill="currentColor" stroke="none" />
    <path d="M9.5 21l2.2-6.2 2.8 2.7V21M8 12.5l1.8-4.2 3.6-.8 2 3.4 2.6 1.1M11.7 14.8 13.4 7.5" />
  </Svg>
);

/** Posuvníky – nastavení vrstev. */
export const IconSliders = (p: IconProps) => (
  <Svg {...p}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </Svg>
);

export const IconMap = (p: IconProps) => (
  <Svg {...p}>
    <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6z" />
    <path d="M9 4v14M15 6v14" />
  </Svg>
);

export const IconSatellite = (p: IconProps) => (
  <Svg {...p}>
    <path d="m13 7 4 4-6 6-4-4z" />
    <path d="m15 5 2-2 4 4-2 2M9 15l-2 2-4-4 2-2M16 16a4 4 0 0 1-1.2 2.8M19 16a7 7 0 0 1-2.1 5" />
  </Svg>
);

export const IconCity = (p: IconProps) => (
  <Svg {...p}>
    <path d="M3 20h18M5 20V9l5-3v14M10 20V4h9v16M13.5 8h2M13.5 11.5h2M13.5 15h2" />
  </Svg>
);

export const IconSearch = (p: IconProps) => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </Svg>
);
