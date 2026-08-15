import { useCallback, useEffect, useState } from 'react';
import { listTransactions, deleteTransaction } from '../api/transactions';
import { useLive } from '../utils/live';
import { Money } from '../utils/display';
import { iconForEntry, toneForEntry } from '../utils/categoryIcon';
import TransactionEditModal from './TransactionEditModal';
import { Pencil, Trash } from './icons';

const KIND_LABEL = {
  income: 'Income',
  expense: 'Expense',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

const isCredit = (kind) => kind === 'income' || kind === 'transfer_in';

function when(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round((midnight - new Date(date.toDateString())) / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function describe(row, rows) {
  if (row.category || row.description) return row.category || row.description;
  if (!row.transfer_id) return KIND_LABEL[row.kind];
  const other = rows.find((x) => x.transfer_id === row.transfer_id && x.id !== row.id);
  if (!other) return KIND_LABEL[row.kind];
  return row.kind === 'transfer_out' ? `To ${other.account_name}` : `From ${other.account_name}`;
}

// The last handful of entries, next to the accounts they came out of. Activity
// has the whole month; this is the "is that already in?" glance you take after
// paying for something, and it does not cost Home its length the way the full
// list did.
export default function Latest({
  month,
  onSeeAll,
  limit = 5,
  accountsById = {},
  onChanged,
  readOnly = false,
}) {
  const [editing, setEditing] = useState(null);

  // The same list Activity reads, under the same key: one request serves both,
  // and correcting an entry here updates it there without a second round trip.
  const { data, reload: load } = useLive(`transactions:${month}`, () =>
    listTransactions({ month })
  );
  const rows = data ?? [];
  const loading = data === undefined;

  const shown = rows.slice(0, limit);

  // These are the same entries Activity lists, so they open the same editor.
  // A row you can read but not correct is a row that sends you to another
  // screen to do the obvious thing with it.
  const open = (row) =>
    setEditing({
      ...row,
      legs: row.transfer_id ? rows.filter((x) => x.transfer_id === row.transfer_id) : null,
    });

  const remove = async (row) => {
    const message = row.transfer_id
      ? 'Delete this transfer? Both sides of it are removed.'
      : 'Delete this entry?';
    if (!window.confirm(message)) return false;
    await deleteTransaction(row.id);
    load();
    onChanged?.();
    return true;
  };

  return (
    <section className="card latest">
      <div className="latest-head">
        <h2>Latest</h2>
        {rows.length > limit && (
          <button className="tiny subtle" onClick={onSeeAll}>
            See all {rows.length}
          </button>
        )}
      </div>

      {shown.map((row) => {
        const Icon = iconForEntry(row);
        const label = describe(row, rows);
        return (
          <div
            className={readOnly ? 'txn' : 'txn tappable'}
            key={row.id}
            {...(readOnly
              ? {}
              : {
                  onClick: () => open(row),
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `Edit ${label}`,
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open(row);
                    }
                  },
                })}
          >
            <span className={`tile ${toneForEntry(row.kind)}`}>
              <Icon />
            </span>
            <span className="what">
              <b>{label}</b>
              <small>
                {[row.account_name, when(row.entry_date || row.created_at)]
                  .filter(Boolean)
                  .join(' · ')}
              </small>
            </span>
            <span className={isCredit(row.kind) ? 'amt in' : 'amt'}>
              <Money
                amount={row.amount}
                currency={row.currency}
                prefix={isCredit(row.kind) ? '+' : '−'}
                compact
              />
            </span>

            {!readOnly && (
              <span className="txn-acts" onClick={(e) => e.stopPropagation()}>
                <button
                  className="icon-button small"
                  title="Edit"
                  aria-label={`Edit ${label}`}
                  onClick={() => open(row)}
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

      {shown.length === 0 && (
        <div className="txn empty">
          <span className="what muted">
            {loading ? 'Loading…' : 'Nothing recorded this month yet.'}
          </span>
        </div>
      )}

      {editing && (
        <TransactionEditModal
          entry={editing}
          accountsById={accountsById}
          month={month}
          onClose={() => setEditing(null)}
          onDelete={async (row) => {
            if (await remove(row)) setEditing(null);
          }}
          onSaved={async () => {
            load();
            await onChanged?.();
          }}
        />
      )}
    </section>
  );
}
