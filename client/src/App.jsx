import { useCallback, useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Subscriptions from './pages/Subscriptions';
import MonthSelector from './components/MonthSelector';
import SettingsModal from './components/SettingsModal';
import { getSummary, getTrend, getCategories } from './api/summary';
import { currentMonth } from './utils/month';

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [s, t, c] = await Promise.all([getSummary(month), getTrend(12), getCategories(month)]);
      setSummary(s);
      setTrend(t);
      setCategories(c);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stack">
      <div className="appbar">
        <h1>Household Budget</h1>
        <div className="row-tight">
          <nav className="nav">
            <button
              className={page === 'dashboard' ? 'active' : ''}
              onClick={() => setPage('dashboard')}
            >
              Dashboard
            </button>
            <button
              className={page === 'subscriptions' ? 'active' : ''}
              onClick={() => setPage('subscriptions')}
            >
              Subscriptions
            </button>
          </nav>
          <button onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </div>

      <MonthSelector month={month} onChange={setMonth} />

      {error && <div className="card error-text">Couldn’t load: {error}</div>}
      {!summary && !error && <p className="muted">Loading…</p>}

      {summary && page === 'dashboard' && (
        <Dashboard
          summary={summary}
          trend={trend}
          categories={categories}
          month={month}
          onChanged={load}
        />
      )}

      {summary && page === 'subscriptions' && (
        <Subscriptions summary={summary} month={month} onChanged={load} />
      )}

      {showSettings && summary && (
        <SettingsModal
          primaryCurrency={summary.primaryCurrency}
          rates={summary.rates}
          onClose={() => setShowSettings(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
