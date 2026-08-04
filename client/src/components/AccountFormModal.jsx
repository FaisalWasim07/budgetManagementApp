import { useState } from 'react';
import Modal from './Modal';
import { createAccount, updateAccount, removeAccount } from '../api/accounts';
import { CURRENCIES } from '../utils/currency';

export default function AccountFormModal({ account, personId, personName, onClose, onSaved }) {
  const editing = Boolean(account);
  const [name, setName] = useState(account?.name || '');
  const [currency, setCurrency] = useState(account?.currency || 'AED');
  const [type, setType] = useState(account?.type || 'current');
  const [openingBalance, setOpeningBalance] = useState(account?.openingBalance ?? 0);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

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
        window.alert(
          `"${account.name}" has ${result.transactions} entries and ${result.subscriptions} subscriptions, ` +
            `so it was hidden rather than deleted. Its history stays intact.`
        );
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
            </select>
          </label>
        </div>

        <label className="field">
          Starting balance ({currency})
          <input
            type="number"
            step="0.01"
            value={openingBalance}
            onChange={(e) => setOpeningBalance(e.target.value)}
          />
          <span className="muted">What's already in the account before you record anything.</span>
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
