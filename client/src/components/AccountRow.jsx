import { useEffect, useState } from 'react';
import { listTransactions } from '../api/transactions';
import { Money } from '../utils/display';
import { Chevron } from './icons';
import { iconForAccount } from '../utils/categoryIcon';

const KIND_LABEL = {
  income: 'Income',
  expense: 'Expense',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

const isCredit = (kind) => kind === 'income' || kind === 'transfer_in';

function whenOf(entry) {
  const date = entry.entry_date || entry.created_at;
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// An account is a line in a ledger, not a card in a grid: six accounts should
// read as six lines. Everything about one is behind its own row, opened by
// clicking it.
export default function AccountRow({
  account,
  month,
  primaryCurrency,
  recurring = [],
  onAdd,
  onEdit,
  readOnly = false,
}) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const card = account.type === 'credit';
  const foreign = account.currency !== primaryCurrency;
  const owed = card && account.balance < 0;
  const TypeIcon = iconForAccount(account.type);

  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setLoading(true);
    listTransactions({ accountId: account.id, month }).then(
      (rows) => {
        if (!cancelled) {
          setEntries(rows);
          setLoading(false);
        }
      },
      () => {
        if (!cancelled) setLoading(false);
      }
    );
    return () => {
      cancelled = true;
    };
    // account.balance is in here on purpose: it changes whenever anything is
    // recorded against this account, which is exactly when an open list is
    // stale.
  }, [open, account.id, account.balance, month]);

  const nothing = !loading && entries.length === 0 && recurring.length === 0;

  return (
    <>
      <button
        className="account-row"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={`account-detail-${account.id}`}
      >
        <span className={card ? 'tile card' : 'tile'}>
          <TypeIcon />
        </span>
        <span className="name">
          <b>{account.name}</b>
          <span className="meta">
            <span className="badge currency">{account.currency}</span>
            {account.type === 'savings' && <span className="badge">Savings</span>}
            {card && <span className="badge card">Credit card</span>}
            {foreign && account.balancePrimary == null && (
              <span className="error-text">no {account.currency}→{primaryCurrency} rate</span>
            )}
          </span>
        </span>
        <span className={owed ? 'bal owed' : 'bal'}>
          <Money
            amount={owed ? -account.balance : account.balance}
            currency={account.currency}
            compact
          />
          {owed && <span className="sub">owed</span>}
          {foreign && account.balancePrimary != null && (
            <span className="sub">
              ≈ <Money amount={account.balancePrimary} currency={primaryCurrency} compact />
            </span>
          )}
        </span>
        <Chevron />
      </button>

      <div className={open ? 'detail open' : 'detail'} id={`account-detail-${account.id}`}>
        <div>
          <div className="detail-inner">
            <ul className="entries">
              {recurring.map((sub) => (
                <li key={`sub-${sub.id}`}>
                  <span className="what">
                    {sub.name}
                    <small>Recurring · {sub.cycle === 'yearly' ? 'yearly' : 'monthly'}</small>
                  </span>
                  <span className={sub.direction === 'income' ? 'amt in' : 'amt'}>
                    <Money
                      amount={sub.amount}
                      currency={account.currency}
                      prefix={sub.direction === 'income' ? '+' : '−'}
                    />
                  </span>
                </li>
              ))}

              {entries.map((entry) => (
                <li key={entry.id}>
                  <span className="what">
                    {entry.category || entry.description || KIND_LABEL[entry.kind]}
                    <small>
                      {KIND_LABEL[entry.kind]}
                      {whenOf(entry) ? ` · ${whenOf(entry)}` : ''}
                    </small>
                  </span>
                  <span className={isCredit(entry.kind) ? 'amt in' : 'amt'}>
                    <Money
                      amount={entry.amount}
                      currency={account.currency}
                      prefix={isCredit(entry.kind) ? '+' : '−'}
                    />
                  </span>
                </li>
              ))}

              {loading && <li className="muted">Loading…</li>}
              {nothing && <li className="muted">Nothing recorded this month.</li>}
            </ul>

            <div className="acts">
              {!readOnly && (
                <button className="tiny" onClick={() => onAdd(account)}>
                  Add to this account
                </button>
              )}
              {!readOnly && (
                <button className="tiny subtle" onClick={() => onEdit(account)}>
                  Edit account
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
