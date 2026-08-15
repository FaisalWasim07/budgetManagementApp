import { useCallback, useEffect, useState } from 'react';
import Dashboard from './pages/Dashboard';
import Stats from './pages/Stats';
import Recurring from './pages/Recurring';
import Activity from './pages/Activity';
import Account from './pages/Account';
import HouseholdSetup from './pages/HouseholdSetup';
import MonthSelector from './components/MonthSelector';
import SettingsModal from './components/SettingsModal';
import HouseholdMenu from './components/HouseholdMenu';
import Sidebar from './components/Sidebar';
import HouseholdModal from './components/HouseholdModal';
import OverflowMenu from './components/OverflowMenu';
import AddSheet from './components/AddSheet';
import Splash from './components/Splash';
import TransferModal from './components/TransferModal';
import { Bars, Eye, EyeOff, Home, List, Mark, Plus, Repeat } from './components/icons';
import { getSummary, getTrend, getCategories } from './api/summary';
import { logout } from './api/auth';
import { listHouseholds } from './api/households';
import { setActiveHousehold } from './api/client';
import { currentMonth } from './utils/month';
import { DisplayContext } from './utils/display';
import { applyTheme, loadTheme, saveTheme, nextTheme } from './utils/theme';

// Four destinations, the same four on both shells. Activity is new: it was the
// tail of Home, which is why Home was the longest screen in the app.
const PAGES = [
  ['dashboard', 'Home', Home],
  ['activity', 'Activity', List],
  ['stats', 'Stats', Bars],
  ['recurring', 'Recurring', Repeat],
];

const LAST_HOUSEHOLD = 'budget.householdId';

const PHONE = '(max-width: 700px)';

const isPhone = () => typeof window !== 'undefined' && window.matchMedia(PHONE).matches;

// The two shells hold the same controls in different places, so only one of
// them may exist at a time. Hiding the spare with CSS leaves a second "Menu"
// button in the page for anything that reads it rather than looks at it.
function usePhone() {
  const [phone, setPhone] = useState(isPhone);
  useEffect(() => {
    const query = window.matchMedia(PHONE);
    const sync = () => setPhone(query.matches);
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);
  return phone;
}

export default function App({ user, onSignedOut }) {
  const [page, setPage] = useState('dashboard');
  // Which account's screen is open. Held as an id rather than the account
  // itself so it survives a reload of the summary — balances change under it.
  const [accountId, setAccountId] = useState(null);
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
  const phone = usePhone();

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
  const openAccount = accountId ? accounts.find((a) => a.id === accountId) : null;

  const goTo = (key) => {
    setAccountId(null);
    setPage(key);
  };

  // N for new. There is one way to record money now — the sheet — so the
  // shortcut opens that rather than reaching for a strip that is no longer on
  // the page.
  useEffect(() => {
    if (readOnly) return undefined;
    const shortcut = (e) => {
      if (e.key?.toLowerCase() !== 'n' || e.metaKey || e.ctrlKey || e.altKey) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName ?? '')) return;
      if (accounts.length > 0) setSheet({ accountId: null });
    };
    document.addEventListener('keydown', shortcut);
    return () => document.removeEventListener('keydown', shortcut);
  }, [readOnly, accounts.length]);

  // Same screen the auth check was already showing, so a cold open is one
  // unbroken splash rather than two that swap.
  if (households === null) return <Splash />;

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
      <div className="shell">
        {/* On a phone the same controls live in the top bar and the bottom
            bar, because there is no width for a column. */}
        {!phone && (
        <Sidebar
          pages={PAGES}
          page={page}
          onPage={goTo}
          households={households}
          household={household}
          onSwitchHousehold={(id) => {
            setSummary(null);
            setHouseholdId(id);
          }}
          onAddHousehold={() => setAddingHousehold(true)}
          onManageHousehold={() => setShowHousehold(true)}
          theme={theme}
          username={user.username}
          role={household?.role ?? ''}
          onCycleTheme={() => setTheme(nextTheme)}
          onSettings={() => setShowSettings(true)}
          onSharing={() => setShowHousehold(true)}
          onSignOut={async () => {
            await logout().catch(() => {});
            onSignedOut();
          }}
        />
        )}

        <div className="pane">
          <header className="topbar">
            <div className="topbar-inner">
              {/* The mark alone on a phone: the wordmark is the first thing
                  worth giving up when the bar has a household and a month to
                  fit. At a desk both live in the sidebar instead. */}
              {phone ? (
                <>
                  <span className="brand">
                    <Mark size={24} />
                  </span>
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
                </>
              ) : (
                <h1 className="page-title">
                  {openAccount ? openAccount.name : PAGES.find(([key]) => key === page)?.[1]}
                </h1>
              )}

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

              {!phone && !readOnly && (
                <button
                  className="primary add-top"
                  disabled={accounts.length === 0}
                  onClick={() => setSheet({ accountId: null })}
                >
                  <Plus size={16} /> Add
                </button>
              )}

              {phone && (
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
              )}
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

        {/* The top bar is already up by now, so this is a placeholder for the
            page under it rather than a screen of its own — no words needed. */}
        {!summary && !error && (
          <div className="card row-tight" style={{ justifyContent: 'center', padding: 28 }}>
            <span className="spinner" role="status" aria-label="Loading" />
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

        {summary && !empty && page === 'dashboard' && openAccount && (
          <Account
            account={openAccount}
            personName={openAccount.personName}
            month={month}
            primaryCurrency={summary.primaryCurrency}
            onBack={() => setAccountId(null)}
            onChanged={load}
            onAddEntry={(account) => setSheet({ accountId: account.id })}
            readOnly={readOnly}
            phone={phone}
          />
        )}

        {summary && !empty && page === 'dashboard' && !openAccount && (
          <Dashboard
            summary={summary}
            trend={trend}
            categories={categories}
            month={month}
            onChanged={load}
            onOpenAccount={(account) => setAccountId(account.id)}
            onSeeActivity={() => goTo('activity')}
            userId={user.id}
            readOnly={readOnly}
          />
        )}

        {summary && !empty && page === 'stats' && (
          <Stats summary={summary} trend={trend} categories={categories} month={month} />
        )}

        {summary && !empty && page === 'activity' && (
          <Activity
            summary={summary}
            month={month}
            onChanged={load}
            readOnly={readOnly}
            phone={phone}
          />
        )}

        {summary && !empty && page === 'recurring' && (
          <Recurring summary={summary} month={month} onChanged={load} readOnly={readOnly} />
        )}
          </main>
        </div>
      </div>

      {/* Phone only. Adding money is the middle of the bar because it is the
          one thing you do standing at a till, and the two destinations either
          side of it are the two you open most. */}
      <nav className="tabbar" aria-label="Sections">
        {PAGES.slice(0, 2).map(([key, label, Icon]) => (
          <button
            key={key}
            className={page === key ? 'active' : ''}
            aria-current={page === key ? 'page' : undefined}
            onClick={() => goTo(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
        {!readOnly && (
          <button
            className="add"
            aria-label="Add money"
            disabled={accounts.length === 0}
            onClick={() => setSheet({ accountId: null })}
          >
            <Plus />
          </button>
        )}
        {PAGES.slice(2).map(([key, label, Icon]) => (
          <button
            key={key}
            className={page === key ? 'active' : ''}
            aria-current={page === key ? 'page' : undefined}
            onClick={() => goTo(key)}
          >
            <Icon />
            {label}
          </button>
        ))}
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
