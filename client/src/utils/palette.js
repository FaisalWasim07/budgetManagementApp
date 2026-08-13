// Chart colours, which are not brand colours.
//
// The brand is one hue family — mint, teal, aqua, deep teal — and a chart with
// two series needs two hues a person can tell apart, including a person who
// cannot see red and green apart. So the series palette is the brand's deep
// teal plus an amber, checked with the project's colour-blindness validator
// rather than chosen by eye:
//
//   deep teal #0D9488 ↔ amber #D97706
//     ΔE 12.5 protanopia · 24.3 normal vision   (floor is 8 / 15)
//     lightness, chroma and 3:1 contrast all pass against #FFFFFF *and*
//     against the dark navy surface #0F1C2E
//
// Passing against both surfaces is why there is one list here rather than a
// light one and a dark one. Blue and rose complete the four used by the
// where-the-month-went bar; that order is fixed and must never be cycled.
export const CATEGORICAL = ['#0D9488', '#D97706', '#2563EB', '#BE123C', '#7C3AED', '#0E7490', '#B45309', '#4338CA'];

// Magnitude, one hue, light→dark: the brand's own teal.
export const SEQUENTIAL = { light: '#0D9488', dark: '#22C58E' };

export function prefersDark() {
  if (typeof document !== 'undefined') {
    const set = document.documentElement.getAttribute('data-theme');
    if (set === 'dark') return true;
    if (set === 'light') return false;
  }
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export const categoricalColors = () => CATEGORICAL;

export function sequentialBlue() {
  return prefersDark() ? SEQUENTIAL.dark : SEQUENTIAL.light;
}

// Everything that is not a series: the axes, the grid, the tooltip. These do
// differ by theme, because they are chrome rather than data.
export const CHROME = {
  light: {
    surface: '#FFFFFF',
    textPrimary: '#0F172A',
    textSecondary: '#475569',
    muted: '#94A3B8',
    gridline: '#E9EFEF',
    baseline: '#E5E7EB',
  },
  dark: {
    surface: '#0F1C2E',
    textPrimary: '#F8FAFC',
    textSecondary: '#9FB0C3',
    muted: '#64798F',
    gridline: '#1E2C3E',
    baseline: '#203047',
  },
};

export function chrome() {
  return prefersDark() ? CHROME.dark : CHROME.light;
}
