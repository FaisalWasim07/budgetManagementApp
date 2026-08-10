import { useEffect, useState } from 'react';
import { listUsers, createUser, changePassword } from '../api/auth';

// Managing who can sign in. Deliberately separate from `persons` in the
// budget — adding a login here does not create a person, because whose money
// an account holds is a different question from who can open the app.
export default function LoginSettings({ user, onSignedOut }) {
  const [users, setUsers] = useState([]);
  const [mode, setMode] = useState(null); // null | 'password' | 'invite'
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listUsers()
      .then(setUsers)
      .catch(() => {});
  }, []);

  function reset() {
    setMode(null);
    setCurrent('');
    setNext('');
    setNewUsername('');
    setNewPassword('');
    setError(null);
  }

  async function submitPassword() {
    setBusy(true);
    setError(null);
    try {
      await changePassword(current, next);
      // The server ends every session on a password change, so there is
      // nothing to keep open here.
      onSignedOut();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function submitInvite() {
    setBusy(true);
    setError(null);
    try {
      const created = await createUser(newUsername, newPassword);
      setUsers((list) => [...list, created]);
      setNote(`${created.username} can now sign in. Tell them the password you just set.`);
      reset();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack-sm">
      <div className="spread">
        <strong style={{ fontSize: '0.9rem' }}>Logins</strong>
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Signed in as {user.username}
        </span>
      </div>

      {users.length > 0 && (
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          {users.map((u) => u.username).join(', ')}
        </span>
      )}

      {mode === null && (
        <div className="row-tight">
          <button type="button" className="tiny" onClick={() => setMode('password')}>
            Change my password
          </button>
          <button type="button" className="tiny" onClick={() => setMode('invite')}>
            Add another login
          </button>
        </div>
      )}

      {mode === 'password' && (
        <div className="stack-sm">
          <label className="field">
            Current password
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            New password
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
            <span className="muted">At least 8 characters. You’ll be signed out afterwards.</span>
          </label>
          <div className="row-tight">
            <button type="button" className="tiny" onClick={reset} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="tiny" onClick={submitPassword} disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </div>
      )}

      {mode === 'invite' && (
        <div className="stack-sm">
          <label className="field">
            Username
            <input value={newUsername} onChange={(e) => setNewUsername(e.target.value)} />
          </label>
          <label className="field">
            Password
            <input
              type="password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              autoComplete="new-password"
            />
            <span className="muted">At least 8 characters. They can change it once signed in.</span>
          </label>
          <div className="row-tight">
            <button type="button" className="tiny" onClick={reset} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="tiny" onClick={submitInvite} disabled={busy}>
              {busy ? 'Adding…' : 'Add login'}
            </button>
          </div>
        </div>
      )}

      {note && <div className="secondary" style={{ fontSize: '0.85rem' }}>{note}</div>}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
