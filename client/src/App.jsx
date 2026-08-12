import { useCallback, useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Stats from './pages/Stats';
import Subscriptions from './pages/Subscriptions';
import HouseholdSetup from './pages/HouseholdSetup';
import MonthSelector from './components/MonthSelector';
import SettingsModal from './components/SettingsModal';
import HouseholdMenu from './components/HouseholdMenu';
import HouseholdModal from './components/HouseholdModal';
import OverflowMenu from './components/OverflowMenu';
import AddSheet from './components/AddSheet';
import TransferModal from './components/TransferModal';
import { Bars, Eye, EyeOff, Home, Plus, Repeat } from './components/icons';
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
  ['subscriptions', 'Recurring'],
];

const LAST_HOUSEHOLD = 'budget.householdId';

const isPhone = () =>
  typeof window !== 'undefined' && window.matchMedia('(max-width: 700px)').matches;

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
  const [sheet, setSheet] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Always on when the app opens. Anyone can be looking over your shoulder on a
  // phone, and a setting that remembers "shown" is a setting that shows your
  // balance to the room the moment you unlock it.
  const [amountsHidden, setAmountsHidden] = useState(true);
  const [theme, setTheme] = useState(loadTheme);

  const household = households?.find((h) => h.id === householdId) ?? null;
  const readOnly = household?.role === 'viewer';

  useEffect(() => {
    applyTheme(theme);
    saveTheme(theme);
  }, [theme]);

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
      const [t, c] = await Promise.all([getTrend(12, month), getCategories(month)]);
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

  const accounts =
    summary?.persons.flatMap((p) => p.accounts.map((a) => ({ ...a, personName: p.name }))) ?? [];

  // N for new. On a phone that means the sheet; at a desk it means the strip
  // that is already on screen, so it puts the cursor there instead.
  useEffect(() => {
    if (readOnly) return undefined;
    const shortcut = (e) => {
      if (e.key?.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
      const quick = document.getElementById('quick-amount');
      if (isPhone() || !quick || page !== 'dashboard') {
        if (accounts.length > 0) setSheet({ accountId: null });
      } else {
        e.preventDefault();
        quick.focus();
      }
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [readOnly, page, accounts.length]);

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

  const empty = summary && summary.persons.length === 0;

  return (
    <DisplayContext.Provider value={{ amountsHidden }}>
      <header className="topbar">
        <div className="topbar-inner">
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

          <span className="spacer" />

          {loading && <span className="spinner" aria-label="Updating" />}

          <MonthSelector month={month} onChange={setMonth} />

          <button
            className="icon-button"
            onClick={() => setAmountsHidden((v) => !v)}
            title={amountsHidden ? 'Show amounts' : 'Hide amounts'}
            aria-label={amountsHidden ? 'Show amounts' : 'Hide amounts'}
            aria-pressed={amountsHidden}
          >
            {amountsHidden ? <EyeOff /> : <Eye />}
          </button>

          <OverflowMenu
            theme={theme}
            username={user.username}
            onCycleTheme={() => setTheme(nextTheme)}
            onSettings={() => setShowSettings(true)}
            onSharing={() => setShowHousehold(true)}
            onSignOut={async () => {
              await logout().catch(() => {});
              onSignedOut();
            }}
          />
        </div>
      </header>

      <main className="stack">
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

        {empty && (
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

        {summary && !empty && page === 'dashboard' && (
          <Dashboard
            summary={summary}
            trend={trend}
            categories={categories}
            month={month}
            onChanged={load}
            onAddEntry={(accountId) => setSheet({ accountId })}
            readOnly={readOnly}
          />
        )}

        {summary && !empty && page === 'stats' && (
          <Stats summary={summary} trend={trend} categories={categories} month={month} />
        )}

        {summary && !empty && page === 'subscriptions' && (
          <Subscriptions summary={summary} month={month} onChanged={load} readOnly={readOnly} />
        )}
      </main>

      {/* Phone only. Adding money is the middle of the bar because it is the
          one thing you do standing at a till. */}
      <nav className="tabbar" aria-label="Sections">
        <button
          className={page === 'dashboard' ? 'active' : ''}
          aria-current={page === 'dashboard' ? 'page' : undefined}
          onClick={() => setPage('dashboard')}
        >
          <Home />
          Home
        </button>
        <button
          className={page === 'stats' ? 'active' : ''}
          aria-current={page === 'stats' ? 'page' : undefined}
          onClick={() => setPage('stats')}
        >
          <Bars />
          Stats
        </button>
        <button
          className="add"
          aria-label="Add money"
          disabled={readOnly || accounts.length === 0}
          onClick={() => setSheet({ accountId: null })}
        >
          <Plus />
        </button>
        <button
          className={page === 'subscriptions' ? 'active' : ''}
          aria-current={page === 'subscriptions' ? 'page' : undefined}
          onClick={() => setPage('subscriptions')}
        >
          <Repeat />
          Recurring
        </button>
      </nav>

      {accounts.length > 0 && (
        <AddSheet
          open={Boolean(sheet)}
          accounts={accounts}
          categories={categories.map((c) => c.category)}
          month={month}
          defaultAccountId={sheet?.accountId}
          onClose={() => setSheet(null)}
          onSaved={load}
          onMove={() => setShowTransfer(true)}
        />
      )}

      {showTransfer && (
        <TransferModal
          accounts={accounts}
          month={month}
          onClose={() => setShowTransfer(false)}
          onSaved={load}
        />
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
    </DisplayContext.Provider>
  );
}
