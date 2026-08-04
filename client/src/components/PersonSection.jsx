import { useState } from 'react';
import AccountCard from './AccountCard';
import { renamePerson } from '../api/persons';
import { formatCurrency } from '../utils/currency';

export default function PersonSection({ person, month, primaryCurrency, onChanged, onAddAccount, onEditAccount }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(person.name);

  async function saveName() {
    const name = draft.trim();
    if (name && name !== person.name) {
      await renamePerson(person.id, name);
      onChanged();
    }
    setEditing(false);
  }

  return (
    <section className="card stack">
      <div className="spread">
        {editing ? (
          <div className="row-tight grow">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              style={{ maxWidth: 220 }}
              autoFocus
            />
            <button className="primary tiny" onClick={saveName}>
              Save
            </button>
          </div>
        ) : (
          <div>
            <h2 onClick={() => setEditing(true)} style={{ cursor: 'pointer' }} title="Click to rename">
              {person.name}
            </h2>
            <span className="muted" style={{ fontSize: '0.85rem' }}>
              {formatCurrency(person.netWorth, primaryCurrency, { compact: true })} across{' '}
              {person.accounts.length} account{person.accounts.length === 1 ? '' : 's'}
            </span>
          </div>
        )}
        <button className="tiny" onClick={() => onAddAccount(person)}>
          + Account
        </button>
      </div>

      {person.accounts.map((account) => (
        <AccountCard
          key={account.id}
          account={account}
          month={month}
          primaryCurrency={primaryCurrency}
          onChanged={onChanged}
          onEdit={onEditAccount}
        />
      ))}

      {person.accounts.length === 0 && (
        <p className="muted">No accounts yet — add one to start recording salary and spending.</p>
      )}
    </section>
  );
}
