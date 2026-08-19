import { useState } from 'react';
import { createHousehold, acceptInvite } from '../api/households';

// Shown when someone is signed in but has no household — a brand new account,
// or the last one they were in was left. Two ways forward, because at this
// point they are either starting their own budget or joining someone else's.
export default function HouseholdSetup({ onReady, onCancel }) {
  const [mode, setMode] = useState('create');
  const [name, setName] = useState('');
  const [people, setPeople] = useState(['', '']);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const setPerson = (index, value) =>
    setPeople((list) => list.map((p, i) => (i === index ? value : p)));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') {
        const named = people.map((p) => p.trim()).filter(Boolean);
        const household = await createHousehold(name.trim(), named);
        onReady(household.id);
      } else {
        const joined = await acceptInvite(code.trim());
        onReady(joined.householdId);
      }
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth-screen">
      <form className="card stack auth-card" onSubmit={submit} style={{ maxWidth: 460 }}>
        <div className="stack-sm" style={{ gap: 4 }}>
          <h1>{mode === 'create' ? 'Set up your household' : 'Join a household'}</h1>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            {mode === 'create'
              ? 'A household is one budget — its people, accounts and history. You can make more later, and nothing is shared between them.'
              : 'Paste the invite code someone sent you.'}
          </span>
        </div>

        <nav className="nav" style={{ alignSelf: 'flex-start' }}>
          <button type="button" className={mode === 'create' ? 'active' : ''} onClick={() => setMode('create')}>
            Create one
          </button>
          <button type="button" className={mode === 'join' ? 'active' : ''} onClick={() => setMode('join')}>
            Join with a code
          </button>
        </nav>

        {mode === 'create' ? (
          <>
            <label className="field">
              Household name
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Our household"
                autoFocus
                required
              />
            </label>

            <div className="stack-sm">
              <strong style={{ fontSize: '0.9rem' }}>Who is in it?</strong>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Each person starts with a main account you can add to. Leave a box empty to skip it,
                and you can add more people at any time. Put yourself first — that is how the app
                knows which accounts are yours.
              </span>
              {people.map((person, index) => (
                // The first box is you, and now says so. It was only implied
                // before, by a placeholder — and the app links your login to
                // that person, so a guess about which one you are is a guess
                // about whose phone gets told when money arrives.
                <label className="field" key={index}>
                  {index === 0 ? 'You' : `Someone else${index > 1 ? ` (${index + 1})` : ''}`}
                  <input
                    className="person-name"
                    value={person}
                    onChange={(e) => setPerson(index, e.target.value)}
                    placeholder={index === 0 ? 'Your name' : 'e.g. your partner'}
                  />
                </label>
              ))}
              <button
                type="button"
                className="tiny"
                style={{ alignSelf: 'flex-start' }}
                onClick={() => setPeople((list) => [...list, ''])}
              >
                + Another person
              </button>
            </div>
          </>
        ) : (
          <label className="field">
            Invite code
            <input value={code} onChange={(e) => setCode(e.target.value)} autoFocus required />
          </label>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
          {onCancel && (
            <button type="button" onClick={onCancel} disabled={busy}>
              Cancel
            </button>
          )}
          <button type="submit" className="primary" disabled={busy}>
            {busy ? 'Please wait…' : mode === 'create' ? 'Create household' : 'Join'}
          </button>
        </div>
      </form>
    </div>
  );
}
