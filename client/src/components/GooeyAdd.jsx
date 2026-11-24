import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowUp, Exchange, Plus } from './icons';

// The three things the + offers, each opening its own popup.
const OPTIONS = [
  { kind: 'expense', label: 'Spent', Icon: ArrowDown },
  { kind: 'income', label: 'Received', Icon: ArrowUp },
  { kind: 'transfer', label: 'Moved', Icon: Exchange },
];

// The + that adds money, with its three choices pulling out of it like liquid.
//
// The effect is an SVG filter on the layer the shapes are drawn in: the layer
// is blurred, then its alpha pushed hard so the blur becomes a crisp edge
// again, and wherever two shapes' blur overlaps becomes a bridge between them.
// That bridge stretching and snapping as the balls separate is the "goo". The
// icons and labels sit in a second layer laid over the first, so they stay
// sharp, and they are the real buttons.
//
// On a desk it sits in the top bar's corner and opens on hover, the balls
// coming out to its left, bottom-left and straight down, the only directions
// with room there; the page behind fades so a ball never sits on top of the
// month button. A phone has no hover, so a tap opens it and the balls fan up
// out of the tab bar. A click, or Enter, opens it on either; Escape and a tap
// anywhere else close it. Anyone who has asked for less motion gets the balls
// appearing in place, with no stretch.
export default function GooeyAdd({ variant = 'desk', disabled = false, canMove = true, onPick }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const main = useRef(null);
  // Whether a hover opened it. Moving onto the + opens it, and the click that
  // usually follows must not then close it again.
  const viaHover = useRef(false);

  useEffect(() => {
    if (!open) return undefined;
    document.body.classList.add('gooey-open', `gooey-open-${variant}`);
    const key = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        main.current?.focus();
      }
    };
    const outside = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', outside);
    return () => {
      document.body.classList.remove('gooey-open', `gooey-open-${variant}`);
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', outside);
    };
  }, [open, variant]);

  // Closed if it becomes unusable while open, e.g. the last account removed.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  const hover = variant === 'desk';
  const pick = (kind) => {
    setOpen(false);
    onPick(kind);
  };

  return (
    <div
      ref={box}
      className={`gooey-add gooey-${variant}${open ? ' open' : ''}`}
      onPointerEnter={(e) => {
        if (!hover || disabled || e.pointerType !== 'mouse') return;
        viaHover.current = true;
        setOpen(true);
      }}
      onPointerLeave={(e) => {
        if (!hover || e.pointerType !== 'mouse') return;
        viaHover.current = false;
        setOpen(false);
      }}
    >
      <svg className="gooey-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <filter id="bayt-goo">
          <feGaussianBlur in="SourceGraphic" stdDeviation="9" result="blur" />
          <feColorMatrix
            in="blur"
            mode="matrix"
            values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -10"
            result="goo"
          />
          <feComposite in="SourceGraphic" in2="goo" operator="atop" />
        </filter>
      </svg>

      <div className="gooey-layer gooey-shapes" aria-hidden="true">
        {OPTIONS.map((o, i) => (
          <span key={o.kind} className="gooey-blob" data-i={i + 1} />
        ))}
        <span className="gooey-blob main" />
      </div>

      <div className="gooey-layer">
        {OPTIONS.map((o, i) => {
          const off = o.kind === 'transfer' && !canMove;
          return (
            <button
              key={o.kind}
              type="button"
              className="gooey-opt"
              data-i={i + 1}
              data-kind={o.kind}
              tabIndex={open ? 0 : -1}
              aria-hidden={!open}
              aria-label={o.label}
              disabled={off}
              title={off ? 'Moving money needs a second account.' : undefined}
              onClick={() => pick(o.kind)}
            >
              <o.Icon size={variant === 'phone' ? 20 : 18} />
              <b>{o.label}</b>
            </button>
          );
        })}
        <button
          ref={main}
          type="button"
          className="gooey-main"
          aria-label="Add money"
          aria-expanded={open}
          aria-haspopup="true"
          disabled={disabled}
          onClick={() => {
            // The hover that came just before has already opened it, though
            // this render may not have seen that yet; either way, open.
            if (viaHover.current) {
              viaHover.current = false;
              setOpen(true);
              return;
            }
            setOpen((v) => !v);
          }}
        >
          <Plus size={variant === 'phone' ? 22 : 20} />
        </button>
      </div>

      {/* The page behind fades while it is open. On a phone a tap on it closes
          the balls; on a desk the pointer passes through, since moving off the
          balls is what closes them there. Portalled to the body, because the
          bars it sits in have a backdrop filter, which would trap a fixed
          layer inside them. */}
      {open &&
        createPortal(
          <div
            className={`gooey-scrim gooey-scrim-${variant}`}
            onClick={() => setOpen(false)}
            aria-hidden="true"
          />,
          document.body
        )}
    </div>
  );
}
