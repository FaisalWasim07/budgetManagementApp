import { useState } from 'react';
import { createTransaction } from '../api/transactions';
import { Exchange } from './icons';

// The desk half of entering money. It stays exactly where it is after saving,
// because at a laptop you enter five things in a row and a sheet that closes
// after each one is five extra clicks. The phone gets the sheet instead.
export default function QuickAdd({ accounts, categories, month, onSaved, onMove }) {
  const [kind, setKind] = useState('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? '');
  const [category, setCategory] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const account = accounts.find((a) => a.id === Number(accountId)) ?? accounts[0];

  async function submit(e) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!account) {
      setError('Add an account first.');
      return;
    }
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
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card quick" onSubmit={submit}>
      {/* Two choices, not three. Spent and Received pick which kind of entry
          this is; moving money opens a different form entirely, and a segmented
          control that quietly contains a button is a lie about what it does. */}
      <div className="seg-mini" role="group" aria-label="What happened">
        <button
          type="button"
          className={kind === 'expense' ? 'active' : ''}
          aria-pressed={kind === 'expense'}
          onClick={() => setKind('expense')}
        >
          Spent
        </button>
        <button
          type="button"
          className={kind === 'income' ? 'active' : ''}
          aria-pressed={kind === 'income'}
          onClick={() => setKind('income')}
        >
          Received
        </button>
      </div>

      <input
        id="quick-amount"
        className="amt num"
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        placeholder={account ? `Amount (${account.currency})` : 'Amount'}
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        aria-label="Amount"
      />

      <select
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
        aria-label="Account"
        style={{ width: 'auto', maxWidth: 220 }}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.personName} · {a.name}
          </option>
        ))}
      </select>

      <input
        className="grow"
        type="text"
        list="quick-categories"
        placeholder={kind === 'income' ? 'e.g. Salary' : 'e.g. Groceries'}
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        aria-label="Category"
      />
      <datalist id="quick-categories">
        {categories.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <button className="primary" type="submit" disabled={busy}>
        Add
      </button>

      {/* type="button" so it can never submit the strip on its way to opening
          a different form. */}
      <button className="move" type="button" onClick={onMove} disabled={accounts.length < 2}>
        <Exchange />
        Move money
      </button>

      {error ? (
        <span className="error-text">{error}</span>
      ) : (
        <span className="hint">
          or press <kbd>N</kbd>
        </span>
      )}
    </form>
  );
}
