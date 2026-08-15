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

export const Search = ({ size = 15 }) => (
  <svg {...base(size)}>
    <circle cx="11" cy="11" r="7" {...stroke} />
    <path d="m20 20-3.5-3.5" {...stroke} />
  </svg>
);

// A list of things that happened.
export const List = ({ size = 21 }) => (
  <svg {...base(size)}>
    <path d="M4 7h16M4 12h16M4 17h10" {...stroke} strokeWidth="1.9" />
  </svg>
);

// A loop. This used to be the list glyph above, which meant Recurring and a
// money transfer were drawn with symbols that said nothing about either.
export const Repeat = ({ size = 21 }) => (
  <svg {...base(size)}>
    <path
      d="M17 3l3.5 3.5L17 10M3.5 12v-1.5a4 4 0 014-4h13M7 21l-3.5-3.5L7 14M20.5 12v1.5a4 4 0 01-4 4h-13"
      {...stroke}
      strokeWidth="1.8"
    />
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

// ── Category and account icons ───────────────────────────────────────
// Drawn on the same 24×24 grid at the same stroke weight as the rest, so a
// row of them reads as one family. They exist to make a list of money
// scannable: you find "the car one" faster than you read "Fuel".

export const Cart = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M3 4h2l2.2 9.5A2 2 0 0 0 9.1 15h7.6a2 2 0 0 0 2-1.6L20 7H6" {...stroke} strokeWidth="1.7" />
    <circle cx="9.5" cy="19" r="1.4" {...stroke} strokeWidth="1.7" />
    <circle cx="17" cy="19" r="1.4" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Car = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path
      d="M4 16v2M20 16v2M3 15l1.4-5A2 2 0 0 1 6.3 8.5h11.4a2 2 0 0 1 1.9 1.5L21 15v1.5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM6.5 12.5h2M15.5 12.5h2"
      {...stroke}
      strokeWidth="1.7"
    />
  </svg>
);

export const House = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M4 11l8-6.5 8 6.5v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Book = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10a2 2 0 0 1 2 2v13a2 2 0 0 0-2-1.6H4zM20 5.5A1.5 1.5 0 0 0 18.5 4H14a2 2 0 0 0-2 2v13a2 2 0 0 1 2-1.6h6z" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Heart = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M12 20s-7-4.4-7-9.2A4 4 0 0 1 12 8.2 4 4 0 0 1 19 10.8C19 15.6 12 20 12 20z" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Plane = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M10.5 13.5 4 11l1-2 6.5 1 4-4.2a2 2 0 0 1 2.9 2.8L14 12.6l1 6.4-2 1z" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Bolt = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M13 3 5 13.5h6L10.5 21 19 10.5h-6z" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Fork = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M7 3v7a2 2 0 0 0 4 0V3M9 12v9M17 3c-1.4 1.4-2 3-2 5s.6 3 2 3v10" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Play = ({ size = 19 }) => (
  <svg {...base(size)}>
    <rect x="3" y="5.5" width="18" height="13" rx="2.5" {...stroke} strokeWidth="1.7" />
    <path d="M10.5 9.8 15 12l-4.5 2.2z" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Shield = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M12 3.5 19 6v5.5c0 4.2-3 7.3-7 8.9-4-1.6-7-4.7-7-8.9V6z" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Bag = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M5 8h14l-1 11.2a1.6 1.6 0 0 1-1.6 1.3H7.6A1.6 1.6 0 0 1 6 19.2zM9 8V6.4A3 3 0 0 1 15 6.4V8" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Wallet = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M4 7.5A2 2 0 0 1 6 5.5h11a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2zM15.5 12.5H19" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Bank = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M4 9.5 12 4.5l8 5M6 10.5v7M10.5 10.5v7M13.5 10.5v7M18 10.5v7M3.5 20h17" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Vault = ({ size = 19 }) => (
  <svg {...base(size)}>
    <rect x="3.5" y="5" width="17" height="14" rx="2.5" {...stroke} strokeWidth="1.7" />
    <circle cx="11" cy="12" r="3.2" {...stroke} strokeWidth="1.7" />
    <path d="M11 8.8v-1M11 16.2v1M17 9.5v5" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Card = ({ size = 19 }) => (
  <svg {...base(size)}>
    <rect x="3" y="6" width="18" height="12" rx="2.5" {...stroke} strokeWidth="1.7" />
    <path d="M3 10h18M6.5 14.5h3" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Piggy = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M4.5 12.5A6 6 0 0 1 10.5 7h3a6 6 0 0 1 6 5.5V16h-2l-1 3h-2.5l-.5-2h-3l-.5 2H7l-1-3H4.5z" {...stroke} strokeWidth="1.7" />
    <circle cx="15.5" cy="11.5" r=".9" fill="currentColor" />
  </svg>
);

export const Tag = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M4 11V5.5A1.5 1.5 0 0 1 5.5 4H11l8.5 8.5a1.6 1.6 0 0 1 0 2.3l-4.7 4.7a1.6 1.6 0 0 1-2.3 0z" {...stroke} strokeWidth="1.7" />
    <circle cx="8" cy="8" r="1.2" {...stroke} strokeWidth="1.7" />
  </svg>
);

export const Trend = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M4 15.5 9 10l3.5 3.5L20 6M15.5 6H20v4.5" {...stroke} strokeWidth="1.8" />
  </svg>
);

export const ArrowIn = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M12 4v13m0 0 5-5m-5 5-5-5M4 20h16" {...stroke} strokeWidth="1.8" />
  </svg>
);

export const ArrowOut = ({ size = 19 }) => (
  <svg {...base(size)}>
    <path d="M12 20V7m0 0 5 5m-5-5-5 5M4 4h16" {...stroke} strokeWidth="1.8" />
  </svg>
);

// ── The mark ─────────────────────────────────────────────────────────
// Traced from the handoff's own logo: two rounded ribbons that together
// draw a house. The mint one runs from under the eaves, up the left
// wall, over the apex; the teal one comes back down the right side and
// stops short of it, leaving the gap that makes the roof read as folded
// rather than drawn.
//
// Geometry is in the source artwork's own units — the ribbons are 127
// wide in a 416×430 box — so it is the traced logo rather than an
// approximation of it, and it stays sharp at any size.
const RIBBON = { strokeWidth: 127, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' };

export const Mark = ({ size = 26 }) => (
  <svg
    width={size}
    height={(size * 434) / 420}
    viewBox="-2 -2 420 434"
    fill="none"
    aria-hidden="true"
  >
    <defs>
      <linearGradient id="bayt-mint" x1="0" y1="0.1" x2="0.85" y2="1">
        <stop offset="0" stopColor="#4FD3A0" />
        <stop offset=".55" stopColor="#22B492" />
        <stop offset="1" stopColor="#06998C" />
      </linearGradient>
      <linearGradient id="bayt-teal" x1="0.1" y1="0" x2="0.5" y2="1">
        <stop offset="0" stopColor="#3E9089" />
        <stop offset="1" stopColor="#0E5C67" />
      </linearGradient>
    </defs>
    <path d="M195.5 366 H63.5 V176.5 L207 64" stroke="url(#bayt-mint)" {...RIBBON} />
    {/* Slightly transparent, which is what darkens the apex where the two
        cross — the one place the logo shows a third colour. */}
    <path d="M207 64 L352 177.5 V366" stroke="url(#bayt-teal)" opacity=".88" {...RIBBON} />
  </svg>
);

// A circular arrow, open at the top so it reads as "again" rather than as the
// loop on the Recurring tab — the two sit on the same screen.
export const Refresh = ({ size = 17 }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d="M20 11a8 8 0 1 0-.6 4" />
    <path d="M20 4.5V11h-6" />
  </svg>
);
