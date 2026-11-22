import { useEffect, useRef, useState } from 'react';
import SettingsSection from './SettingsSection';
import { ACCENTS, accentLabel, resolveAccent } from '../utils/accent';
import { setAccent } from '../api/auth';
import { Check, ChevronDown, Palette } from './icons';

const swatchOf = (key) => {
  const a = ACCENTS.find((x) => x.key === key) ?? ACCENTS[0];
  return `linear-gradient(135deg, ${a.swatch[0]}, ${a.swatch[1]})`;
};

// Which colour the app is in, for this person: a picker on the card's own top
// line, the current colour as a dot beside its name.
//
// The change is applied the instant one is picked and saved behind it, because
// the whole point is to see it: a picker that waits on the network before
// showing you the colour you chose is a worse way of finding out what it looks
// like. If the save fails the screen goes back to what was stored, so what you
// see is never a colour the next device will not agree with.
//
// The list is real radio inputs, so the arrow keys move between them and a
// screen reader hears "Ocean, 2 of 7, selected" without anything here having
// to reimplement that. Escape closes the list without closing Settings.
export default function AccentSettings({ accent, onChange }) {
  const [error, setError] = useState(null);
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  const current = resolveAccent(accent);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => {
      if (!box.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  async function pick(key) {
    if (key === current) return;
    const before = accent ?? null;
    setError(null);
    onChange(key);
    try {
      await setAccent(key);
    } catch (err) {
      onChange(before);
      setError(`That colour wasn’t saved, so it’s back to ${accentLabel(before)}. ${err.message}`);
    }
  }

  const picker = (
    <div
      className="accent-dropdown"
      ref={box}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="accent-select"
        aria-haspopup="true"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="accent-dot" style={{ '--swatch': swatchOf(current) }} aria-hidden="true" />
        <span className="set-section-state">{accentLabel(accent)}</span>
        <ChevronDown size={13} />
      </button>
      {open && (
        <div className="accent-menu" role="radiogroup" aria-label="Colour">
          {ACCENTS.map((a) => (
            <label key={a.key} className="accent-swatch" style={{ '--swatch': swatchOf(a.key) }}>
              <input
                type="radio"
                name="accent"
                value={a.key}
                checked={a.key === current}
                onChange={() => pick(a.key)}
              />
              <span className="accent-dot" aria-hidden="true" />
              <span className="accent-name">{a.label}</span>
              {a.key === current && <Check size={14} />}
            </label>
          ))}
        </div>
      )}
    </div>
  );

  return (
    <>
      <SettingsSection
        icon={<Palette />}
        title="Colour"
        subtitle="Yours only. It follows you to every device you sign in on."
        action={picker}
      />
      {error && <div className="error-text">{error}</div>}
    </>
  );
}
