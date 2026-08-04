import { useCallback, useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Stats from './pages/Stats';
import Subscriptions from './pages/Subscriptions';
import MonthSelector from './components/MonthSelector';
import SettingsModal from './components/SettingsModal';
import { getSummary, getTrend, getCategories } from './api/summary';
import { currentMonth } from './utils/month';

const PAGES = [
  ['dashboard', 'Dashboard'],
  ['stats', 'Stats'],
  ['subscriptions', 'Subscriptions'],
];

export default function App() {
  const [page, setPage] = useState('dashboard');
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // The summary is what every page reads, so it loads first and the heavier
  // chart queries follow — the dashboard is usable without waiting for them.
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setSummary(await getSummary(month));
      setError(null);
      const [t, c] = await Promise.all([getTrend(12), getCategories(month)]);
      setTrend(t);
      setCategories(c);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
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
            {PAGES.map(([key, label]) => (
              <button
                key={key}
                className={page === key ? 'active' : ''}
                onClick={() => setPage(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          <button onClick={() => setShowSettings(true)}>Settings</button>
        </div>
      </div>

      <div className="spread">
        <MonthSelector month={month} onChange={setMonth} />
        {loading && (
          <span className="loading" aria-live="polite">
            <span className="spinner" aria-hidden="true" /> Updating…
          </span>
        )}
      </div>

      {error && <div className="card error-text">Couldn’t load: {error}</div>}

      {!summary && !error && (
        <div className="card row-tight">
          <span className="spinner" aria-hidden="true" />
          <span className="secondary">Loading your budget…</span>
        </div>
      )}

      {summary && page === 'dashboard' && (
        <Dashboard summary={summary} month={month} onChanged={load} />
      )}

      {summary && page === 'stats' && (
        <Stats summary={summary} trend={trend} categories={categories} month={month} />
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
