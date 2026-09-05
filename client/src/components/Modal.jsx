import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../utils/scrollLock';

// A dialog, optionally in tabs.
//
// Tabs are not decoration here: Settings and sharing each hold four or five
// unrelated jobs, and stacking them made one box tall enough to need its own
// scrollbar — a scroll region inside a scroll region, which is the worst way to
// read anything. One job at a time fits, so nothing has to scroll at all.
//
// `tabs` is [key, label, render] triples. Give none and the children render as
// they always did.
// `bare` drops the title row entirely, for a dialog whose content is a page in
// its own right and brings its own header — a document has a filename and its
// own actions across the top, not a dialog title with an ✕ parked beside it.
// Escape still closes, and the child is expected to offer a way out of its own.
export default function Modal({
  title,
  onClose,
  tabs,
  initialTab,
  className = '',
  bare = false,
  children,
}) {
  // Whichever tab the opener asked for, so something that exists to send you to
  // one particular setting lands on it rather than on the first.
  const [active, setActive] = useState(
    tabs?.some(([key]) => key === initialTab) ? initialTab : (tabs?.[0]?.[0] ?? null)
  );
  const boxRef = useRef(null);
  // Captured during the first render, before the dialog exists to take focus —
  // read inside the effect it would already be whatever autoFocus grabbed, and
  // closing would then aim focus at a node that had just been removed.
  const opener = useRef(typeof document === 'undefined' ? null : document.activeElement);
  useScrollLock();

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Focus goes in when the dialog opens and comes back out when it closes.
  //
  // Without this, aria-modal is a claim the page does not honour: the keyboard
  // stays wherever it was, so Tab walks the page behind the dialog — reachable,
  // announced, and completely invisible under the scrim. On the way out, focus
  // returns to whatever opened the dialog, so closing one from a row does not
  // dump you back at the top of the document.
  useEffect(() => {
    const box = boxRef.current;
    // React applies autoFocus during commit, which has already happened by the
    // time this runs. So the question is not "what should be focused" but "did
    // anything inside already claim it" — moving focus unconditionally would
    // take it straight back off the amount field that asked for it.
    if (box && !box.contains(document.activeElement)) box.focus({ preventScroll: true });
    return () => opener.current?.focus?.({ preventScroll: true });
  }, []);

  // Tab is kept inside the dialog by looping it at both ends. Anything the
  // browser will not focus is filtered out, or the loop lands on a disabled
  // button and appears to swallow the key.
  const onKeyDown = (e) => {
    if (e.key !== 'Tab') return;
    const focusable = [
      ...boxRef.current.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      ),
    ].filter((el) => !el.disabled && el.offsetParent !== null);
    if (focusable.length === 0) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  const current = tabs?.find(([key]) => key === active);

  // Rendered into <body> rather than where it was called from. `position:
  // fixed` is relative to the nearest ancestor with a filter, transform or
  // backdrop-filter — and the top bar has one — so a dialog opened from up
  // there was being clipped to the height of the bar.
  return createPortal(
    <div className="backdrop" onClick={onClose}>
      <div
        className={`modal stack ${className}`.trim()}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        ref={boxRef}
        role="dialog"
        aria-modal="true"
        /* Focusable so it can hold focus itself when nothing inside asked for
           it, without ever becoming a Tab stop of its own. */
        tabIndex={-1}
      >
        {!bare && (
          <div className="spread">
            <h2>{title}</h2>
            <button className="subtle" onClick={onClose} aria-label="Close">
              ✕
            </button>
          </div>
        )}

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
