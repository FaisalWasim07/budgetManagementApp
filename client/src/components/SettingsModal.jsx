import { useEffect, useState } from 'react';
import Modal from './Modal';
import LoginSettings from './LoginSettings';
import PasskeySettings from './PasskeySettings';
import NotificationSettings from './NotificationSettings';
import AccentSettings from './AccentSettings';
import SettingsSection from './SettingsSection';
import { Coins, Exchange, Gear, Pulse, User, Wallet } from './icons';
import { useToast } from '../utils/toast';
import { getSettings, updateSettings } from '../api/settings';
import { refreshRates, diagnoseRates } from '../api/exchangeRates';
import { CURRENCIES } from '../utils/currency';

const SOURCE_LABELS = {
  live: 'live',
  manual: 'your fallback',
  cache: 'cached',
  none: 'unavailable',
  same: '—',
};

export default function SettingsModal({
  primaryCurrency,
  rates,
  user,
  readOnly = false,
  onSignedOut,
  onClose,
  onSaved,
  locked,
  onLockedChange,
  onPasskeysChange,
  accent,
  onAccentChange,
  initialTab,
  // Which section to arrive with already open. Something that sends you
  // here for one specific job — the passkey nudge's own button — should not
  // land you on three closed rows to hunt through for the thing it just
  // offered you.
  openSection,
}) {
  const [currency, setCurrency] = useState(primaryCurrency);
  const [manual, setManual] = useState({});
  const [busy, setBusy] = useState(false);
  const { show } = useToast();
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);
  const [diagnosis, setDiagnosis] = useState(null);

  const otherCurrencies = Object.keys(rates || {}).filter((c) => c !== primaryCurrency);

  useEffect(() => {
    getSettings()
      .then((s) => setManual(s.manualRates || {}))
      .catch(() => {});
  }, []);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateSettings({ primary_currency: currency, manualRates: manual });
      await onSaved();
      onClose();
      show('Settings saved', { tone: 'success', body: `Everything totals in ${currency}.` });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setNote(null);
    setError(null);
    try {
      const result = await refreshRates();
      const failed = Object.entries(result.rates || {})
        .filter(([code, info]) => code !== result.primaryCurrency && info.source !== 'live')
        .map(([code]) => code);
      setNote(
        failed.length
          ? `Couldn't reach the rate service for ${failed.join(', ')}. Your fallback value is being used where set.`
          : 'Rates updated.'
      );
      await onSaved();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function runDiagnosis() {
    setBusy(true);
    setDiagnosis(null);
    setError(null);
    try {
      setDiagnosis(await diagnoseRates());
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  // Money and account are two unrelated jobs, each a tab of its own. Within
  // Money, three cards: what everything totals in, the rates that get it
  // there, and the services those rates come from.
  const moneyTab = () => (
    <form className="set-sections" onSubmit={save}>
      <SettingsSection
        icon={<Coins />}
        title="Primary currency"
        subtitle="What the household totals are in. Accounts keep their own currency."
        state={currency}
      >
        <label className="field set-field-narrow">
          <span className="label">Currency</span>
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
      </SettingsSection>

      <SettingsSection
        icon={<Exchange />}
        title="Exchange rates"
        subtitle="Fetched daily. A fallback is used whenever no live rate can be reached."
        state={otherCurrencies.length ? `${otherCurrencies.length} in use` : 'None in use'}
      >
        {otherCurrencies.length === 0 && (
          <span className="muted">No other currencies in use yet.</span>
        )}
        {otherCurrencies.length > 0 && (
          <div className="rate-rows">
            {otherCurrencies.map((code) => {
              const info = rates[code] || {};
              return (
                <div key={code} className="rate-row">
                  <span className="rate-pair">
                    <b>
                      1 {code} → {primaryCurrency}
                    </b>
                    <small className={info.rate == null ? 'error-text' : 'muted'}>
                      {info.rate == null ? 'unavailable' : info.rate.toFixed(6)} ·{' '}
                      {SOURCE_LABELS[info.source] || info.source}
                    </small>
                  </span>
                  <label className="field">
                    <span className="label">Fallback</span>
                    <input
                      type="number"
                      inputMode="decimal"
                      step="0.000001"
                      min="0"
                      placeholder="e.g. 0.0128"
                      value={manual[code] ?? ''}
                      aria-label={`Fallback rate for ${code}`}
                      onChange={(e) => setManual({ ...manual, [code]: e.target.value })}
                    />
                  </label>
                </div>
              );
            })}
          </div>
        )}
        <div className="set-actions-row">
          <button type="button" className="pill-outline" onClick={refresh} disabled={busy}>
            {busy ? 'Checking…' : 'Refresh now'}
          </button>
          {note && <span className="muted">{note}</span>}
        </div>
      </SettingsSection>

      {otherCurrencies.length > 0 && (
        <SettingsSection
          icon={<Pulse />}
          title="Rate sources"
          subtitle="Rates are tried against several providers in turn."
          defaultOpen={false}
          state={diagnosis ? 'Tested' : 'Not tested'}
        >
          <div className="set-actions-row">
            <button type="button" className="pill-outline" onClick={runDiagnosis} disabled={busy}>
              Test connection
            </button>
            {!diagnosis && <span className="muted">If a rate isn’t showing, this shows which one is at fault.</span>}
          </div>
          {diagnosis?.results.map((r) => (
            <div key={r.base} className="stack-sm" style={{ gap: 2 }}>
              <strong style={{ fontSize: '0.85rem' }}>
                {r.base} → {r.target}
              </strong>
              {r.providers.map((p) => (
                <div key={p.provider} className="spread" style={{ fontSize: '0.8rem' }}>
                  <span className="muted">{p.provider}</span>
                  <span className={p.ok ? '' : 'muted'}>{p.ok ? `${p.rate} · ${p.ms}ms` : p.reason}</span>
                </div>
              ))}
            </div>
          ))}
        </SettingsSection>
      )}

      {error && <div className="error-text">{error}</div>}

      <div className="set-footer">
        <button type="button" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="submit" className="primary" disabled={busy || readOnly}>
          Save
        </button>
      </div>
    </form>
  );

  // Deliberately not inside the form above: pressing Enter in a password field
  // must not save currency settings.
  // Three jobs, each a row that says where it stands and opens when asked.
  // They used to be stacked open with a rule between them, which came to most
  // of a laptop screen inside a dialog and could not be scanned: three
  // headings the same weight as each other and as everything under them.
  // The rules are gone with the stacking — a closed row is already a boundary,
  // and a line between two of them would be drawing the same edge twice.
  const accountTab = () => (
    <div className="set-sections">
      {/* onSaved so that saying which person you are reorders the dashboard
          behind the dialog straight away. */}
      <LoginSettings user={user} onSignedOut={onSignedOut} onChanged={onSaved} />
      <PasskeySettings
        defaultOpen={openSection === 'signing-in'}
        locked={locked}
        onLockedChange={onLockedChange}
        onPasskeysChange={onPasskeysChange}
      />
      <NotificationSettings />
      <AccentSettings accent={accent} onChange={onAccentChange} />
    </div>
  );

  return (
    <Modal
      title="Settings"
      side
      icon={<Gear />}
      className="settings"
      onClose={onClose}
      initialTab={initialTab}
      tabs={[
        [
          'money',
          'Money',
          moneyTab,
          {
            icon: <Wallet size={20} />,
            heading: 'Money Settings',
            subtitle: 'Your household’s currency and exchange rates.',
          },
        ],
        [
          'account',
          'Account',
          accountTab,
          {
            icon: <User />,
            heading: 'Account Settings',
            subtitle: 'Manage your account, sign-in and preferences.',
          },
        ],
      ]}
    />
  );
}
