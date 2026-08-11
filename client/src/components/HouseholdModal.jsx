import { useCallback, useEffect, useState } from 'react';
import Modal from './Modal';
import {
  listMembers,
  listInvites,
  createInvite,
  revokeInvite,
  setMemberRole,
  removeMember,
  renameHousehold,
  addMember,
  resetMemberPassword,
} from '../api/households';
import { createPerson, deletePerson } from '../api/persons';

const ROLES = [
  ['editor', 'Can edit', 'Add and change money in this household.'],
  ['viewer', 'View only', 'Can see everything, can change nothing.'],
  ['owner', 'Owner', 'Everything, including inviting people.'],
];

export default function HouseholdModal({ household, user, persons, onClose, onChanged }) {
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [name, setName] = useState(household.name);
  const [inviteRole, setInviteRole] = useState('editor');
  const [newPerson, setNewPerson] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'editor' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetDone, setResetDone] = useState(null);

  const isOwner = household.role === 'owner';

  const load = useCallback(async () => {
    try {
      setMembers(await listMembers(household.id));
      if (isOwner) setInvites(await listInvites(household.id));
    } catch (err) {
      setError(err.message);
    }
  }, [household.id, isOwner]);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`${household.name} — people & sharing`} onClose={onClose}>
      <div className="stack">
        {isOwner && (
          <label className="field">
            Household name
            <div className="row-tight">
              <input className="grow" value={name} onChange={(e) => setName(e.target.value)} />
              <button
                type="button"
                className="tiny"
                disabled={busy || !name.trim() || name === household.name}
                onClick={() =>
                  act(async () => {
                    await renameHousehold(household.id, name.trim());
                    onChanged();
                  })
                }
              >
                Rename
              </button>
            </div>
          </label>
        )}

        {/* People are whose money it is. Members are who can open the app.
            Kept visibly apart because conflating them is the easy mistake. */}
        <div className="stack-sm">
          <strong style={{ fontSize: '0.9rem' }}>People in this budget</strong>
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Each person has their own accounts. This is about whose money it is, not about who can
            sign in.
          </span>

          {persons.map((person) => (
            <div key={person.id} className="spread" style={{ fontSize: '0.9rem' }}>
              <span>
                {person.name}
                <span className="muted"> · {person.accounts.length} account
                  {person.accounts.length === 1 ? '' : 's'}
                </span>
              </span>
              {isOwner && person.accounts.length === 0 && (
                <button
                  type="button"
                  className="tiny danger"
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await deletePerson(person.id);
                      onChanged();
                    })
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}

          {household.role !== 'viewer' && (
            <div className="row-tight">
              <input
                className="grow"
                placeholder="Add a person, e.g. your partner"
                value={newPerson}
                onChange={(e) => setNewPerson(e.target.value)}
              />
              <button
                type="button"
                className="tiny"
                disabled={busy || !newPerson.trim()}
                onClick={() =>
                  act(async () => {
                    await createPerson(newPerson.trim());
                    setNewPerson('');
                    onChanged();
                  })
                }
              >
                Add person
              </button>
            </div>
          )}
        </div>

        <hr className="divider" />

        <div className="stack-sm">
          <strong style={{ fontSize: '0.9rem' }}>Who can open this household</strong>
          {members.map((member) => (
            <div key={member.user_id} className="spread" style={{ fontSize: '0.9rem' }}>
              <span>
                {member.username}
                {member.user_id === user.id && <span className="muted"> (you)</span>}
              </span>
              <div className="row-tight">
                {isOwner ? (
                  <select
                    aria-label={`Access for ${member.username}`}
                    value={member.role}
                    disabled={busy}
                    onChange={(e) =>
                      act(() => setMemberRole(household.id, member.user_id, e.target.value))
                    }
                  >
                    {ROLES.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted">{ROLES.find((r) => r[0] === member.role)?.[1]}</span>
                )}
                {/* No email exists anywhere in this app, so there is no reset
                    link to send. An owner setting it for them is the honest
                    substitute — and never against another owner, which would
                    let co-owners lock each other out. */}
                {isOwner && member.user_id !== user.id && member.role !== 'owner' && (
                  <button
                    type="button"
                    className="tiny"
                    disabled={busy}
                    onClick={() => {
                      setResetting(resetting === member.user_id ? null : member.user_id);
                      setResetPassword('');
                      setResetDone(null);
                    }}
                  >
                    Reset password
                  </button>
                )}
                {(isOwner || member.user_id === user.id) && (
                  <button
                    type="button"
                    className="tiny danger"
                    disabled={busy}
                    onClick={() =>
                      act(async () => {
                        await removeMember(household.id, member.user_id);
                        if (member.user_id === user.id) onChanged({ left: true });
                      })
                    }
                  >
                    {member.user_id === user.id ? 'Leave' : 'Remove'}
                  </button>
                )}
              </div>
            </div>
          ))}

          {resetting != null && (
            <div className="stack-sm" style={{ paddingLeft: 12 }}>
              <label className="field">
                New password for {members.find((m) => m.user_id === resetting)?.username}
                <input
                  type="text"
                  autoComplete="off"
                  placeholder="At least 8 characters"
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                />
                <span className="muted">
                  Shown as you type so you can read it out. They are signed out everywhere, and
                  can change it once they're back in.
                </span>
              </label>
              <div className="row-tight">
                <button type="button" className="tiny" onClick={() => setResetting(null)} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="tiny"
                  disabled={busy || resetPassword.length < 8}
                  onClick={() =>
                    act(async () => {
                      await resetMemberPassword(household.id, resetting, resetPassword);
                      setResetDone(members.find((m) => m.user_id === resetting)?.username);
                      setResetting(null);
                      setResetPassword('');
                    })
                  }
                >
                  Set it
                </button>
              </div>
            </div>
          )}

          {resetDone && (
            <div className="secondary" style={{ fontSize: '0.85rem' }}>
              Password for {resetDone} changed. Tell them the new one — they were signed out.
            </div>
          )}
        </div>

        {isOwner && (
          <>
            <hr className="divider" />
            <div className="stack-sm">
              <strong style={{ fontSize: '0.9rem' }}>Add someone directly</strong>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Sets up their login for you and adds them as a person with their own main account —
                for someone sitting next to you, rather than someone you need to send a code to. An
                existing username is added as they are, keeping their own password.
              </span>

              <div className="row-tight">
                <input
                  className="grow"
                  placeholder="Their username"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                />
                <input
                  type="password"
                  placeholder="Password for them"
                  autoComplete="new-password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                  style={{ width: 170 }}
                />
                <select
                  aria-label="Their access"
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  {ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="tiny"
                  disabled={busy || !newUser.username.trim()}
                  onClick={() =>
                    act(async () => {
                      await addMember(household.id, {
                        username: newUser.username.trim(),
                        password: newUser.password,
                        role: newUser.role,
                      });
                      setNewUser({ username: '', password: '', role: 'editor' });
                      onChanged();
                    })
                  }
                >
                  Add them
                </button>
              </div>
            </div>

            <hr className="divider" />
            <div className="stack-sm">
              <strong style={{ fontSize: '0.9rem' }}>Or invite with a code</strong>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Creates a one-time code. Send it however you like — they sign up, paste it in, and
                land in this household with the access you chose.
              </span>

              <div className="row-tight">
                <select
                  aria-label="Invite role"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value)}
                >
                  {ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="tiny"
                  disabled={busy}
                  onClick={() => act(() => createInvite(household.id, inviteRole))}
                >
                  Create invite
                </button>
              </div>

              <span className="muted" style={{ fontSize: '0.78rem' }}>
                {ROLES.find((r) => r[0] === inviteRole)?.[2]}
              </span>

              {invites.map((invite) => (
                <div key={invite.code} className="spread" style={{ fontSize: '0.85rem' }}>
                  <code className="invite-code">{invite.code}</code>
                  <div className="row-tight">
                    <span className="muted" style={{ fontSize: '0.75rem' }}>
                      {ROLES.find((r) => r[0] === invite.role)?.[1]}
                    </span>
                    <button
                      type="button"
                      className="tiny"
                      onClick={() => {
                        navigator.clipboard?.writeText(invite.code);
                        setCopied(invite.code);
                      }}
                    >
                      {copied === invite.code ? 'Copied' : 'Copy'}
                    </button>
                    <button
                      type="button"
                      className="tiny danger"
                      disabled={busy}
                      onClick={() => act(() => revokeInvite(household.id, invite.code))}
                    >
                      Revoke
                    </button>
                  </div>
                </div>
              ))}

              {invites.length === 0 && (
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  No unused invites.
                </span>
              )}
            </div>
          </>
        )}

        {error && <div className="error-text">{error}</div>}
      </div>
    </Modal>
  );
}
