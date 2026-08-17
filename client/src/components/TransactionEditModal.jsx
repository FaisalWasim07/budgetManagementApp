import { useState } from 'react';
import { useToast } from '../utils/toast';
import Modal from './Modal';
import MonthPicker from './MonthPicker';
import { formatMonth } from '../utils/month';
import { Trash } from './icons';
import { updateTransaction } from '../api/transactions';

const KIND_LABELS = { income: 'Income', expense: 'Expense' };

// One modal for both shapes an entry can take. A transfer is edited as a pair:
// the two sides carry their own amounts, because a cross-currency transfer
// records what actually left one account and what actually arrived in the
// other, not an estimate derived from a rate.
export default function TransactionEditModal({
  entry,
  accountsById,
  month,
  onClose,
  onSaved,
  onDelete,
}) {
  // A transfer is two rows and is edited as one thing, so both are needed. If
  // only one arrived, this says so rather than throwing on the missing half —
  // an exception here unmounts the whole app and leaves a blank page, which is
  // exactly what a caller that forgot to pair them up used to cause.
  const legs = entry.legs ?? [];
  const isTransfer = Boolean(entry.transfer_id);
  const outLeg = isTransfer ? legs.find((l) => l.kind === 'transfer_out') : null;
  const inLeg = isTransfer ? legs.find((l) => l.kind === 'transfer_in') : null;
  const incomplete = isTransfer && (!outLeg || !inLeg);
  // Read off the leg itself rather than looked up. The lookup only holds
  // accounts still active in the household, so a transfer out of an account
  // that has since been closed rendered as "Left ()" with no name — the row
  // knew both, and the dialog was asking somewhere that didn't.
  const nameOf = (leg) => leg?.account_name ?? accountsById[leg?.account_id]?.name ?? 'another account';
  const currencyOf = (leg) => leg?.currency ?? accountsById[leg?.account_id]?.currency ?? '';
  const crossCurrency = isTransfer && currencyOf(outLeg) !== currencyOf(inLeg);

  const [form, setForm] = useState({
    amount: String(isTransfer ? outLeg?.amount ?? entry.amount : entry.amount),
    toAmount: String(isTransfer ? inLeg?.amount ?? '' : ''),
    kind: entry.kind,
    category: entry.category ?? '',
    description: entry.description ?? '',
    month: entry.month,
  });
  const [busy, setBusy] = useState(false);
  const { show } = useToast();
  const [error, setError] = useState(null);

  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });

  async function save(e) {
    e.preventDefault();
    const amount = Number(form.amount);
    if (!(amount > 0)) {
      setError('Enter an amount greater than zero.');
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const body = {
        amount,
        month: form.month,
        description: form.description.trim() || null,
      };
      if (isTransfer) {
        const toAmount = Number(form.toAmount);
        if (!(toAmount > 0)) {
          setError('Enter what arrived in the other account.');
          setBusy(false);
          return;
        }
        body.to_amount = toAmount;
      } else {
        body.kind = form.kind;
        body.category = form.category.trim() || null;
      }

      await updateTransaction(isTransfer ? outLeg.id : entry.id, body);
      onClose();
      onSaved();
      show('Entry updated', { tone: 'success' });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  // Both halves of a transfer have to be in hand before it can be edited, and
  // saying so is the whole of the failure. It was a blank page before.
  if (incomplete) {
    return (
      <Modal title="Edit transfer" onClose={onClose}>
        <div className="stack">
          <p className="secondary" style={{ margin: 0 }}>
            The other side of this transfer isn’t loaded, so it can’t be edited safely — changing
            one half on its own would leave the two disagreeing. Open it from Activity, which has
            both.
          </p>
          <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
            <button type="button" onClick={onClose}>
              Close
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={isTransfer ? 'Edit transfer' : 'Edit entry'} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        {isTransfer ? (
          <>
            <span className="secondary" style={{ fontSize: '0.88rem' }}>
              <b>{nameOf(outLeg)}</b> → <b>{nameOf(inLeg)}</b>
            </span>
            <div className="row">
              <label className="field grow">
                Left ({currencyOf(outLeg)})
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={set('amount')}
                  autoFocus
                />
              </label>
              <label className="field grow">
                Arrived ({currencyOf(inLeg)})
                <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.toAmount}
                  onChange={set('toAmount')}
                />
              </label>
            </div>
            {crossCurrency && (
              <span className="muted" style={{ fontSize: '0.8rem' }}>
                Different currencies, so both sides are recorded — whatever your bank actually did,
                including its spread.
              </span>
            )}
          </>
        ) : (
          <div className="row">
            <label className="field">
              Type
              <select value={form.kind} onChange={set('kind')}>
                {Object.entries(KIND_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label className="field grow">
              Amount ({entry.currency ?? accountsById[entry.account_id]?.currency ?? ''})
              <input
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={set('amount')}
                  autoFocus
                />
            </label>
            <label className="field grow">
              Category
              <input type="text" value={form.category} onChange={set('category')} />
            </label>
          </div>
        )}

        <label className="field">
          Description
          <input type="text" value={form.description} onChange={set('description')} />
        </label>

        {/* Which month it counts in. Almost never what you opened this to
            change, so it stays folded away — but a receipt typed in on the 2nd
            for something bought on the 30th does need it, and it was the last
            native month control left in the app. */}
        <details className="tuck" open={form.month !== month}>
          <summary>Counts in {formatMonth(form.month)}</summary>
          <MonthPicker
            label="Counts in"
            value={form.month}
            onChange={(v) => setForm((f) => ({ ...f, month: v }))}
          />
          {form.month !== month && (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Moving this to {formatMonth(form.month)} takes it out of the month you’re looking at.
            </span>
          )}
        </details>

        {error && <div className="error-text">{error}</div>}

        {/* Delete lives here rather than as a second icon on every row: on a
            phone those icons cost each entry a line of its own, and this is
            the screen you are already on when you want to remove one. */}
        <div className="row-tight" style={{ justifyContent: 'space-between' }}>
          {onDelete ? (
            <button type="button" className="danger" disabled={busy} onClick={() => onDelete(entry)}>
              <Trash size={15} /> Delete
            </button>
          ) : (
            <span />
          )}
          <span className="row-tight">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? (
                <>
                  <span className="spinner on-button" aria-hidden="true" /> Saving…
                </>
              ) : (
                'Save'
              )}
            </button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
