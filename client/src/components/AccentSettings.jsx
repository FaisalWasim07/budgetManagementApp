import { useState } from 'react';
import SettingsSection from './SettingsSection';
import { ACCENTS, accentLabel, resolveAccent } from '../utils/accent';
import { setAccent } from '../api/auth';

// Which colour the app is in, for this person.
//
// The change is applied the instant a swatch is pressed and saved behind it,
// because the whole point is to see it: a picker that waits on the network
// before showing you the colour you tapped is a worse way of finding out what
// it looks like. If the save fails the screen goes back to what was stored, so
// what you see is never a colour the next device will not agree with.
//
// Real radio inputs under the swatches, so the arrow keys move between them and
// a screen reader hears "Ocean, 2 of 7, selected" without anything here having
// to reimplement that.
export default function AccentSettings({ accent, onChange }) {
  const [error, setError] = useState(null);
  const current = resolveAccent(accent);

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

  return (
    <SettingsSection
      title="Colour"
      state={
        <span className="accent-state">
          <i aria-hidden="true" />
          {accentLabel(accent)}
        </span>
      }
    >
      <div className="accent-picker" role="radiogroup" aria-label="Colour">
        {ACCENTS.map((a) => (
          <label
            key={a.key}
            className="accent-swatch"
            style={{ '--swatch': `linear-gradient(135deg, ${a.swatch[0]}, ${a.swatch[1]})` }}
          >
            <input
              type="radio"
              name="accent"
              value={a.key}
              checked={a.key === current}
              onChange={() => pick(a.key)}
            />
            <span className="accent-dot" aria-hidden="true" />
            <span className="accent-name">{a.label}</span>
          </label>
        ))}
      </div>
      <span className="muted" style={{ fontSize: '0.8rem' }}>
        Yours only. Everyone in the household picks their own, and it follows you to any device you
        sign in on. Spent, recurring, moved and left keep their own colours in all of them.
      </span>
      {error && <div className="error-text">{error}</div>}
    </SettingsSection>
  );
}
