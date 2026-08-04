// Theme is one of 'auto' | 'light' | 'dark'.
//
// 'auto' removes the data-theme attribute entirely, which hands control back to
// the prefers-color-scheme media query in index.css. The other two stamp the
// attribute, and the CSS is written so an explicit choice beats the OS setting
// in both directions.
export const THEMES = ['auto', 'light', 'dark'];

const STORAGE_KEY = 'budget.theme';

export function applyTheme(theme) {
  const root = document.documentElement;
  if (theme === 'auto') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

export function loadTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(stored) ? stored : 'auto';
  } catch {
    return 'auto';
  }
}

export function saveTheme(theme) {
  try {
    localStorage.setItem(STORAGE_KEY, theme);
  } catch {
    // Private browsing or storage disabled — the theme still applies for this
    // session, it just won't be remembered.
  }
}

export const nextTheme = (theme) => THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length];
