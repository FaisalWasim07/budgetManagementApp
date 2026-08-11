import { useCallback, useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Stats from './pages/Stats';
import Subscriptions from './pages/Subscriptions';
import HouseholdSetup from './pages/HouseholdSetup';
import MonthSelector from './components/MonthSelector';
import SettingsModal from './components/SettingsModal';
import TopBarToggles from './components/TopBarToggles';
import HouseholdMenu from './components/HouseholdMenu';
import HouseholdModal from './components/HouseholdModal';
import { getSummary, getTrend, getCategories } from './api/summary';
import { logout } from './api/auth';
import { listHouseholds } from './api/households';
import { setActiveHousehold } from './api/client';
import { currentMonth } from './utils/month';
import { DisplayContext } from './utils/display';
import { applyTheme, loadTheme, saveTheme, nextTheme } from './utils/theme';

const PAGES = [
  ['dashboard', 'Dashboard'],
  ['stats', 'Stats'],
  ['subscriptions', 'Subscriptions'],
];

const LAST_HOUSEHOLD = 'budget.householdId';

export default function App({ user, onSignedOut }) {
  const [page, setPage] = useState('dashboard');
  const [month, setMonth] = useState(currentMonth());
  const [households, setHouseholds] = useState(null);
  const [householdId, setHouseholdId] = useState(() => {
    const saved = Number(localStorage.getItem(LAST_HOUSEHOLD));
    return Number.isFinite(saved) && saved > 0 ? saved : null;
  });
  const [addingHousehold, setAddingHousehold] = useState(false);
  const [showHousehold, setShowHousehold] = useState(false);
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [categories, setCategories] = useState([]);
  const [showSettings, setShowSettings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [amountsHidden, setAmountsHidden] = useState(
    () => localStorage.getItem('budget.amountsHidden') === '1'
  );
  const [theme, setTheme] = useState(loadTheme);

  const household = households?.find((h) => h.id === householdId) ?? null;
  const readOnly = household?.role === 'viewer';

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem('budget.amountsHidden', amountsHidden ? '1' : '0');
  }, [amountsHidden]);

  // Which household the API talks to has to be set before any data request, so
  // it is pushed into the client rather than passed through every call.
  useEffect(() => {
    setActiveHousehold(householdId);
    if (householdId) localStorage.setItem(LAST_HOUSEHOLD, String(householdId));
  }, [householdId]);

  const loadHouseholds = useCallback(async () => {
    const list = await listHouseholds();
    setHouseholds(list);
    // A remembered household that has since been left falls back to the first
    // one they still belong to, rather than to an error.
    setHouseholdId((current) => {
      if (current && list.some((h) => h.id === current)) return current;
      return list[0]?.id ?? null;
    });
    return list;
  }, []);

  useEffect(() => {
    loadHouseholds().catch((err) => setError(err.message));
  }, [loadHouseholds]);

  // The summary is what every page reads, so it loads first and the heavier
  // chart queries follow — the dashboard is usable without waiting for them.
  const load = useCallback(async () => {
    if (!householdId) return;
    setActiveHousehold(householdId);
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
  }, [month, householdId]);

  useEffect(() => {
    load();
  }, [load]);

  if (households === null) {
    return (
      <div className="auth-screen">
        <div className="card row-tight auth-card">
          <span className="spinner" aria-hidden="true" />
          <span className="secondary">Loading…</span>
        </div>
      </div>
    );
  }

  // No household at all, or they asked to add one. Either way the budget can't
  // be shown, so this takes over the screen rather than hiding in a corner.
  if (households.length === 0 || addingHousehold) {
    return (
      <HouseholdSetup
        onCancel={households.length > 0 ? () => setAddingHousehold(false) : null}
        onReady={async (id) => {
          setAddingHousehold(false);
          setSummary(null);
          await loadHouseholds();
          setHouseholdId(id);
        }}
      />
    );
  }

  return (
    <DisplayContext.Provider value={{ amountsHidden }}>
      <div className="stack">
        <div className="appbar">
          <h1>Household Budget</h1>
          <div className="row-tight">
            <HouseholdMenu
              households={households}
              current={household}
              onSwitch={(id) => {
                setSummary(null);
                setHouseholdId(id);
              }}
              onAdd={() => setAddingHousehold(true)}
              onManage={() => setShowHousehold(true)}
            />
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
            <TopBarToggles
              amountsHidden={amountsHidden}
              onToggleAmounts={() => setAmountsHidden((v) => !v)}
              theme={theme}
              onCycleTheme={() => setTheme(nextTheme)}
            />
            <button onClick={() => setShowSettings(true)}>Settings</button>
            <button
              className="subtle"
              title={`Signed in as ${user.username}`}
              onClick={async () => {
                await logout().catch(() => {});
                onSignedOut();
              }}
            >
              Sign out
            </button>
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

        {readOnly && (
          <div className="warn-banner">
            You have view-only access to {household.name}. You can see everything here but not
            change it.
          </div>
        )}

        {error && <div className="card error-text">Couldn’t load: {error}</div>}

        {!summary && !error && (
          <div className="card row-tight">
            <span className="spinner" aria-hidden="true" />
            <span className="secondary">Loading your budget…</span>
          </div>
        )}

        {summary && summary.persons.length === 0 && (
          <div className="card stack-sm">
            <h2>Nobody in this household yet</h2>
            <span className="secondary">
              Add the people whose money you are tracking. Each one starts with a main account you
              can record income and spending against.
            </span>
            <button
              className="primary"
              style={{ alignSelf: 'flex-start' }}
              onClick={() => setShowHousehold(true)}
            >
              Add a person
            </button>
          </div>
        )}

        {summary && summary.persons.length > 0 && page === 'dashboard' && (
          <Dashboard summary={summary} month={month} onChanged={load} readOnly={readOnly} />
        )}

        {summary && summary.persons.length > 0 && page === 'stats' && (
          <Stats summary={summary} trend={trend} categories={categories} month={month} />
        )}

        {summary && summary.persons.length > 0 && page === 'subscriptions' && (
          <Subscriptions summary={summary} month={month} onChanged={load} readOnly={readOnly} />
        )}

        {showSettings && summary && (
          <SettingsModal
            primaryCurrency={summary.primaryCurrency}
            rates={summary.rates}
            user={user}
            readOnly={readOnly}
            onSignedOut={onSignedOut}
            onClose={() => setShowSettings(false)}
            onSaved={load}
          />
        )}

        {showHousehold && household && (
          <HouseholdModal
            household={household}
            user={user}
            persons={summary?.persons ?? []}
            onClose={() => setShowHousehold(false)}
            onChanged={async (result) => {
              if (result?.left) {
                setShowHousehold(false);
                setSummary(null);
                setHouseholdId(null);
              }
              await loadHouseholds();
              await load();
            }}
          />
        )}
      </div>
    </DisplayContext.Provider>
  );
}
