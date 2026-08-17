import { startVerify, finishVerify } from '../api/auth';
import { usePasskey, passkeysSupported, wasCancelled } from './passkey';

// Whether this device asks for a passkey before it will show any figure.
//
// Kept on the device rather than on the account, because the worry it answers
// is about a device: this phone, in someone else's hand. Arooj's phone has its
// own answer, and neither of you has to inherit the other's. It also means
// there is nothing to migrate and nothing to sync.
//
// It is not the security boundary — the passkey is. Someone who can reach this
// setting to switch it off is someone holding your unlocked phone with the
// developer tools open, and they could read the figures out of the page long
// before they thought to look here.
const KEY = 'budget.lockAmounts';

export const amountsLocked = () => localStorage.getItem(KEY) === 'true';

export const setAmountsLocked = (on) => {
  if (on) localStorage.setItem(KEY, 'true');
  else localStorage.removeItem(KEY);
};

// How long a successful check is good for. Long enough to read a screen and
// move to another; short enough that a phone left on a table re-locks itself.
export const UNLOCK_MINUTES = 5;

export const canLock = () => passkeysSupported();

// Resolves true when the person answered, false when they waved it away, and
// throws only when something actually went wrong — a cancelled prompt is a
// normal thing to do, not a failure to report.
export async function proveItIsYou() {
  const { challengeId, options } = await startVerify();
  let assertion;
  try {
    assertion = await usePasskey(options);
  } catch (err) {
    if (wasCancelled(err)) return false;
    throw err;
  }
  const result = await finishVerify(challengeId, assertion);
  return Boolean(result?.ok);
}
