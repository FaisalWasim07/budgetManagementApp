import { useEffect, useState } from 'react';
import { listContributions, createContribution, deleteContribution } from '../api/entries';
import { formatCurrency } from '../utils/currency';

export default function MultiCurrencyForm({ account, month, onSaved }) {
  const [entries, setEntries] = useState([]);
  const [amount, setAmount] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listContributions(account.id, month).then((data) => {
      if (!cancelled) setEntries(data);
    });
    return () => {
      cancelled = true;
    };
  }, [account.id, month]);

  async function handleAdd(e) {
    e.preventDefault();
    setError(null);
    const value = Number(amount);
    if (!value || value <= 0) {
      setError('Enter a positive amount.');
      return;
    }
    setLoading(true);
    try {
      const entry = await createContribution({ account_id: account.id, month, amount: value, notes });
      setEntries([entry, ...entries]);
      setAmount('');
      setNotes('');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    await deleteContribution(id);
    setEntries(entries.filter((entry) => entry.id !== id));
    onSaved();
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h3>{account.name} Contributions ({account.currency})</h3>
      <form className="row" onSubmit={handleAdd}>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder={`Amount (${account.currency})`}
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ maxWidth: 160 }}
        />
        <input
          type="text"
          placeholder="Notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          style={{ flex: 1, minWidth: 120 }}
        />
        <button type="submit" disabled={loading}>
          Add
        </button>
      </form>
      {error && <div className="error-text">{error}</div>}
      <ul className="entry-list">
        {entries.map((entry) => (
          <li key={entry.id}>
            <span>{entry.notes || 'Contribution'} — {formatCurrency(entry.amount, account.currency)}</span>
            <button onClick={() => handleDelete(entry.id)}>Delete</button>
          </li>
        ))}
        {entries.length === 0 && <li className="muted">No contributions recorded this month.</li>}
      </ul>
    </div>
  );
}
