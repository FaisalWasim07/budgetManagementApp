import { useState } from 'react';

// When the first splash of this page load appeared. A cold open shows the
// splash twice back to back, once while finding out whether you are signed in
// (AuthGate) and once while loading your households (App), and those are two
// separate mounts. Without this the drawing would start again from nothing
// halfway through; with it, the second picks up where the first had got to.
let startedAt = null;

// The mark, drawing itself: the mint stroke from the base up the left wall to
// the peak, the teal one up the right wall to meet it, a small settle, then a
// light sweeping across. About two seconds, once. The stops follow the
// person's accent the way the static mark's do, and someone who has asked for
// less motion gets the finished mark with nothing moving. The timings live in
// index.css under `.splash-mark`.
function DrawnMark() {
  return (
    <svg
      className="splash-mark"
      width="96"
      height="99"
      viewBox="-12 -12 440 454"
      fill="none"
      role="img"
      aria-label="Bayt"
    >
      <defs>
        <linearGradient id="splash-mint" x1="0" y1="0.1" x2="0.85" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--mark-1)' }} />
          <stop offset=".55" style={{ stopColor: 'var(--mark-2)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mark-3)' }} />
        </linearGradient>
        <linearGradient id="splash-teal" x1="0.1" y1="0" x2="0.5" y2="1">
          <stop offset="0" style={{ stopColor: 'var(--mark-4)' }} />
          <stop offset="1" style={{ stopColor: 'var(--mark-5)' }} />
        </linearGradient>
        <linearGradient id="splash-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#fff" stopOpacity="0" />
          <stop offset=".5" stopColor="#fff" stopOpacity=".38" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <mask id="splash-shape" maskUnits="userSpaceOnUse" x="-12" y="-12" width="440" height="454">
          <path
            d="M195.5 366 H63.5 V176.5 L207 64 L352 177.5 V366"
            stroke="#fff"
            strokeWidth="127"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </mask>
      </defs>

      <g className="splash-whole">
        <path
          className="splash-stroke splash-mint"
          pathLength="1"
          d="M195.5 366 H63.5 V176.5 L207 64"
          stroke="url(#splash-mint)"
          strokeWidth="127"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Slightly transparent, which is what darkens the apex where the two
            cross, as in the static mark. */}
        <path
          className="splash-stroke splash-teal"
          pathLength="1"
          d="M352 366 V177.5 L207 64"
          stroke="url(#splash-teal)"
          strokeWidth="127"
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity=".88"
        />
        <g mask="url(#splash-shape)">
          <g transform="skewX(-18)">
            <rect className="splash-sheen" x="-120" y="-40" width="160" height="520" fill="url(#splash-sheen)" />
          </g>
        </g>
      </g>
    </svg>
  );
}

// What the app is while it finds out whether you are signed in and which
// households you are in. The mark drawing itself carries the wait; the name
// comes in as it finishes, and a spinner only if the wait outlasts it, so a
// quick open never shows one at all.
export default function Splash() {
  const [offset] = useState(() => {
    const now = performance.now();
    if (startedAt === null) startedAt = now;
    return (now - startedAt) / 1000;
  });

  return (
    <div className="splash" style={{ '--splash-offset': `${-offset}s` }}>
      <DrawnMark />
      <span className="wordmark">Bayt</span>
      <span className="spinner" role="status" aria-label="Loading" />
    </div>
  );
}
