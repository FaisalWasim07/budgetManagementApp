import { useMemo, useState } from 'react';
import Modal from './Modal';
import { createTransfer } from '../api/transactions';
import { formatCurrency } from '../utils/currency';

export default function TransferModal({ accounts, month, onClose, onSaved }) {
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '');
  const [toId, setToId] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const from = useMemo(() => accounts.find((a) => a.id === Number(fromId)), [accounts, fromId]);
  const to = useMemo(() => accounts.find((a) => a.id === Number(toId)), [accounts, toId]);
  const crossCurrency = from && to && from.currency !== to.currency;

  // Cards are allowed to go negative — that's borrowing, not an overdraft.
  const fromIsCredit = from?.type === 'credit';
  const available = from ? from.balance : 0;
  const overdrawn = !fromIsCredit && Number(amount) > available;

  async function submit(e) {
    e.preventDefault();
    setError(null);
    if (Number(fromId) === Number(toId)) {
      setError('Pick two different accounts.');
      return;
    }
    if (!(Number(amount) > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }
    if (overdrawn) {
      setError(
        `${from.name} only has ${formatCurrency(available, from.currency)} available. ` +
          `Reduce the amount, or move money in first.`
      );
      return;
    }
    if (crossCurrency && !(Number(toAmount) > 0)) {
      setError(`Enter how much arrives in ${to.currency}.`);
      return;
    }
    setBusy(true);
    try {
      await createTransfer({
        from_account_id: Number(fromId),
        to_account_id: Number(toId),
        month,
        amount: Number(amount),
        ...(crossCurrency ? { to_amount: Number(toAmount) } : {}),
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const label = (a) => `${a.personName} · ${a.name} (${a.currency}) — ${formatCurrency(a.balance, a.currency, { compact: true })}`;

  return (
    <Modal title="Move money between accounts" onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        <label className="field">
          From
          <select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          To
          <select value={toId} onChange={(e) => setToId(e.target.value)}>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {label(a)}
              </option>
            ))}
          </select>
        </label>

        <label className="field">
          Amount leaving {from ? `(${from.currency})` : ''}
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            autoFocus
          />
          {from && (
            <span className={overdrawn ? 'error-text' : 'muted'}>
              {fromIsCredit
                ? 'Credit card — spending on it adds to what you owe.'
                : `Available: ${formatCurrency(available, from.currency)}`}
            </span>
          )}
        </label>

        {crossCurrency && (
          <label className="field">
            Amount arriving ({to.currency})
            <input
              type="number"
              min="0"
              step="0.01"
              value={toAmount}
              onChange={(e) => setToAmount(e.target.value)}
            />
            <span className="muted">
              These accounts use different currencies, so enter what actually lands in {to.currency} —
              that way the record matches your bank rather than an estimate.
            </span>
          </label>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || overdrawn}>
            {busy ? 'Saving…' : 'Transfer'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
