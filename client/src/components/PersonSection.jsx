import { useState } from 'react';
import AccountRow from './AccountRow';
import { renamePerson } from '../api/persons';
import { Money } from '../utils/display';

// What the total is actually made of, by currency. One number covering AED and
// PKR hides that part of it is held abroad at today's rate and will be a
// different number next month — and that it isn't spendable here.
//
// Only worth saying when there is more than one currency: "AED 99,220, of which
// AED 99,220 is in AED" is noise, so a household in one currency sees nothing.
function holdings(person, primaryCurrency) {
  const byCurrency = new Map();
  for (const account of person.accounts) {
    const held = byCurrency.get(account.currency) ?? { amount: 0, primary: 0, converted: true };
    held.amount += account.balance;
    if (account.balancePrimary == null) held.converted = false;
    else held.primary += account.balancePrimary;
    byCurrency.set(account.currency, held);
  }

  if (byCurrency.size < 2) return [];

  // The primary currency first — it is the part you can spend without thinking
  // about a rate — then the rest, largest first.
  return [...byCurrency.entries()]
    .map(([currency, held]) => ({ currency, ...held }))
    .sort((a, b) => {
      if (a.currency === primaryCurrency) return -1;
      if (b.currency === primaryCurrency) return 1;
      return b.primary - a.primary;
    });
}

export default function PersonSection({
  person,
  month,
  primaryCurrency,
  subscriptions = [],
  onChanged,
  onAddAccount,
  onOpenAccount,
  readOnly = false,
  yours = false,
  tint = 0,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(person.name);

  const leftover = person.income - person.expenses - person.subscriptions;
  const held = holdings(person, primaryCurrency);

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
            <span className={tint ? 'avatar alt' : 'avatar'} aria-hidden="true">
              {person.name.trim().charAt(0).toUpperCase()}
            </span>
            <h2
              onClick={() => !readOnly && setEditing(true)}
              style={{ cursor: readOnly ? 'default' : 'pointer' }}
              title={readOnly ? undefined : 'Click to rename'}
            >
              {person.name}
            </h2>
            {/* Whose money you are looking at, when it is your own. */}
            {yours && <span className="yours">You</span>}
          </div>
        )}
        <span className="total">
          <Money amount={person.netWorth} currency={primaryCurrency} compact />
          {held.length > 0 && (
            <span className="holdings">
              {held.map((h, i) => (
                <span key={h.currency}>
                  {i > 0 && <span className="sep"> · </span>}
                  <Money amount={h.amount} currency={h.currency} compact />
                  {h.currency !== primaryCurrency &&
                    (h.converted ? (
                      <>
                        {' ≈ '}
                        <Money amount={h.primary} currency={primaryCurrency} compact />
                      </>
                    ) : (
                      <span className="error-text"> no rate</span>
                    ))}
                </span>
              ))}
            </span>
          )}
        </span>
      </div>

      <div className="rows">
        {person.accounts.map((account) => (
          <AccountRow
            key={account.id}
            account={account}
            primaryCurrency={primaryCurrency}
            onOpen={onOpenAccount}
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
              {/* Named, because two of these sit side by side on a desk and
                  "+ Add an account" twice says nothing about which column it
                  lands in. */}
              <b>+ Add an account for {person.name}</b>
            </span>
          </button>
        )}
      </div>
    </section>
  );
}
