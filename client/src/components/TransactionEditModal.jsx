import { useState } from 'react';
import Modal from './Modal';
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
  const isTransfer = Boolean(entry.transfer_id);
  const outLeg = isTransfer ? entry.legs.find((l) => l.kind === 'transfer_out') : null;
  const inLeg = isTransfer ? entry.legs.find((l) => l.kind === 'transfer_in') : null;
  // Read off the leg itself rather than looked up. The lookup only holds
  // accounts still active in the household, so a transfer out of an account
  // that has since been closed rendered as "Left ()" with no name — the row
  // knew both, and the dialog was asking somewhere that didn't.
  const nameOf = (leg) => leg?.account_name ?? accountsById[leg?.account_id]?.name ?? 'another account';
  const currencyOf = (leg) => leg?.currency ?? accountsById[leg?.account_id]?.currency ?? '';
  const crossCurrency = isTransfer && currencyOf(outLeg) !== currencyOf(inLeg);

  const [form, setForm] = useState({
    amount: String(isTransfer ? outLeg.amount : entry.amount),
    toAmount: String(isTransfer ? inLeg.amount : ''),
    kind: entry.kind,
    category: entry.category ?? '',
    description: entry.description ?? '',
    month: entry.month,
  });
  const [busy, setBusy] = useState(false);
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
      await onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
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
                <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} autoFocus />
              </label>
              <label className="field grow">
                Arrived ({currencyOf(inLeg)})
                <input
                  type="number"
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
              <input type="number" min="0" step="0.01" value={form.amount} onChange={set('amount')} autoFocus />
            </label>
            <label className="field grow">
              Category
              <input type="text" value={form.category} onChange={set('category')} />
            </label>
          </div>
        )}

        <div className="row">
          <label className="field grow">
            Description
            <input type="text" value={form.description} onChange={set('description')} />
          </label>
          <label className="field">
            Month
            <input type="month" value={form.month} onChange={set('month')} />
          </label>
        </div>

        {form.month !== month && (
          <span className="muted" style={{ fontSize: '0.8rem' }}>
            Moving this to {form.month} takes it out of the month you're looking at.
          </span>
        )}

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
              {busy ? 'Saving…' : 'Save'}
            </button>
          </span>
        </div>
      </form>
    </Modal>
  );
}
