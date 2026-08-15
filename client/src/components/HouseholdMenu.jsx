import Menu from './Menu';
import { ChevronDown } from './icons';

const ROLE_LABEL = { owner: 'owner', editor: 'can edit', viewer: 'view only' };

// The household switcher, first thing in the top bar: which household you are
// looking at changes every figure below it and should never be in doubt.
export default function HouseholdMenu({ households, current, onSwitch, onAdd, onManage, badge = false }) {
  return (
    <Menu
      trigger={({ open, toggle }) => (
        <button
          className="household-trigger"
          onClick={toggle}
          aria-expanded={open}
          aria-haspopup="menu"
          title="Switch household"
        >
          {/* In the sidebar the switcher is a pill with the household's own
              initial, the way it was drawn. In a phone's top bar there is no
              room for one. */}
          {badge && (
            <span className="household-badge" aria-hidden="true">
              {(current?.name ?? '?').trim().charAt(0).toUpperCase()}
            </span>
          )}
          <span className="household-name">{current?.name ?? 'No household'}</span>
          {/* Not on a phone: a banner under the bar already says you are
              view-only, and the role is in the menu this opens. */}
          {current && current.role !== 'owner' && (
            <span className="badge role">{ROLE_LABEL[current.role]}</span>
          )}
          <ChevronDown />
        </button>
      )}
    >
      {({ close }) => (
        <>
          {households.map((household) => (
            <button
              key={household.id}
              className={household.id === current?.id ? 'active' : ''}
              onClick={() => {
                close();
                onSwitch(household.id);
              }}
            >
              <span className="grow">{household.name}</span>
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                {ROLE_LABEL[household.role]}
              </span>
            </button>
          ))}

          <hr />

          <button
            onClick={() => {
              close();
              onManage();
            }}
          >
            People &amp; sharing…
          </button>
          <button
            onClick={() => {
              close();
              onAdd();
            }}
          >
            + New or join a household
          </button>
        </>
      )}
    </Menu>
  );
}
