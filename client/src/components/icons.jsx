// One place for the line icons, so a stroke width or a corner radius is never
// half-changed. Everything is drawn on a 24×24 grid and inherits currentColor.

const base = (size) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  'aria-hidden': 'true',
});

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

export const Chevron = ({ size = 15 }) => (
  <svg {...base(size)} className="chev">
    <path d="M9 6l6 6-6 6" {...stroke} strokeWidth="2.2" />
  </svg>
);

export const ChevronDown = ({ size = 12 }) => (
  <svg {...base(size)}>
    <path d="M6 9l6 6 6-6" {...stroke} strokeWidth="2.4" />
  </svg>
);

export const ChevronLeft = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M15 6l-6 6 6 6" {...stroke} strokeWidth="2.2" />
  </svg>
);

export const ChevronRight = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M9 6l6 6-6 6" {...stroke} strokeWidth="2.2" />
  </svg>
);

export const Eye = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" {...stroke} strokeWidth="1.8" />
    <circle cx="12" cy="12" r="2.8" {...stroke} strokeWidth="1.8" />
  </svg>
);

export const EyeOff = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path
      d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2m-6.7-1.1a3 3 0 1 1-4.2-4.2"
      {...stroke}
      strokeWidth="1.8"
    />
    <path d="M2 2l20 20" {...stroke} strokeWidth="1.8" />
  </svg>
);

export const Dots = ({ size = 19 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="5" r="1.7" fill="currentColor" />
    <circle cx="12" cy="12" r="1.7" fill="currentColor" />
    <circle cx="12" cy="19" r="1.7" fill="currentColor" />
  </svg>
);

export const Sun = ({ size = 17 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="4.5" {...stroke} />
    <path
      d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4"
      {...stroke}
    />
  </svg>
);

export const Moon = ({ size = 17 }) => (
  <svg {...base(size)}>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" {...stroke} />
  </svg>
);

// Half-filled circle — the usual shorthand for "follow the system setting".
export const Auto = ({ size = 17 }) => (
  <svg {...base(size)}>
    <circle cx="12" cy="12" r="9" {...stroke} />
    <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" />
  </svg>
);

export const Plus = ({ size = 22 }) => (
  <svg {...base(size)}>
    <path d="M12 5v14M5 12h14" {...stroke} strokeWidth="2.6" />
  </svg>
);

export const Home = ({ size = 21 }) => (
  <svg {...base(size)}>
    <path d="M4 11l8-6 8 6v8a1 1 0 01-1 1h-4v-6h-6v6H5a1 1 0 01-1-1z" {...stroke} strokeWidth="1.8" />
  </svg>
);

export const Bars = ({ size = 21 }) => (
  <svg {...base(size)}>
    <path d="M5 19V10M12 19V5M19 19v-6" {...stroke} />
  </svg>
);

export const Repeat = ({ size = 21 }) => (
  <svg {...base(size)}>
    <path d="M4 7h16M4 12h16M4 17h10" {...stroke} strokeWidth="1.9" />
  </svg>
);

// Two arrows passing each other: money going one way out of an account and
// arriving in another.
export const Exchange = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M4 8h15m0 0l-4-4m4 4l-4 4M20 16H5m0 0l4-4m-4 4l4 4" {...stroke} strokeWidth="1.8" />
  </svg>
);

export const Pencil = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M4 20h4L19.5 8.5a2.1 2.1 0 0 0-3-3L5 17v3z" {...stroke} strokeWidth="1.8" />
  </svg>
);

export const Trash = ({ size = 15 }) => (
  <svg {...base(size)}>
    <path d="M4 7h16M9 7V5h6v2M6 7l1 13h10l1-13M10 11v6M14 11v6" {...stroke} strokeWidth="1.8" />
  </svg>
);
