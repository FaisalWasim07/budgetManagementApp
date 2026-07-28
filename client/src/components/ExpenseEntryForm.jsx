import { useEffect, useState } from 'react';
import { listExpenseEntries, createExpenseEntry, deleteExpenseEntry } from '../api/entries';
import { formatCurrency } from '../utils/currency';

export default function ExpenseEntryForm({ accountId, month, onSaved }) {
  const [entries, setEntries] = useState([]);
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    listExpenseEntries(accountId, month).then((data) => {
      if (!cancelled) setEntries(data);
    });
    return () => {
      cancelled = true;
    };
  }, [accountId, month]);

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
      const entry = await createExpenseEntry({ account_id: accountId, month, amount: value, description });
      setEntries([entry, ...entries]);
      setAmount('');
      setDescription('');
      onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(id) {
    await deleteExpenseEntry(id);
    setEntries(entries.filter((entry) => entry.id !== id));
    onSaved();
  }

  return (
    <div className="card stack" style={{ gap: 8 }}>
      <h3>Expenses</h3>
      <form className="row" onSubmit={handleAdd}>
        <input
          type="number"
          min="0"
          step="0.01"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          style={{ maxWidth: 120 }}
        />
        <input
          type="text"
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
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
            <span>{entry.description || 'Expense'} — {formatCurrency(entry.amount, 'AED')}</span>
            <button onClick={() => handleDelete(entry.id)}>Delete</button>
          </li>
        ))}
        {entries.length === 0 && <li className="muted">No expenses recorded this month.</li>}
      </ul>
    </div>
  );
}
