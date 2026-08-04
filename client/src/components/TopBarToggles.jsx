const ICON = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

function EyeIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8S1 12 1 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M17.9 17.9A10.1 10.1 0 0 1 12 20C5 20 1 12 1 12a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9.1 9.1 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2m-6.7-1.1a3 3 0 1 1-4.2-4.2" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

function SunIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="4.5" />
      <path d="M12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
    </svg>
  );
}

// Half-filled circle — the usual shorthand for "follow the system setting".
function AutoIcon() {
  return (
    <svg {...ICON} aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" stroke="none" />
    </svg>
  );
}

const THEME_ICON = { auto: AutoIcon, light: SunIcon, dark: MoonIcon };
const THEME_LABEL = { auto: 'Theme: follows your system', light: 'Theme: light', dark: 'Theme: dark' };

export default function TopBarToggles({ amountsHidden, onToggleAmounts, theme, onCycleTheme }) {
  const ThemeIcon = THEME_ICON[theme];

  return (
    <>
      <button
        className="icon-button"
        onClick={onToggleAmounts}
        title={amountsHidden ? 'Show amounts' : 'Hide amounts'}
        aria-label={amountsHidden ? 'Show amounts' : 'Hide amounts'}
        aria-pressed={amountsHidden}
      >
        {amountsHidden ? <EyeOffIcon /> : <EyeIcon />}
      </button>

      <button
        className="icon-button"
        onClick={onCycleTheme}
        title={`${THEME_LABEL[theme]} — click to change`}
        aria-label={THEME_LABEL[theme]}
      >
        <ThemeIcon />
      </button>
    </>
  );
}
