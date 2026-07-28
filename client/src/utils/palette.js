// Reference categorical palette from the project's dataviz skill (validated:
// worst adjacent CVD deltaE 9.1 light / 8.4 dark, both above the 8 target).
// Hue order is fixed and must never be cycled or reassigned per-render.
export const CATEGORICAL = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
};

export const SEQUENTIAL_BLUE = {
  light: '#2a78d6',
  dark: '#3987e5',
};

export function prefersDark() {
  return typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false;
}

export function categoricalColors() {
  return prefersDark() ? CATEGORICAL.dark : CATEGORICAL.light;
}

export function sequentialBlue() {
  return prefersDark() ? SEQUENTIAL_BLUE.dark : SEQUENTIAL_BLUE.light;
}

export const CHROME = {
  light: {
    surface: '#fcfcfb',
    textPrimary: '#0b0b0b',
    textSecondary: '#52514e',
    muted: '#898781',
    gridline: '#e1e0d9',
    baseline: '#c3c2b7',
  },
  dark: {
    surface: '#1a1a19',
    textPrimary: '#ffffff',
    textSecondary: '#c3c2b7',
    muted: '#898781',
    gridline: '#2c2c2a',
    baseline: '#383835',
  },
};

export function chrome() {
  return prefersDark() ? CHROME.dark : CHROME.light;
}
