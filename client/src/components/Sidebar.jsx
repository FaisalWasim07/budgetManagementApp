import HouseholdMenu from './HouseholdMenu';
import OverflowMenu from './OverflowMenu';
import { Mark } from './icons';

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
  onCycleTheme,
  onSettings,
  onSharing,
  onSignOut,
}) {
  return (
    <aside className="sidebar">
      <span className="brand">
        <Mark size={24} />
        <span className="wordmark">Bayt</span>
      </span>

      <HouseholdMenu
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
          >
            <Icon size={18} />
            {label}
          </button>
        ))}
      </nav>

      <span className="spacer" />

      {/* Theme, Settings, People & sharing and Sign out. They lived in the top
          bar; with navigation gone from it there is no bar left to hold them. */}
      <div className="side-you">
        <span className="side-you-name">{username}</span>
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
