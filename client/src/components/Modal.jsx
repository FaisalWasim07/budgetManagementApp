import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

// A dialog, optionally in tabs.
//
// Tabs are not decoration here: Settings and sharing each hold four or five
// unrelated jobs, and stacking them made one box tall enough to need its own
// scrollbar — a scroll region inside a scroll region, which is the worst way to
// read anything. One job at a time fits, so nothing has to scroll at all.
//
// `tabs` is [key, label, render] triples. Give none and the children render as
// they always did.
export default function Modal({ title, onClose, tabs, children }) {
  const [active, setActive] = useState(tabs?.[0]?.[0] ?? null);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const current = tabs?.find(([key]) => key === active);

  // Rendered into <body> rather than where it was called from. `position:
  // fixed` is relative to the nearest ancestor with a filter, transform or
  // backdrop-filter — and the top bar has one — so a dialog opened from up
  // there was being clipped to the height of the bar.
  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <div
        className="modal stack"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <div className="spread">
          <h2>{title}</h2>
          <button className="subtle" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        {tabs && (
          <div className="modal-tabs" role="tablist">
            {tabs.map(([key, label]) => (
              <button
                key={key}
                role="tab"
                aria-selected={key === active}
                className={key === active ? 'active' : ''}
                onClick={() => setActive(key)}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {current ? current[2]() : children}
      </div>
    </div>,
    document.body
  );
}
