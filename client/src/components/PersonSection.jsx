import { useState } from 'react';
import AccountRow from './AccountRow';
import { renamePerson } from '../api/persons';
import { Money } from '../utils/display';

export default function PersonSection({
  person,
  month,
  primaryCurrency,
  subscriptions = [],
  onChanged,
  onAddAccount,
  onEditAccount,
  onAddEntry,
  readOnly = false,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(person.name);

  const leftover = person.income - person.expenses - person.subscriptions;

  async function saveName() {
    const name = draft.trim();
    if (name && name !== person.name) {
      await renamePerson(person.id, name);
      onChanged();
    }
    setEditing(false);
  }

  return (
    <section className="person">
      <div className="person-head">
        {editing ? (
          <div className="row-tight grow">
            <input
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && saveName()}
              onBlur={saveName}
              style={{ maxWidth: 200 }}
              aria-label="Name"
              autoFocus
            />
            <button className="primary tiny" onClick={saveName}>
              Save
            </button>
          </div>
        ) : (
          <div className="who">
            <h2
              onClick={() => !readOnly && setEditing(true)}
              style={{ cursor: readOnly ? 'default' : 'pointer' }}
              title={readOnly ? undefined : 'Click to rename'}
            >
              {person.name}
            </h2>
          </div>
        )}
        <span className="total">
          <Money amount={person.netWorth} currency={primaryCurrency} compact />
        </span>
      </div>

      <div className="person-figures">
        <div>
          <span className="k">Came in</span>
          <span className="v in">
            <Money amount={person.income} currency={primaryCurrency} compact />
          </span>
        </div>
        <div>
          <span className="k">Spent</span>
          <span className="v out">
            <Money amount={person.expenses} currency={primaryCurrency} compact />
          </span>
        </div>
        <div>
          <span className="k">Subscriptions</span>
          <span className="v">
            <Money amount={person.subscriptions} currency={primaryCurrency} compact />
          </span>
        </div>
        <div>
          <span className="k">Left over</span>
          <span className="v" style={leftover < 0 ? { color: 'var(--neg)' } : undefined}>
            <Money amount={leftover} currency={primaryCurrency} compact />
          </span>
        </div>
      </div>

      <div className="rows">
        {person.accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            month={month}
            primaryCurrency={primaryCurrency}
            recurring={subscriptions.filter((s) => s.account_id === account.id)}
            onAdd={onAddEntry}
            onEdit={onEditAccount}
            readOnly={readOnly}
          />
        ))}

        {person.accounts.length === 0 && (
          <p className="muted" style={{ padding: '12px 18px', margin: 0, fontSize: '.88rem' }}>
            No accounts yet — add one to start recording salary and spending.
          </p>
        )}

        {!readOnly && (
          <button className="account-row add" onClick={() => onAddAccount(person)}>
            <span className="name">
              <b>+ Add an account</b>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
