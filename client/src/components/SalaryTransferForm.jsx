import { useEffect, useState } from 'react';
import { upsertMonthlyEntry } from '../api/entries';
import { formatCurrency } from '../utils/currency';

export default function SalaryTransferForm({ personId, month, monthlyEntry, onSaved }) {
  const [salary, setSalary] = useState(0);
  const [toSavings, setToSavings] = useState(0);
  const [toExpense, setToExpense] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setSalary(monthlyEntry?.salary_amount ?? 0);
    setToSavings(monthlyEntry?.transfer_to_savings ?? 0);
    setToExpense(monthlyEntry?.transfer_to_expense ?? 0);
    setError(null);
  }, [personId, month, monthlyEntry]);

  const remainder = salary - toSavings - toExpense;

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    if (toSavings + toExpense > salary) {
      setError('Transfers cannot exceed salary.');
      return;
    }
    setSaving(true);
    try {
      const updated = await upsertMonthlyEntry({
        person_id: personId,
        month,
        salary_amount: Number(salary),
        transfer_to_savings: Number(toSavings),
        transfer_to_expense: Number(toExpense),
      });
      onSaved(updated);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="card stack" style={{ gap: 8 }} onSubmit={handleSubmit}>
      <h3>Salary &amp; Transfers</h3>
      <div className="row">
        <label className="field" style={{ flex: 1 }}>
          Salary (AED)
          <input type="number" min="0" step="0.01" value={salary} onChange={(e) => setSalary(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          To Savings
          <input type="number" min="0" step="0.01" value={toSavings} onChange={(e) => setToSavings(e.target.value)} />
        </label>
        <label className="field" style={{ flex: 1 }}>
          To Expense
          <input type="number" min="0" step="0.01" value={toExpense} onChange={(e) => setToExpense(e.target.value)} />
        </label>
      </div>
      <div className="secondary">Remaining in primary this month: {formatCurrency(remainder, 'AED')}</div>
      {error && <div className="error-text">{error}</div>}
      <button className="primary" type="submit" disabled={saving}>
        {saving ? 'Saving…' : 'Save'}
      </button>
    </form>
  );
}
