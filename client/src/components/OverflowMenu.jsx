import Menu from './Menu';
import { Auto, Dots, Moon, Sun } from './icons';

const THEME_ICON = { auto: Auto, light: Sun, dark: Moon };
const THEME_LABEL = { auto: 'Theme: follows your system', light: 'Theme: light', dark: 'Theme: dark' };

// Everything that isn't the household, the month or the eye. The old top bar
// had nine controls competing with the figures; these five are the ones you
// touch once a week rather than once a minute.
export default function OverflowMenu({
  theme,
  onCycleTheme,
  onSettings,
  onSharing,
  onSignOut,
  username,
  // In the sidebar this sits at the foot of a full-height column, so a panel
  // that opens downwards opens off the bottom of the screen.
  align = 'right',
}) {
  const ThemeIcon = THEME_ICON[theme];

  return (
    <Menu
      align={align}
      trigger={({ open, toggle }) => (
        <button
          className="icon-button"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          aria-label="Menu"
          title="Menu"
        >
          <Dots />
        </button>
      )}
    >
      {({ close }) => (
        <>
          <button onClick={onCycleTheme}>
            <ThemeIcon />
            <span className="grow">{THEME_LABEL[theme]}</span>
          </button>
          <hr />
          <button
            onClick={() => {
              close();
              onSharing();
            }}
          >
            People &amp; sharing…
          </button>
          <button
            onClick={() => {
              close();
              onSettings();
            }}
          >
            Settings
          </button>
          <hr />
          <button
            onClick={() => {
              close();
              onSignOut();
            }}
          >
            <span className="grow">Sign out</span>
            <span className="muted" style={{ fontSize: '0.75rem' }}>
              {username}
            </span>
          </button>
        </>
      )}
    </Menu>
  );
}
