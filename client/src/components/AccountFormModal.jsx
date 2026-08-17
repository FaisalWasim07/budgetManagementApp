import { useState } from 'react';
import Modal from './Modal';
import { createAccount, updateAccount, removeAccount } from '../api/accounts';
import { CURRENCIES } from '../utils/currency';
import { useToast } from '../utils/toast';

export default function AccountFormModal({ account, personId, personName, onClose, onSaved }) {
  const editing = Boolean(account);
  const [name, setName] = useState(account?.name || '');
  const [currency, setCurrency] = useState(account?.currency || 'AED');
  const [type, setType] = useState(account?.type || 'current');
  const [openingBalance, setOpeningBalance] = useState(account?.openingBalance ?? 0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const { show } = useToast();

  async function save(e) {
    e.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError('Give the account a name.');
      return;
    }
    setBusy(true);
    try {
      const payload = {
        name: name.trim(),
        currency,
        type,
        opening_balance: Number(openingBalance) || 0,
      };
      if (editing) await updateAccount(account.id, payload);
      else await createAccount({ ...payload, person_id: personId });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function handleDelete() {
    setBusy(true);
    try {
      const result = await removeAccount(account.id);
      if (result.deactivated) {
        // Keeping the rows means the history behind past months stays intact.
        // Said in passing rather than in a dialog: nothing went wrong and there
        // is nothing to decide, so there is nothing to stop for.
        show(`"${account.name}" was hidden, not deleted`, {
          tone: 'warn',
          body:
            `${result.transactions} entries and ${result.subscriptions} recurring items still ` +
            `refer to it, so their history stays intact.`,
        });
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${account.name}` : `New account for ${personName}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <label className="field">
          Account name
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Emirates NBD, PKR Savings"
            autoFocus
          />
        </label>

        <div className="row">
          <label className="field grow">
            Currency
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            Kind
            <select value={type} onChange={(e) => setType(e.target.value)}>
              <option value="current">Spending</option>
              <option value="savings">Savings</option>
              <option value="credit">Credit card</option>
            </select>
          </label>
        </div>

        <label className="field">
          {type === 'credit' ? `Already owed (${currency})` : `Starting balance (${currency})`}
          {/* Deliberately no inputMode="decimal": a credit card's balance
              is entered as a negative, and that keypad has no minus key. */}
          <input
            type="number"
            step="0.01"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
          />
          <span className="muted">
            {type === 'credit'
              ? 'Enter what you currently owe as a negative number, e.g. −1500. Spending on the card pushes it further down; paying it off with a transfer brings it back toward zero.'
              : "What's already in the account before you record anything."}
          </span>
        </label>

        {error && <div className="error-text">{error}</div>}

        <div className="spread">
          {editing ? (
            <button type="button" className="danger" onClick={handleDelete} disabled={busy}>
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="row-tight">
            <button type="button" onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      </form>
    </Modal>
  );
}
