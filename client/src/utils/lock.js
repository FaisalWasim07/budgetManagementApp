import { startVerify, finishVerify } from '../api/auth';
import { usePasskey, passkeysSupported, wasCancelled } from './passkey';

// How long a successful check is good for is below; whether it is asked for at
// all lives on the account, not here. It used to be a localStorage flag, which
// meant setting it on your phone did nothing for the same account on a laptop —
// and the thing it protects is the account's figures, which follow you.
//
// It is not the security boundary either way: the passkey is. Somebody who can
// reach a setting to switch it off is holding your unlocked phone with the
// developer tools open, and could read the figures out of the page long before
// they thought to look.

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
