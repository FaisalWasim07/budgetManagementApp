import { useEffect, useState } from 'react';
import { listUsers, changePassword, setEmail } from '../api/auth';
import { listPersons, setPersonUser } from '../api/persons';
import SettingsSection from './SettingsSection';
import { Key, User } from './icons';

// Managing who can sign in. Deliberately separate from `persons` in the
// budget — adding a login here does not create a person, because whose money
// an account holds is a different question from who can open the app.
export default function LoginSettings({ user, onSignedOut, onChanged }) {
  // Null until the answer arrives. An empty array would say "asked, and there
  // are none", which is a different fact and the one the screen would draw.
  const [users, setUsers] = useState(null);
  const [persons, setPersons] = useState(null);
  const [mode, setMode] = useState(null); // null | 'password'
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [email, setEmailValue] = useState('');
  // What is stored, so the Save button only appears once there is something
  // different to save.
  const [savedEmail, setSavedEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listUsers()
      .then((list) => {
        setUsers(list);
        const stored = list.find((u) => u.id === user.id)?.email ?? '';
        setEmailValue(stored);
        setSavedEmail(stored);
      })
      .catch(() => setUsers([]));
    listPersons().then(setPersons, () => setPersons([]));
  }, [user.id]);

  const loading = users === null || persons === null;
  const mine = persons?.find((p) => p.user_id === user.id) ?? null;

  function reset() {
    setMode(null);
    setCurrent('');
    setNext('');
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


  async function saveEmail() {
    setBusy(true);
    setError(null);
    try {
      await setEmail(email);
      setSavedEmail(email);
      setNote('Email saved.');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    // Named for the question it answers rather than for the table behind it:
    // your address, which of the people in the budget you are, your password.
    <SettingsSection
      icon={<User />}
      title="You"
      subtitle="Your details and who you are in this budget."
      state={`Signed in as ${user.username}`}
      loading={loading}
    >
      <div className="set-grid">
        {/* Nothing is *sent* to this address: it is a second name to sign in
            with. The hint says so, because "email" usually means mail. */}
        <label className="field">
          <span className="label">Email (optional)</span>
          <div className="input-with-action">
            <input
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmailValue(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && email !== savedEmail && saveEmail()}
            />
            {email !== savedEmail && (
              <button type="button" className="tiny primary" disabled={busy} onClick={saveEmail}>
                Save
              </button>
            )}
          </div>
          <span className="muted">Sign in with it instead of your username. Nothing is sent to it.</span>
        </label>

        {/* Usually already answered: the app matches logins to people by
            name. This is for the households where it couldn't tell, and to
            correct it if it got the wrong one. */}
        {persons?.length > 0 && (
          <label className="field">
            <span className="label">You are</span>
            <select
              value={mine?.id ?? ''}
              disabled={busy}
              onChange={async (e) => {
                const id = e.target.value ? Number(e.target.value) : null;
                setBusy(true);
                setError(null);
                try {
                  if (id) await setPersonUser(id, user.id);
                  else if (mine) await setPersonUser(mine.id, null);
                  setPersons(await listPersons());
                  setNote('Saved.');
                  onChanged?.();
                } catch (err) {
                  setError(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <option value="">Nobody in particular</option>
              {persons?.map((person) => (
                <option key={person.id} value={person.id}>
                  {person.name}
                </option>
              ))}
            </select>
            <span className="muted">Your money leads Home, and new entries start on your account.</span>
          </label>
        )}
      </div>

      {mode === null && (
        <div className="set-actions-row">
          <button type="button" className="pill-outline" onClick={() => setMode('password')}>
            <Key />
            Change my password
          </button>
          {/* Giving somebody else access is a household job, not a login
              one, so this points there rather than offering a bare login. */}
          <span className="muted">
            To let someone else in, use <strong>People &amp; sharing</strong> on the household menu.
          </span>
        </div>
      )}

      {mode === 'password' && (
        <div className="set-grid">
          <label className="field">
            <span className="label">Current password</span>
            <input
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
            />
          </label>
          <label className="field">
            <span className="label">New password</span>
            <input
              type="password"
              value={next}
              onChange={(e) => setNext(e.target.value)}
              autoComplete="new-password"
            />
            <span className="muted">At least 8 characters. You’ll be signed out afterwards.</span>
          </label>
          <div className="set-actions-row set-span">
            <button type="button" className="tiny" onClick={reset} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="tiny primary" onClick={submitPassword} disabled={busy}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </div>
        </div>
      )}


      {note && <div className="secondary" style={{ fontSize: '0.85rem' }}>{note}</div>}
      {error && <div className="error-text">{error}</div>}
    </SettingsSection>
  );
}
