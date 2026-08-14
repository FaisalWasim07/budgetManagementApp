import { useEffect, useRef, useState } from 'react';
import {
  login,
  setupFirstUser,
  loginWithPasskey,
  loginWithRecoveryCode,
} from '../api/auth';
import { Mark, Shield } from '../components/icons';
import { passkeysSupported, usePasskey, wasCancelled } from '../utils/passkey';

// One form for two jobs: before anyone has signed up it creates the first
// login, and after that it signs you in. Both end with a session cookie set,
// so the caller just gets told who is now signed in.
//
// An account with a passkey has a second step. The password is checked first
// and gets you nothing but a challenge — no session exists until the device
// has signed it.
export default function Login({ needsSetup, onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [challenge, setChallenge] = useState(null);
  const [recovering, setRecovering] = useState(false);
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
        ? await setupFirstUser(username, password)
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

  async function confirmWithDevice() {
    setBusy(true);
    setError(null);
    try {
      const response = await usePasskey(challenge.options);
      const result = await loginWithPasskey(challenge.challengeId, response);
      onSignedIn(result.user);
    } catch (err) {
      // Cancelling the system prompt is a decision, not a failure, so it
      // leaves the screen as it was rather than reporting an error.
      if (!wasCancelled(err)) setError(err.message);
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
              <button className="primary" onClick={confirmWithDevice} disabled={busy}>
                <Shield size={15} /> {busy ? 'Waiting for your device…' : 'Confirm with your device'}
              </button>
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
