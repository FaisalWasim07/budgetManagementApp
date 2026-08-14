import { useEffect, useState } from 'react';
import { listUsers, changePassword, setEmail } from '../api/auth';
import { listPersons, setPersonUser } from '../api/persons';

// Managing who can sign in. Deliberately separate from `persons` in the
// budget — adding a login here does not create a person, because whose money
// an account holds is a different question from who can open the app.
export default function LoginSettings({ user, onSignedOut, onChanged }) {
  const [users, setUsers] = useState([]);
  const [persons, setPersons] = useState([]);
  const [mode, setMode] = useState(null); // null | 'password'
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [email, setEmailValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    listUsers()
      .then((list) => {
        setUsers(list);
        setEmailValue(list.find((u) => u.id === user.id)?.email ?? '');
      })
      .catch(() => {});
    listPersons().then(setPersons, () => {});
  }, [user.id]);

  const mine = persons.find((p) => p.user_id === user.id) ?? null;

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

      <span className="muted" style={{ fontSize: '0.8rem' }}>
        To give someone access to a budget, use <strong>People &amp; sharing</strong> on the
        household menu — that adds them to the household and gives them an account, which adding a
        bare login here would not.
      </span>

      {/* Nothing is *sent* to this address — it is a second name to sign in
          with, and a head start if self-service reset is ever added. */}
      <label className="field">
        Your email (optional)
        <div className="row-tight">
          <input
            className="grow"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmailValue(e.target.value)}
          />
          <button
            type="button"
            className="tiny"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await setEmail(email);
                setNote('Email saved.');
              } catch (err) {
                setError(err.message);
              } finally {
                setBusy(false);
              }
            }}
          >
            Save
          </button>
        </div>
        <span className="muted">
          You can sign in with this instead of your username. Nothing is ever sent to it — there is
          no reset by email, so if you're locked out, another owner of your household can set a new
          password for you.
        </span>
      </label>

      {/* Usually already answered — the app matches logins to people by name,
          and by elimination where the count leaves only one possibility. This
          is here for the households where it couldn't tell, and to correct it
          if it got the wrong one. */}
      {persons.length > 0 && (
        <label className="field">
          You are
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
            {persons.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
          <span className="muted">
            Which of the people in this budget is you. Your own money then leads your dashboard, and
            new entries start on your account instead of whoever was added first.
          </span>
        </label>
      )}

      {mode === null && (
        <div className="row-tight">
          <button type="button" className="tiny" onClick={() => setMode('password')}>
            Change my password
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


      {note && <div className="secondary" style={{ fontSize: '0.85rem' }}>{note}</div>}
      {error && <div className="error-text">{error}</div>}
    </div>
  );
}
