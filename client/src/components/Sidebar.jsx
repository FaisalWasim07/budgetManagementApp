import HouseholdMenu from './HouseholdMenu';
import OverflowMenu from './OverflowMenu';
import { ChevronLeft, Mark } from './icons';

// The desktop shell. A phone's bottom bar squeezed into a laptop wasted the
// width and left the top bar holding nine controls; here navigation has a
// column of its own, and the household — which scopes everything below it —
// sits above the links it scopes.
export default function Sidebar({
  pages,
  page,
  onPage,
  households,
  household,
  onSwitchHousehold,
  onAddHousehold,
  onManageHousehold,
  theme,
  username,
  // The name of the person this login is in the current household — "Faisal"
  // rather than the login "fslwsm". The username is still what signs in, so
  // it stays on hover; but the sidebar is saying who you are here, and in a
  // household that is a name.
  displayName,
  role,
  collapsed = false,
  onToggleCollapsed,
  onCycleTheme,
  onSettings,
  onSharing,
  onSignOut,
}) {
  return (
    <aside className="sidebar">
      {/* Only drawn while the pointer is over the sidebar (or it has keyboard
          focus): a control that matters only when you are already reaching
          for the navigation, and clutter the rest of the time. On the seam
          between the sidebar and the page, because that seam is what it moves. */}
      <button
        type="button"
        className="side-toggle"
        onClick={onToggleCollapsed}
        aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
        aria-expanded={!collapsed}
        title={collapsed ? 'Expand' : 'Collapse'}
      >
        <ChevronLeft size={14} />
      </button>

      <span className="brand">
        <Mark size={24} />
        <span className="wordmark">Bayt</span>
      </span>

      <HouseholdMenu
        badge
        households={households}
        current={household}
        onSwitch={onSwitchHousehold}
        onAdd={onAddHousehold}
        onManage={onManageHousehold}
      />

      <nav className="side-nav" aria-label="Sections">
        {pages.map(([key, label, Icon]) => (
          <button
            key={key}
            className={page === key ? 'active' : ''}
            aria-current={page === key ? 'page' : undefined}
            onClick={() => onPage(key)}
            // Collapsed to icons, the label is only there for a screen reader;
            // this is how everyone else finds out what an icon is.
            title={collapsed ? label : undefined}
          >
            <Icon size={18} />
            <span className="side-label">{label}</span>
          </button>
        ))}
      </nav>

      <span className="spacer" />

      {/* Theme, Settings, People & sharing and Sign out. They lived in the top
          bar; with navigation gone from it there is no bar left to hold them. */}
      <div className="side-you" title={`Signed in as ${username}`}>
        <span className="avatar" aria-hidden="true">
          {(displayName || username).trim().charAt(0).toUpperCase()}
        </span>
        <span className="side-you-name">
          <b>{displayName || username}</b>
          <small>{role}</small>
        </span>
        <OverflowMenu
          align="up"
          theme={theme}
          username={username}
          onCycleTheme={onCycleTheme}
          onSettings={onSettings}
          onSharing={onSharing}
          onSignOut={onSignOut}
        />
      </div>
    </aside>
  );
}
