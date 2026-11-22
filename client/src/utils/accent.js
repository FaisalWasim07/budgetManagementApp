// The colour a person sees the app in.
//
// Not the same thing as utils/palette.js, which holds the chart series —
// those are fixed on purpose and do not follow this.
//
// Each person picks their own, and it is stored on their account so it follows
// them between devices. It is also cached on the device, for one reason: the
// first frame. The session is not known until /auth/status answers, and without
// the cache every load would be mint for a moment and then change.
//
// The list must match server/src/services/accents.js (checked by
// test/api/accent.test.js) and the [data-accent] blocks in index.css.
// `swatch` is only for drawing the button that picks it.
export const ACCENTS = [
  { key: 'mint', label: 'Mint', swatch: ['#22c58e', '#0d9488'] },
  { key: 'ocean', label: 'Ocean', swatch: ['#38bdf8', '#0369a1'] },
  { key: 'indigo', label: 'Indigo', swatch: ['#818cf8', '#4338ca'] },
  { key: 'plum', label: 'Plum', swatch: ['#c084fc', '#7e22ce'] },
  { key: 'clay', label: 'Clay', swatch: ['#fb923c', '#9a3412'] },
  { key: 'moss', label: 'Moss', swatch: ['#84cc16', '#3f6212'] },
  { key: 'graphite', label: 'Graphite', swatch: ['#94a3b8', '#334155'] },
];

export const DEFAULT_ACCENT = 'mint';

const STORAGE_KEY = 'budget.accent';

const known = (key) => ACCENTS.some((a) => a.key === key);

// Anything unknown — a colour removed since it was saved, a stale cache — is
// treated as no choice at all rather than stamped onto the page.
export const resolveAccent = (key) => (known(key) ? key : DEFAULT_ACCENT);

export const accentLabel = (key) => ACCENTS.find((a) => a.key === resolveAccent(key)).label;

export function applyAccent(key) {
  document.documentElement.setAttribute('data-accent', resolveAccent(key));
}

export function loadAccent() {
  try {
    return resolveAccent(localStorage.getItem(STORAGE_KEY));
  } catch {
    return DEFAULT_ACCENT;
  }
}

export function saveAccent(key) {
  try {
    if (key == null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, resolveAccent(key));
  } catch {
    // Private browsing: the colour still applies, it just is not cached, so
    // the next load starts in mint until the session says otherwise.
  }
}
