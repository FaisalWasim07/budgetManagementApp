import { useEffect, useRef, useState } from 'react';
import {
  login,
  setupFirstUser,
  loginWithPasskey,
  loginWithRecoveryCode,
} from '../api/auth';
import { Mark, Shield } from '../components/icons';
import { passkeysSupported, usePasskey, wasCancelled } from '../utils/passkey';

// What to try when the device prompt ends without an answer. Windows is
// called out because Windows Hello puts up its own "Something went wrong",
// which says nothing about which of these it was.
const describeFailure = () =>
  'Nothing was confirmed. Your device may have offered the wrong passkey — ' +
  '“Show every passkey” below asks it for all of them instead, which is worth ' +
  'trying before anything else. Otherwise this computer needs a PIN or ' +
  'fingerprint set up, or you can use a recovery code.';

// One form for two jobs: before anyone has signed up it creates the first
// login, and after that it signs you in. Both end with a session cookie set,
// so the caller just gets told who is now signed in.
//
// An account with a passkey has a second step. The password is checked first
// and gets you nothing but a challenge — no session exists until the device
// has signed it.
export default function Login({ needsSetup, signupNeedsCode, onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  // Not the `code` below: that one is a recovery code answering a passkey
  // challenge. This gates registration on a deployment that sets SIGNUP_CODE,
  // and the two are never on screen at the same time.
  const [signupCode, setSignupCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [challenge, setChallenge] = useState(null);
  // Separate from `error`, and quieter: a prompt that didn't complete is not
  // necessarily anything wrong, so it reads as guidance rather than a fault.
  const [hint, setHint] = useState(null);
  const [recovering, setRecovering] = useState(false);
  // Whether to offer the second, wider attempt. Set only by a failed first one.
  const [broadenable, setBroadenable] = useState(false);
  const [code, setCode] = useState('');
  // The device prompt is fired automatically the first time the second step
  // appears, but only once: re-firing it after a cancel would trap someone who
  // wanted the recovery route instead.
  const prompted = useRef(false);

  async function submit(e) {
    e.preventDefault();
    if (needsSetup && password !== confirm) {
      setError('The two passwords don’t match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const result = needsSetup
        ? await setupFirstUser(username, password, signupCode.trim())
        : await login(username, password);

      if (result.needs === 'passkey') {
        setChallenge(result);
        setPassword('');
        setBusy(false);
        return;
      }
      onSignedIn(result.user);
    } catch (err) {
      setError(err.message);
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  }

  // `anyDevice` drops the list of acceptable credentials from the request. The
  // challenge is the same one — it is what gets signed, and it is already tied
  // to this user — so nothing has to be reissued to ask the question a second
  // way. What changes is who decides: with a list, the browser picks a route to
  // one of the named credentials on your behalf, and if it picks a store the
  // passkey is not in, it fails with an error that cannot say so. Without one,
  // it shows you every passkey it holds for this site and you choose.
  //
  // Safe to offer because the server does not take the browser's word for it:
  // a returned credential is looked up against this challenge's own user, so
  // somebody else's passkey signs nobody in.
  async function confirmWithDevice(anyDevice = false) {
    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const response = await usePasskey(
        anyDevice ? { ...challenge.options, allowCredentials: [] } : challenge.options,
      );
      const result = await loginWithPasskey(challenge.challengeId, response);
      onSignedIn(result.user);
    } catch (err) {
      // The browser reports a cancelled prompt and a device that could not
      // help in exactly the same way, on purpose — telling them apart would
      // tell a stranger which passkeys you hold. So this cannot say which
      // happened, and says what to do about either instead.
      if (wasCancelled(err)) {
        setHint(describeFailure());
        // Offered only once the narrow attempt has actually failed. Leading
        // with it would make every sign-in a question.
        if (!anyDevice) setBroadenable(true);
      } else {
        setError(`${err.message}${err.name ? ` (${err.name})` : ''}`);
      }
      setBusy(false);
    }
  }

  async function submitCode(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await loginWithRecoveryCode(challenge.challengeId, code);
      onSignedIn(result.user);
    } catch (err) {
      setError(err.message);
      setCode('');
      setBusy(false);
    }
  }

  // Browsers only open the passkey prompt from something the person did, and
  // clicking "Sign in" counts — for the moment the second step first appears.
  useEffect(() => {
    if (!challenge || prompted.current || !passkeysSupported()) return;
    prompted.current = true;
    confirmWithDevice();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [challenge]);

  const heading = (
    <div className="stack-sm" style={{ gap: 4 }}>
      <span className="brand auth-brand">
        <Mark size={30} />
        <span className="wordmark">Bayt</span>
      </span>
      <h1>{needsSetup ? 'Set up your budget' : challenge ? 'One more step' : 'Welcome back'}</h1>
      <span className="muted" style={{ fontSize: '0.85rem' }}>
        {needsSetup
          ? 'Pick a username and password. This is stored on your own server — there is no account to create anywhere else.'
          : challenge
            ? 'Your password was right. Confirm it’s you on your device.'
            : 'Sign in to continue.'}
      </span>
    </div>
  );

  if (challenge && recovering) {
    return (
      <div className="auth-screen">
        <form className="card stack auth-card" onSubmit={submitCode}>
          {heading}
          <label className="field">
            Recovery code
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="XXXX-XXXX"
              autoComplete="one-time-code"
              autoFocus
              required
            />
            <span className="muted">
              One of the codes you saved when you added your passkey. Each works once.
            </span>
          </label>

          {error && <div className="error-text">{error}</div>}

          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Please wait…' : 'Use this code'}
          </button>
          {passkeysSupported() && (
            <button
              type="button"
              className="subtle"
              onClick={() => {
                setRecovering(false);
                setBusy(false);
                setError(null);
                setHint(null);
                setBroadenable(false);
              }}
            >
              Use my device instead
            </button>
          )}
        </form>
      </div>
    );
  }

  if (challenge) {
    return (
      <div className="auth-screen">
        <div className="card stack auth-card">
          {heading}

          {passkeysSupported() ? (
            <>
              {/* Wrapped rather than passed directly: onClick hands the click
                event to its first argument, which would arrive as a truthy
                `anyDevice` and widen every first attempt. */}
              <button className="primary" onClick={() => confirmWithDevice()} disabled={busy}>
                <Shield size={15} /> {busy ? 'Waiting for your device…' : 'Confirm with your device'}
              </button>
              {hint && (
                <span className="muted" style={{ fontSize: '0.82rem', lineHeight: 1.45 }}>
                  {hint}
                </span>
              )}
              {broadenable && (
                <button
                  type="button"
                  className="subtle"
                  onClick={() => confirmWithDevice(true)}
                  disabled={busy}
                >
                  Show every passkey on this device
                </button>
              )}
              {error && <div className="error-text">{error}</div>}
            </>
          ) : (
            <div className="warn-banner">
              This browser can’t use passkeys. Sign in with a recovery code instead.
            </div>
          )}

          {/* Each route starts clean, so a message left over from the other
              one doesn't follow you across. */}
          <button
            type="button"
            className="subtle"
            onClick={() => {
              setRecovering(true);
              setBusy(false);
              setError(null);
              setHint(null);
              setBroadenable(false);
            }}
          >
            Use a recovery code
          </button>
          {challenge.recoveryCodesLeft === 0 && (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              No recovery codes left on this account. Generate a new set from Settings once you’re
              in.
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <form className="card stack auth-card" onSubmit={submit}>
        {heading}

        <label className="field">
          {needsSetup ? 'Username' : 'Username or email'}
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoFocus
            required
          />
        </label>

        <label className="field">
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={needsSetup ? 'new-password' : 'current-password'}
            required
          />
          {needsSetup && <span className="muted">At least 8 characters.</span>}
        </label>

        {needsSetup && (
          <label className="field">
            Confirm password
            <input
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              required
            />
          </label>
        )}

        {/* Shown only when the server says this deployment has a signup code.
            Without the field the form posts without one and is refused with
            BAD_SIGNUP_CODE — a dead end, because there is nothing on screen to
            correct. Kept on a failed attempt: a code you were given is not
            the thing that was wrong when the password was. */}
        {needsSetup && signupNeedsCode && (
          <label className="field">
            Signup code
            <input
              value={signupCode}
              onChange={(e) => setSignupCode(e.target.value)}
              autoComplete="off"
              required
            />
            <span className="muted">
              This Bayt asks for a code before anyone can sign up. Whoever set it up has it.
            </span>
          </label>
        )}

        {error && <div className="error-text">{error}</div>}

        <button type="submit" className="primary" disabled={busy}>
          {busy ? 'Please wait…' : needsSetup ? 'Create login' : 'Sign in'}
        </button>

        {needsSetup && (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            You can add a second login for your partner later, from Settings.
          </span>
        )}
      </form>
    </div>
  );
}
