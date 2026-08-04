import { useCallback, useEffect, useState } from 'react';
import { listTransactions, deleteTransaction } from '../api/transactions';
import { formatCurrency } from '../utils/currency';

const KIND_LABELS = {
  income: 'Income',
  expense: 'Expense',
  transfer_in: 'Transfer in',
  transfer_out: 'Transfer out',
};

const isCredit = (kind) => kind === 'income' || kind === 'transfer_in';

export default function TransactionsTable({ month, accountsById, personsById, onChanged }) {
  const [rows, setRows] = useState([]);
  const [filter, setFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    listTransactions({ month })
      .then(setRows)
      .finally(() => setLoading(false));
  }, [month]);

  useEffect(() => {
    load();
  }, [load, accountsById]);

  async function remove(row) {
    const isTransfer = Boolean(row.transfer_id);
    const message = isTransfer
      ? 'Delete this transfer? Both sides of it are removed.'
      : 'Delete this entry?';
    if (!window.confirm(message)) return;
    await deleteTransaction(row.id);
    load();
    onChanged();
  }

  const visible = rows.filter((r) => {
    if (filter === 'all') return true;
    if (filter === 'transfers') return Boolean(r.transfer_id);
    return r.kind === filter;
  });

  return (
    <section className="card stack">
      <div className="spread">
        <div>
          <h2>Transactions</h2>
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Everything recorded this month, newest first.
          </span>
        </div>
        <div className="row-tight">
          {['all', 'income', 'expense', 'transfers'].map((f) => (
            <button
              key={f}
              className={`tiny${filter === f ? ' primary' : ''}`}
              onClick={() => setFilter(f)}
            >
              {f[0].toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Description</th>
              <th>Type</th>
              <th>Person</th>
              <th>Account</th>
              <th className="num">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr key={r.id}>
                <td>{r.category || r.description || KIND_LABELS[r.kind]}</td>
                <td>
                  <span className="badge">{KIND_LABELS[r.kind]}</span>
                </td>
                <td>{personsById[r.person_id]?.name || '—'}</td>
                <td>{r.account_name}</td>
                <td className="num" style={{ color: isCredit(r.kind) ? 'var(--success)' : undefined }}>
                  {isCredit(r.kind) ? '+' : '−'}
                  {formatCurrency(r.amount, r.currency)}
                </td>
                <td>
                  <button className="subtle tiny danger" onClick={() => remove(r)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={6} className="muted">
                  {loading ? 'Loading…' : 'Nothing recorded this month yet.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <span className="muted" style={{ fontSize: '0.8rem' }}>
        Subscriptions aren't listed here — they're charged automatically and live on the
        Subscriptions tab.
      </span>
    </section>
  );
}
