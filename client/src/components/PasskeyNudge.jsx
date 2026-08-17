import { passkeysSupported } from '../utils/passkey';

// An offer, not a gate.
//
// An account with no passkey is held by its password alone: anyone who has it
// can sign in from anywhere and read every figure, whatever the eye button is
// set to. A passkey is what closes that, and it also wakes the ask-before-
// showing-amounts setting, which is on for everyone but dormant until there is
// something to ask with.
//
// So it is worth asking for, and worth asking for more than once — but never
// worth forcing. Being locked out of your own records because a phone broke
// somewhere with no way to register a new one is a worse day than the one this
// prevents. "Not now" is a real answer and it is the second button, not a link
// hidden in the corner.
export default function PasskeyNudge({ onAdd, onDismiss }) {
  // Nothing to offer on a browser that cannot make one; a prompt to do the
  // impossible is just noise.
  if (!passkeysSupported()) return null;

  return (
    <div className="passkey-nudge">
      <div className="nudge-text">
        <b>Sign in with your face instead</b>
        <small>
          Add a passkey and your password alone stops being enough to open this account — on any
          device, by anyone. It also lets the eye ask before it shows your amounts.
        </small>
      </div>
      <div className="nudge-actions">
        <button className="primary" onClick={onAdd}>
          Add a passkey
        </button>
        {/* No class: the ordinary bordered button. "Not now" is a real answer,
            so it looks like one rather than like a link to skip past. */}
        <button onClick={onDismiss}>Not now</button>
      </div>
    </div>
  );
}
