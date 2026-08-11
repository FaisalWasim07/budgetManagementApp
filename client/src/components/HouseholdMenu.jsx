import { useEffect, useRef, useState } from 'react';

const ROLE_LABEL = { owner: 'owner', editor: 'can edit', viewer: 'view only' };

// The household switcher. Sits in the top bar next to the tabs, because which
// household you are looking at changes everything below it and should never be
// in doubt.
export default function HouseholdMenu({ households, current, onSwitch, onAdd, onManage }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (!ref.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="household-menu" ref={ref}>
      <button
        className="household-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title="Switch household"
      >
        <span className="household-name">{current?.name ?? 'No household'}</span>
        {current && current.role !== 'owner' && (
          <span className="badge">{ROLE_LABEL[current.role]}</span>
        )}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
      </button>

      {open && (
        <div className="household-dropdown card">
          {households.map((household) => (
            <button
              key={household.id}
              className={household.id === current?.id ? 'household-option active' : 'household-option'}
              onClick={() => {
                setOpen(false);
                onSwitch(household.id);
              }}
            >
              <span className="grow">{household.name}</span>
              <span className="muted" style={{ fontSize: '0.75rem' }}>
                {ROLE_LABEL[household.role]}
              </span>
            </button>
          ))}

          <hr className="divider" style={{ margin: '8px 0' }} />

          <button
            className="household-option"
            onClick={() => {
              setOpen(false);
              onManage();
            }}
          >
            People &amp; sharing…
          </button>
          <button
            className="household-option"
            onClick={() => {
              setOpen(false);
              onAdd();
            }}
          >
            + New or join a household
          </button>
        </div>
      )}
    </div>
  );
}
