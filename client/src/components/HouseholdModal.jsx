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
import { createPerson, deletePerson, setPersonUser } from '../api/persons';
import { Trash } from './icons';

const ROLES = [
  ['editor', 'Can edit', 'Add and change money in this household.'],
  ['viewer', 'View only', 'Can see everything, can change nothing.'],
  ['owner', 'Owner', 'Everything, including inviting people.'],
];

const roleLabel = (role) => ROLES.find((r) => r[0] === role)?.[1] ?? role;

// One row of a list, laid out the way account rows are: a name that takes the
// space, controls that take only what they need. The old version put a select
// and two buttons in a flex row that wrapped into a heap at this width.
function Row({ name, meta, children }) {
  return (
    <div className="list-row">
      <span className="what">
        <b>{name}</b>
        {meta && <small>{meta}</small>}
      </span>
      <span className="acts">{children}</span>
    </div>
  );
}

export default function HouseholdModal({ household, user, persons, onClose, onChanged }) {
  const [members, setMembers] = useState([]);
  const [invites, setInvites] = useState([]);
  const [name, setName] = useState(household.name);
  const [inviteRole, setInviteRole] = useState('editor');
  const [newPerson, setNewPerson] = useState('');
  const [newUser, setNewUser] = useState({ username: '', password: '', role: 'editor' });
  const [adding, setAdding] = useState(false);
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

  // People are whose money it is. Members are who can open the app. They are
  // two tabs rather than two headings in one column because conflating them is
  // the easy mistake, and because either alone fits without scrolling.
  const peopleTab = () => (
    <div className="stack">
      {isOwner && (
        <label className="field">
          Household name
          <div className="row-tight">
            <input className="grow" type="text" value={name} onChange={(e) => setName(e.target.value)} />
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

      <div className="stack-sm">
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Each person has their own accounts. This is about whose money it is, not about who can
          sign in.
        </span>

        <div className="list">
          {persons.map((person) => (
            <Row
              key={person.id}
              name={person.name}
              meta={`${person.accounts.length} account${person.accounts.length === 1 ? '' : 's'}`}
            >
              {/* An owner can say who is who without the other person having
                  to go and find a setting. Usually already filled in — the app
                  matches on name, and by elimination where only one pairing is
                  possible. */}
              {isOwner && (
                <select
                  aria-label={`Which login is ${person.name}`}
                  className="compact"
                  value={person.userId ?? ''}
                  disabled={busy}
                  onChange={(e) =>
                    act(async () => {
                      await setPersonUser(person.id, e.target.value ? Number(e.target.value) : null);
                      onChanged();
                    })
                  }
                >
                  <option value="">No login</option>
                  {members.map((member) => (
                    <option key={member.user_id} value={member.user_id}>
                      {member.username}
                    </option>
                  ))}
                </select>
              )}
              {/* Only someone with nothing recorded can go. Removing a person
                  who holds accounts would take their money with them. */}
              {isOwner && person.accounts.length === 0 && (
                <button
                  type="button"
                  className="icon-button small danger"
                  title="Remove"
                  aria-label={`Remove ${person.name}`}
                  disabled={busy}
                  onClick={() =>
                    act(async () => {
                      await deletePerson(person.id);
                      onChanged();
                    })
                  }
                >
                  <Trash />
                </button>
              )}
            </Row>
          ))}
        </div>

        {household.role !== 'viewer' && (
          <div className="row-tight">
            <input
              className="grow"
              type="text"
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

      {error && <div className="error-text">{error}</div>}
    </div>
  );

  const accessTab = () => (
    <div className="stack">
      <div className="stack-sm">
        <span className="muted" style={{ fontSize: '0.8rem' }}>
          Who can open this household, and what they may change.
        </span>

        <div className="list">
          {members.map((member) => (
            <Row
              key={member.user_id}
              name={`${member.username}${member.user_id === user.id ? ' (you)' : ''}`}
              meta={isOwner ? null : roleLabel(member.role)}
            >
              {isOwner && (
                <select
                  aria-label={`Access for ${member.username}`}
                  value={member.role}
                  disabled={busy}
                  className="compact"
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
              )}
              {/* No email is ever sent by this app, so there is no reset link.
                  An owner setting it for them is the honest substitute — and
                  never against another owner, which would let co-owners lock
                  each other out. */}
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
                  Password
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
            </Row>
          ))}
        </div>

        {resetting != null && (
          <div className="card stack-sm inset">
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
                Shown as you type so you can read it out. They are signed out everywhere, and can
                change it once they’re back in.
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
          {/* Two ways in, for two situations, and only one of them open at a
              time — both expanded at once was most of what made this screen
              unreadable. */}
          {!adding ? (
            <div className="row-tight">
              <button type="button" className="tiny" onClick={() => setAdding(true)}>
                Add someone directly
              </button>
              <button
                type="button"
                className="tiny"
                disabled={busy}
                onClick={() => act(() => createInvite(household.id, inviteRole))}
              >
                Create an invite code
              </button>
            </div>
          ) : (
            <div className="card stack-sm inset">
              <strong style={{ fontSize: '0.9rem' }}>Add someone directly</strong>
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Sets up their login for you and adds them as a person with their own main account —
                for someone sitting next to you. An existing username is added as they are, keeping
                their own password.
              </span>

              <label className="field">
                Their username
                <input
                  type="text"
                  value={newUser.username}
                  onChange={(e) => setNewUser({ ...newUser, username: e.target.value })}
                />
              </label>
              <label className="field">
                A password for them
                <input
                  type="password"
                  autoComplete="new-password"
                  value={newUser.password}
                  onChange={(e) => setNewUser({ ...newUser, password: e.target.value })}
                />
              </label>
              <label className="field">
                What they may do
                <select
                  value={newUser.role}
                  onChange={(e) => setNewUser({ ...newUser, role: e.target.value })}
                >
                  {ROLES.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <span className="muted">{ROLES.find((r) => r[0] === newUser.role)?.[2]}</span>
              </label>

              <div className="row-tight">
                <button type="button" className="tiny" onClick={() => setAdding(false)} disabled={busy}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="primary tiny"
                  disabled={busy || !newUser.username.trim()}
                  onClick={() =>
                    act(async () => {
                      await addMember(household.id, {
                        username: newUser.username.trim(),
                        password: newUser.password,
                        role: newUser.role,
                      });
                      setNewUser({ username: '', password: '', role: 'editor' });
                      setAdding(false);
                      onChanged();
                    })
                  }
                >
                  Add them
                </button>
              </div>
            </div>
          )}

          {!adding && (
            <label className="field">
              New invites give
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
              <span className="muted">{ROLES.find((r) => r[0] === inviteRole)?.[2]}</span>
            </label>
          )}

          {invites.length > 0 && (
            <div className="list">
              {invites.map((invite) => (
                <Row
                  key={invite.code}
                  name={<code className="invite-code">{invite.code}</code>}
                  meta={`${roleLabel(invite.role)} · one use`}
                >
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
                </Row>
              ))}
            </div>
          )}
        </>
      )}

      {error && <div className="error-text">{error}</div>}
    </div>
  );

  return (
    <Modal
      title={household.name}
      onClose={onClose}
      tabs={[
        ['people', 'People', peopleTab],
        ['access', 'Access', accessTab],
      ]}
    />
  );
}
