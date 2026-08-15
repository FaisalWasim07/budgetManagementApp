import { useEffect, useRef, useState } from 'react';

// A button that opens a panel beneath it, and the dismissal rules that go with
// one: click anywhere else, or press Escape. Both the household switcher and
// the overflow menu are this, so neither has to remember the rules.
export default function Menu({ align = 'left', trigger, children }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const away = (e) => {
      if (!wrap.current?.contains(e.target)) setOpen(false);
    };
    const escape = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  return (
    <div className="menu-wrap" ref={wrap}>
      {trigger({ open, toggle: () => setOpen((v) => !v) })}
      {open && (
        <div className={align === 'left' ? 'menu' : `menu ${align}`} role="menu">
          {children({ close: () => setOpen(false) })}
        </div>
      )}
    </div>
  );
}
