import { useEffect, useRef, useState } from 'react';
import { createTransaction } from '../api/transactions';
import { Exchange } from './icons';

// The phone half of entering money: thumb at the bottom of the screen, the
// amount the biggest thing on it, and one tap to save. Also what "Add to this
// account" opens on any size of screen, since it already knows the account.
export default function AddSheet({
  open,
  accounts,
  categories,
  month,
  defaultAccountId,
  onClose,
  onSaved,
  onMove,
}) {
  const [kind, setKind] = useState('expense');
  const [amount, setAmount] = useState('');
  const [accountId, setAccountId] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const amountField = useRef(null);

  // Each opening starts clean, on whichever account it was opened from.
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setCategory('');
    setError(null);
    setAccountId(String(defaultAccountId ?? accounts[0]?.id ?? ''));
    const focus = setTimeout(() => amountField.current?.focus(), 220);
    return () => clearTimeout(focus);
  }, [open, defaultAccountId, accounts]);

  useEffect(() => {
    if (!open) return undefined;
    const escape = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', escape);
    return () => document.removeEventListener('keydown', escape);
  }, [open, onClose]);

  const account = accounts.find((a) => a.id === Number(accountId)) ?? accounts[0];
  const suggestions = categories.slice(0, 6);

  async function save() {
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
      // Closed as soon as the entry is recorded. Waiting for the figures to be
      // recomputed as well kept the sheet up for the length of four round
      // trips, which on a slow connection is a form that looks frozen. The
      // refresh runs behind it, with the top bar's spinner saying so.
      onClose();
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {open && <div className="sheet-scrim" onClick={onClose} />}
      <div
        className={open ? 'sheet open' : 'sheet'}
        role="dialog"
        aria-modal="true"
        aria-label="Add money"
        aria-hidden={!open}
      >
        <div className="grabber" />

        {/* Two, not three. Moving money is a different form, and it lives
            below the Save button rather than pretending to be a third mode. */}
        <div className="seg two" role="group" aria-label="What happened">
          <button
            className={kind === 'expense' ? 'active' : ''}
            aria-pressed={kind === 'expense'}
            onClick={() => setKind('expense')}
          >
            Spent
          </button>
          <button
            className={kind === 'income' ? 'active' : ''}
            aria-pressed={kind === 'income'}
            onClick={() => setKind('income')}
          >
            Received
          </button>
        </div>

        <div className="amount-field">
          <div className="cur">{account?.currency ?? ''}</div>
          <input
            ref={amountField}
            className="num"
            type="text"
            inputMode="decimal"
            placeholder="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
            onKeyDown={(e) => e.key === 'Enter' && save()}
            aria-label="Amount"
          />
        </div>

        <label className="field">
          <span className="label">{kind === 'income' ? 'Into' : 'From'}</span>
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.personName} · {a.name} ({a.currency})
              </option>
            ))}
          </select>
        </label>

        <div className="field" style={{ marginTop: 14 }}>
          <span className="label">Category</span>
          <div className="chips">
            {suggestions.map((c) => (
              <button
                key={c}
                className={category === c ? 'active' : ''}
                aria-pressed={category === c}
                onClick={() => setCategory(category === c ? '' : c)}
              >
                {c}
              </button>
            ))}
          </div>
          <input
            type="text"
            placeholder={kind === 'income' ? 'e.g. Salary' : 'or type one'}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            aria-label="Category"
            style={{ marginTop: 8 }}
          />
        </div>

        {error && <div className="error-text" style={{ marginTop: 12 }}>{error}</div>}

        <button
          className="primary"
          onClick={save}
          disabled={busy}
          style={{ width: '100%', marginTop: 16, padding: '12px' }}
        >
          {busy ? (
            <>
              <span className="spinner on-button" aria-hidden="true" /> Saving…
            </>
          ) : (
            'Save'
          )}
        </button>

        <button
          className="move-alt"
          onClick={() => {
            onClose();
            onMove();
          }}
          disabled={accounts.length < 2}
        >
          <Exchange />
          Move money
        </button>
      </div>
    </>
  );
}
