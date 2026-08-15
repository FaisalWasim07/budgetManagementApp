import { useEffect, useMemo, useState } from 'react';
import Modal from './Modal';
import { createTransfer } from '../api/transactions';
import { useDisplay } from '../utils/display';
import { formatNumber } from '../utils/currency';

// Both accounts carry their own rate into the household's primary currency, so
// going from one to the other is just via that: AED per PKR divided by AED per
// whatever you are sending. Null when either side has no rate, which is a real
// state — a currency the app has never managed to fetch.
function convertBetween(amount, from, to) {
  const fromRate = from?.rate?.rate;
  const toRate = to?.rate?.rate;
  if (!(amount > 0) || fromRate == null || toRate == null || !toRate) return null;
  const converted = (amount * fromRate) / toRate;
  // Cents matter on a hundred; on a hundred thousand rupees they are noise, and
  // an estimate carrying two decimals looks more certain than it is.
  return converted >= 1000 ? Math.round(converted) : Math.round(converted * 100) / 100;
}

export default function TransferModal({ accounts, month, onClose, onSaved }) {
  const [fromId, setFromId] = useState(accounts[0]?.id ?? '');
  const [toId, setToId] = useState(accounts[1]?.id ?? '');
  const [amount, setAmount] = useState('');
  const [toAmount, setToAmount] = useState('');
  // Once you type your own arriving amount, the estimate stops overwriting it —
  // the bank's number always wins over the app's guess.
  const [ownAmount, setOwnAmount] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { money } = useDisplay();

  const from = useMemo(() => accounts.find((a) => a.id === Number(fromId)), [accounts, fromId]);
  const to = useMemo(() => accounts.find((a) => a.id === Number(toId)), [accounts, toId]);
  const crossCurrency = from && to && from.currency !== to.currency;
  const estimate = crossCurrency ? convertBetween(Number(amount), from, to) : null;

  // Changing either account changes the whole question, so the estimate takes
  // over again.
  useEffect(() => {
    setOwnAmount(false);
  }, [fromId, toId]);

  useEffect(() => {
    if (!ownAmount) setToAmount(estimate == null ? '' : String(estimate));
  }, [estimate, ownAmount]);

  // What the numbers on screen actually imply, so a stray digit is obvious
  // before it is saved rather than a month later.
  const impliedRate =
    crossCurrency && Number(amount) > 0 && Number(toAmount) > 0
      ? Number(toAmount) / Number(amount)
      : null;

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
        `${from.name} only has ${money(available, from.currency)} available. ` +
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
      onClose();
      onSaved();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const label = (a) => `${a.personName} · ${a.name} (${a.currency}) — ${money(a.balance, a.currency, { compact: true })}`;

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
                : `Available: ${money(available, from.currency)}`}
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
              onChange={(e) => {
                setOwnAmount(true);
                setToAmount(e.target.value);
              }}
            />
            <span className="muted">
              {estimate == null
                ? `These accounts use different currencies, and there is no ${from.currency}→${to.currency} rate, so enter what actually lands in ${to.currency}.`
                : 'Estimated at today’s rate. Change it to what your bank actually gave you.'}
              {impliedRate != null && (
                <>
                  {' '}
                  That works out to <strong>1 {from.currency} = {formatNumber(impliedRate)} {to.currency}</strong>.
                </>
              )}
            </span>
          </label>
        )}

        {error && <div className="error-text">{error}</div>}

        <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy || overdrawn}>
            {busy ? (
                <>
                  <span className="spinner on-button" aria-hidden="true" /> Saving…
                </>
              ) : (
                'Transfer'
              )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
