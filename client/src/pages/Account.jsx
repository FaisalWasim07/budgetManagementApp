import { useCallback, useEffect, useState } from 'react';
import { listTransactions } from '../api/transactions';
import { listSubscriptions } from '../api/subscriptions';
import { Money, useDisplay } from '../utils/display';
import { ChevronLeft, Pencil, Plus, Trash } from './../components/icons';
import { iconForAccount, iconForEntry, toneForEntry } from '../utils/categoryIcon';
import TransactionEditModal from '../components/TransactionEditModal';
import AccountFormModal from '../components/AccountFormModal';
import ToolbarSlot from '../components/ToolbarSlot';
import { useLive } from '../utils/live';

const KIND_LABEL = {
  income: 'Income',
  expense: 'Expense',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

const isCredit = (kind) => kind === 'income' || kind === 'transfer_in';
const isMove = (kind) => kind === 'transfer_in' || kind === 'transfer_out';

function whenOf(entry) {
  const date = entry.entry_date || entry.created_at;
  if (!date) return null;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

const describe = (entry) => entry.category || entry.description || KIND_LABEL[entry.kind];

// An account expanded in place used to push the whole page down and could only
// afford a list. On its own screen it can carry the balance, what moved this
// month, the recurring items that charge it — the answer to "did rent actually
// go out" — and a ledger you can reconcile against a statement.
export default function Account({
  account,
  personName,
  month,
  primaryCurrency,
  onBack,
  onChanged,
  onAddEntry,
  readOnly = false,
  phone = false,
}) {
  const [editing, setEditing] = useState(null);
  const [editingAccount, setEditingAccount] = useState(false);
  const { money } = useDisplay();

  // Its own ledger, and the recurring list shared with every other screen.
  // Both survive going back to Home and opening this account again.
  const { data: entries0, reload: loadEntries } = useLive(
    `ledger:${account.id}:${month}`,
    () => listTransactions({ accountId: account.id, month })
  );
  // The month across every account, purely to pair up a transfer. This ledger
  // holds one account's side of one; the editor needs both, because a transfer
  // is edited as a pair — and the other side is, by definition, in a different
  // account. Same key Activity uses, so it is one request between them.
  const { data: monthRows } = useLive(`transactions:${month}`, () =>
    listTransactions({ month })
  );
  const { data: subs, reload: loadSubs } = useLive(`subscriptions:${month}`, () =>
    listSubscriptions(month)
  );
  const entries = entries0 ?? [];
  const loading = entries0 === undefined;
  const recurring = (subs ?? []).filter(
    (s) => s.account_id === account.id && s.is_active && s.dueThisMonth
  );

  const load = useCallback(() => {
    loadEntries();
    loadSubs();
  }, [loadEntries, loadSubs]);

  const card = account.type === 'credit';
  const owed = card && account.balance < 0;
  const foreign = account.currency !== primaryCurrency;
  const TypeIcon = iconForAccount(account.type);

  const signed = (entry) => (isCredit(entry.kind) ? entry.amount : -entry.amount);
  const inTotal = entries.filter((e) => e.kind === 'income').reduce((s, e) => s + e.amount, 0);
  const outTotal = entries.filter((e) => e.kind === 'expense').reduce((s, e) => s + e.amount, 0);
  const movedTotal = entries.filter((e) => isMove(e.kind)).reduce((s, e) => s + signed(e), 0);

  const recurringNet = recurring.reduce(
    (sum, item) => sum + (item.direction === 'income' ? item.amount : -item.amount),
    0
  );

  // Walked backwards from the month's closing balance, because that is the
  // figure the rest of the app agrees on. Recurring charges are left out of
  // the walk: they belong to the month rather than to a day, so there is no
  // honest place to slot them between two entries. The note below says so.
  let running = account.balance - recurringNet;
  const ledger = entries.map((entry) => {
    const after = running;
    running -= signed(entry);
    return { entry, after };
  });
  const opening = running;

  // A transfer is edited as a pair, so it is opened as one.
  const withLegs = (entry) => ({
    ...entry,
    legs: entry.transfer_id
      ? (monthRows ?? []).filter((r) => r.transfer_id === entry.transfer_id)
      : null,
  });

  const acts = (entry, label) =>
    !readOnly && (
      <span className="txn-acts" onClick={(e) => e.stopPropagation()}>
        <button
          className="icon-button small"
          title="Edit"
          aria-label={`Edit ${label}`}
          onClick={() => setEditing(withLegs(entry))}
        >
          <Pencil />
        </button>
      </span>
    );

  const actions = !readOnly && (
    <>
      <button className="tiny subtle" onClick={() => setEditingAccount(true)}>
        Edit account
      </button>
      <button className="primary add-top" onClick={() => onAddEntry(account)}>
        <Plus size={16} /> Add to this account
      </button>
    </>
  );

  return (
    <section className="account-page">
      {/* At a desk the bar already carries "Home › ADCB Current", so the
          actions join it there rather than making a row of their own. A phone's
          bar has neither, so the row stays. */}
      {phone ? (
        <div className="account-top">
          <button className="tiny subtle back" onClick={onBack}>
            <ChevronLeft /> Home
          </button>
          {!readOnly && <span className="row-tight">{actions}</span>}
        </div>
      ) : (
        <ToolbarSlot>{actions}</ToolbarSlot>
      )}

      <div className="account-cols">
      <div className="account-side">
      <div className="hero account-hero">
        <div>
          {/* The bar already says which account this is, so the card says
              whose it is and what it is counted in. */}
          <p className="label">
            <span className={card ? 'tile card' : 'tile'}>
              <TypeIcon />
            </span>
            Balance · {personName} · {account.currency}
          </p>
          <p className="value">
            <Money
              amount={owed ? -account.balance : account.balance}
              currency={account.currency}
              compact
            />
            {owed && <span className="per"> owed</span>}
          </p>
          <p className="secondary" style={{ margin: 0, fontSize: '.85rem' }}>
            {foreign && account.balancePrimary != null && (
              <>
                ≈ <Money amount={account.balancePrimary} currency={primaryCurrency} compact /> ·{' '}
              </>
            )}
            {foreign && account.balancePrimary == null && (
              <span className="error-text">
                no {account.currency}→{primaryCurrency} rate for this month ·{' '}
              </span>
            )}
            opening <Money amount={account.openingBalance} currency={account.currency} compact />
          </p>
        </div>
      </div>

      <div className="card account-figures">
        <div>
          <span className="k">In</span>
          <span className="v in">
            <Money amount={inTotal} currency={account.currency} compact />
          </span>
        </div>
        <div>
          <span className="k">Out</span>
          <span className="v">
            <Money amount={outTotal} currency={account.currency} compact />
          </span>
        </div>
        <div>
          <span className="k">Moved</span>
          <span className="v moved">
            <Money amount={Math.abs(movedTotal)} currency={account.currency} compact />
          </span>
        </div>
      </div>

      {recurring.length > 0 && (
        <section className="txn-list">
          <div className="panel-h">
            Charges every month
            <small>Listed here so “did rent go out?” needs no arithmetic</small>
          </div>
          <div>
            {recurring.map((item) => (
              <div className="txn" key={`sub-${item.id}`}>
                <span className={`tile ${item.direction === 'income' ? 'in' : ''}`}>
                  {(() => {
                    const Icon = iconForEntry({ category: item.category, description: item.name });
                    return <Icon />;
                  })()}
                </span>
                <span className="what">
                  <b>{item.name}</b>
                  <small>
                    {[item.category, item.cycle === 'yearly' ? 'once a year' : 'every month']
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <span className={item.direction === 'income' ? 'amt in' : 'amt'}>
                  <Money
                    amount={item.amount}
                    currency={account.currency}
                    prefix={item.direction === 'income' ? '+' : '−'}
                  />
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      </div>

      <section className="account-ledger card">
        <div className="panel-h">
          This month
          {/* Said once, in the card's own heading, on both shells — it used
              to be a note above the list at a desk and a second one below it
              on a phone. */}
          <small>
            {recurringNet === 0
              ? 'Every entry that touched this account, newest first'
              : 'Recurring charges are in the balance above but not in the running column — they belong to the month, not to a day'}
          </small>
        </div>

        <div className={phone ? 'txn-list flat' : 'txn-list flat ledger-table'}>
          {!phone && (
            <div className="txn-head" role="row">
              <span>Date</span>
              <span>What</span>
              <span className="r">Amount</span>
              <span className="r">Running</span>
              <span />
            </div>
          )}

          {ledger.map(({ entry, after }) => {
            const label = describe(entry);
            const Icon = iconForEntry(entry);
            const open = () => !readOnly && setEditing(withLegs(entry));
            const rowProps = readOnly
              ? { className: 'txn' }
              : {
                  className: 'txn tappable',
                  onClick: open,
                  role: 'button',
                  tabIndex: 0,
                  'aria-label': `Edit ${label}`,
                  onKeyDown: (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      open();
                    }
                  },
                };
            return phone ? (
              <div key={entry.id} {...rowProps}>
                <span className={`tile ${toneForEntry(entry.kind)}`}>
                  <Icon />
                </span>
                <span className="what">
                  <b>{label}</b>
                  <small>
                    {[label === KIND_LABEL[entry.kind] ? null : KIND_LABEL[entry.kind], whenOf(entry)]
                      .filter(Boolean)
                      .join(' · ')}
                  </small>
                </span>
                <span className={isCredit(entry.kind) ? 'amt in' : 'amt'}>
                  <Money
                    amount={entry.amount}
                    currency={account.currency}
                    prefix={isCredit(entry.kind) ? '+' : '−'}
                  />
                </span>
              </div>
            ) : (
              <div key={entry.id} {...rowProps}>
                <span className="on">{whenOf(entry)}</span>
                <span className="what">
                  <span className={`tile ${toneForEntry(entry.kind)}`}>
                    <Icon />
                  </span>
                  <b>{label}</b>
                </span>
                <span className={isCredit(entry.kind) ? 'amt in' : 'amt'}>
                  <Money
                    amount={entry.amount}
                    currency={account.currency}
                    prefix={isCredit(entry.kind) ? '+' : '−'}
                  />
                </span>
                <span className="amt running">
                  <Money amount={after} currency={account.currency} compact />
                </span>
                {acts(entry, label)}
              </div>
            );
          })}

          {/* Where the month started. Without it the column is a list of
              differences with nothing to difference from. */}
          {!loading && (
            <div className="txn opening">
              {!phone && <span className="on" />}
              <span className="what">
                <b>Opening balance</b>
                {phone && <small>where this month started</small>}
              </span>
              {!phone && <span className="amt muted">—</span>}
              <span className={phone ? 'amt' : 'amt running'}>
                <Money amount={opening} currency={account.currency} compact />
              </span>
              {!phone && <span />}
            </div>
          )}

          {loading && (
            <div className="txn empty">
              <span className="what muted">Loading…</span>
            </div>
          )}
        </div>

      </section>
      </div>

      {editing && (
        <TransactionEditModal
          entry={editing}
          accountsById={{ [account.id]: account }}
          month={month}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            load();
            await onChanged();
          }}
        />
      )}

      {editingAccount && (
        <AccountFormModal
          account={account}
          onClose={() => setEditingAccount(false)}
          onSaved={async () => {
            setEditingAccount(false);
            await onChanged();
          }}
        />
      )}
    </section>
  );
}
