import { useState } from 'react';
import { login, setupFirstUser } from '../api/auth';
import { Mark } from '../components/icons';

// One form for two jobs: before anyone has signed up it creates the first
// login, and after that it signs you in. Both end with a session cookie set,
// so the caller just gets told who is now signed in.
export default function Login({ needsSetup, onSignedIn }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

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
      onSignedIn(result.user);
    } catch (err) {
      setError(err.message);
      setPassword('');
      setConfirm('');
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="card stack auth-card" onSubmit={submit}>
        <div className="stack-sm" style={{ gap: 4 }}>
          <span className="brand auth-brand">
            <Mark size={30} />
            <span className="wordmark">Bayt</span>
          </span>
          <h1>{needsSetup ? 'Set up your budget' : 'Welcome back'}</h1>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {needsSetup
              ? 'Pick a username and password. This is stored on your own server — there is no account to create anywhere else.'
              : 'Sign in to continue.'}
          </span>
        </div>

        <label className="field">
          Username
          <input
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
