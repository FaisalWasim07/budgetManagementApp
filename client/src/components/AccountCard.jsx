import { useEffect, useState } from 'react';
import { createTransaction, deleteTransaction, listTransactions } from '../api/transactions';
import { useDisplay } from '../utils/display';

const KIND_LABELS = {
  income: 'Income',
  expense: 'Expense',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

export default function AccountCard({ account, month, primaryCurrency, onChanged, onEdit }) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState([]);
  const [kind, setKind] = useState('expense');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const { money } = useDisplay();
  const isForeign = account.currency !== primaryCurrency;
  const isCredit = account.type === 'credit';
  const { activity } = account;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    listTransactions({ accountId: account.id, month }).then(
      (data) => {
        if (!cancelled) setEntries(data);
      },
      () => {}
    );
    return () => {
      cancelled = true;
    };
  }, [open, account.id, month, account.balance]);

  async function add(e) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!(value > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    setBusy(true);
    try {
      await createTransaction({
        account_id: account.id,
        month,
        kind,
        amount: value,
        category: category.trim() || null,
      });
      setAmount('');
      setCategory('');
      onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id) {
    await deleteTransaction(id);
    onChanged();
  }

  return (
    <div className="account stack-sm">
      <div className="account-head">
        <div className="grow">
          <div className="row-tight">
            <h3>{account.name}</h3>
            <span className="badge">{account.currency}</span>
            {account.type === 'savings' && <span className="badge">Savings</span>}
            {isCredit && <span className="badge">Credit card</span>}
          </div>
          {/* A card's negative balance is money owed, so show it that way round. */}
          <div className="account-balance" style={isCredit && account.balance < 0 ? { color: 'var(--danger)' } : undefined}>
            {isCredit && account.balance < 0
              ? `${money(-account.balance, account.currency)} owed`
              : money(account.balance, account.currency)}
          </div>
          {isForeign && (
            <div className="account-converted">
              {account.balancePrimary != null
                ? `≈ ${money(account.balancePrimary, primaryCurrency)}`
                : `Not converted — no ${account.currency}→${primaryCurrency} rate`}
            </div>
          )}
        </div>
        <button className="subtle tiny" onClick={() => onEdit(account)}>
          Edit
        </button>
      </div>

      <div className="row-tight secondary" style={{ fontSize: '0.8rem' }}>
        <span>In {money(activity.income + activity.transferIn, account.currency, { compact: true })}</span>
        <span>·</span>
        <span>
          Out{' '}
          {money(
            activity.expense + activity.transferOut + activity.subscriptions,
            account.currency,
            { compact: true }
          )}
        </span>
        {activity.subscriptions > 0 && (
          <>
            <span>·</span>
            <span>Subs {money(activity.subscriptions, account.currency, { compact: true })}</span>
          </>
        )}
      </div>

      <form className="row-tight" onSubmit={add}>
        <select value={kind} onChange={(e) => setKind(e.target.value)} style={{ width: 'auto' }}>
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder={`Amount (${account.currency})`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ width: 130 }}
        />
        <input
          type="text"
          placeholder={kind === 'income' ? 'e.g. Salary' : 'e.g. Groceries'}
          value={category}
          onChange={(e) => setCategory(e.target.value)}
          style={{ flex: 1, minWidth: 110 }}
        />
        <button className="primary tiny" type="submit" disabled={busy}>
          Add
        </button>
      </form>

      {error && <div className="error-text">{error}</div>}

      <button className="subtle tiny" onClick={() => setOpen(!open)} style={{ alignSelf: 'flex-start' }}>
        {open ? 'Hide' : 'Show'} this month’s entries
      </button>

      {open && (
        <ul className="entries">
          {entries.map((t) => (
            <li key={t.id}>
              <span className="grow">
                {t.category || t.description || KIND_LABELS[t.kind]}
                <span className="muted"> · {KIND_LABELS[t.kind]}</span>
              </span>
              <span>
                {['income', 'transfer_in'].includes(t.kind) ? '+' : '−'}
                {money(t.amount, account.currency)}
              </span>
              <button className="subtle tiny danger" onClick={() => remove(t.id)}>
                Delete
              </button>
            </li>
          ))}
          {entries.length === 0 && <li className="muted">Nothing recorded this month.</li>}
        </ul>
      )}
    </div>
  );
}
