import { useCallback, useEffect, useState } from 'react';
import { listTransactions, deleteTransaction } from '../api/transactions';
import { Money, useDisplay } from '../utils/display';
import { Pencil, Trash } from './icons';
import { iconForEntry, toneForEntry } from '../utils/categoryIcon';
import TransactionEditModal from './TransactionEditModal';

const KIND_LABEL = {
  income: 'Income',
  expense: 'Expense',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

const FILTERS = [
  ['all', 'Everything'],
  ['income', 'Came in'],
  ['expense', 'Went out'],
  ['transfers', 'Moved'],
];

const isCredit = (kind) => kind === 'income' || kind === 'transfer_in';
const isMove = (kind) => kind === 'transfer_in' || kind === 'transfer_out';

// Entries recorded before the app knew who added them have neither a name nor a
// meaningful time, so both fall back to nothing rather than to now().
function when(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

// "Transfer out" tells you nothing you could not already see from the minus
// sign. The useful half is the account at the other end, which is the sibling
// row sharing this one's transfer_id.
function describe(row, rows) {
  if (row.category || row.description) return row.category || row.description;
  if (!row.transfer_id) return KIND_LABEL[row.kind];
  const other = rows.find((x) => x.transfer_id === row.transfer_id && x.id !== row.id);
  if (!other) return KIND_LABEL[row.kind];
  return row.kind === 'transfer_out' ? `To ${other.account_name}` : `From ${other.account_name}`;
}

// On a cross-currency transfer the two legs hold different amounts, and the one
// you are not looking at is the one you want to check.
function counterAmount(row, rows, money) {
  if (!row.transfer_id) return null;
  const other = rows.find((x) => x.transfer_id === row.transfer_id && x.id !== row.id);
  if (!other || other.currency === row.currency) return null;
  return `${row.kind === 'transfer_in' ? 'sent' : 'arrives as'} ${money(other.amount, other.currency)}`;
}

export default function ActivityList({ month, accountsById, personsById, onChanged, readOnly = false }) {
  const [rows, setRows] = useState([]);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const { money } = useDisplay();

  const load = useCallback(() => {
    setLoading(true);
    listTransactions({ month })
      .then(setRows, () => {})
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    load();
  }, [load, accountsById]);

  async function remove(row) {
    const message = row.transfer_id
      ? 'Delete this transfer? Both sides of it are removed.'
      : 'Delete this entry?';
    if (!window.confirm(message)) return;
    await deleteTransaction(row.id);
    load();
    onChanged();
  }

  const visible = rows.filter((row) => {
    if (filter === 'all') return true;
    if (filter === 'transfers') return Boolean(row.transfer_id);
    return row.kind === filter;
  });

  return (
    <section>
      <div className="section-head">
        <h2>This month</h2>
        <span className="muted" style={{ fontSize: '.8rem' }}>
          Subscriptions live on Recurring
        </span>
      </div>

      <div className="filter-row">
        {FILTERS.map(([key, label]) => (
          <button
            key={key}
            className={filter === key ? 'active' : ''}
            onClick={() => setFilter(key)}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="txn-list">
        {visible.map((row) => {
          const date = when(row.entry_date || row.created_at);
          const person = personsById[row.person_id]?.name;
          const label = describe(row, rows);
          // The icon comes from what you called it, so a list of money can be
          // scanned rather than read.
          const Icon = iconForEntry(row);
          return (
            <div className="txn" key={row.id}>
              <span className={`tile ${toneForEntry(row.kind)}`}>
                <Icon />
              </span>
              <span className="what">
                <b>{label}</b>
                <small>
                  {[
                    row.account_name,
                    person,
                    date,
                    counterAmount(row, rows, money),
                    row.created_by_username,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <span className={isCredit(row.kind) ? 'amt in' : 'amt'}>
                <Money
                  amount={row.amount}
                  currency={row.currency}
                  prefix={isCredit(row.kind) ? '+' : '−'}
                />
              </span>
              {!readOnly && (
                <span className="txn-acts">
                  <button
                    className="icon-button small"
                    title="Edit"
                    aria-label={`Edit ${label}`}
                    onClick={() =>
                      setEditing({
                        ...row,
                        legs: row.transfer_id
                          ? rows.filter((x) => x.transfer_id === row.transfer_id)
                          : null,
                      })
                    }
                  >
                    <Pencil />
                  </button>
                  <button
                    className="icon-button small danger"
                    title="Delete"
                    aria-label={`Delete ${label}`}
                    onClick={() => remove(row)}
                  >
                    <Trash />
                  </button>
                </span>
              )}
            </div>
          );
        })}

        {visible.length === 0 && (
          <div className="txn empty">
            <span className="what muted">
              {loading ? 'Loading…' : 'Nothing recorded this month yet.'}
            </span>
          </div>
        )}
      </div>

      {editing && (
        <TransactionEditModal
          entry={editing}
          accountsById={accountsById}
          month={month}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            load();
            await onChanged();
          }}
        />
      )}
    </section>
  );
}
