import { useEffect, useState } from 'react';
import Modal from './Modal';
import LoginSettings from './LoginSettings';
import PasskeySettings from './PasskeySettings';
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
}) {
  const [currency, setCurrency] = useState(primaryCurrency);
  const [manual, setManual] = useState({});
  const [busy, setBusy] = useState(false);
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

  // Money and account are two unrelated jobs, and stacking them made one box
  // tall enough to need its own scrollbar. Either alone fits.
  const moneyTab = () => (
    <form className="stack" onSubmit={save}>
        <label className="field">
          Primary currency
          <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span className="muted">
            Everything is converted into this for the household totals. Accounts keep their own
            currency.
          </span>
        </label>

        <div className="stack-sm">
          <div className="spread">
            <strong style={{ fontSize: '0.9rem' }}>Exchange rates</strong>
            <button type="button" className="tiny" onClick={refresh} disabled={busy}>
              {busy ? 'Checking…' : 'Refresh now'}
            </button>
          </div>

          {otherCurrencies.length === 0 && (
            <span className="muted">No other currencies in use yet.</span>
          )}

          {otherCurrencies.map((code) => {
            const info = rates[code] || {};
            return (
              <div key={code} className="stack-sm" style={{ gap: 4 }}>
                <div className="spread" style={{ fontSize: '0.85rem' }}>
                  <span>
                    1 {code} → {primaryCurrency}
                  </span>
                  <span className={info.rate == null ? 'error-text' : ''}>
                    {info.rate == null ? 'unavailable' : info.rate.toFixed(6)}
                    <span className="muted"> ({SOURCE_LABELS[info.source] || info.source})</span>
                  </span>
                </div>
                <label className="field">
                  Fallback rate for {code}
                  <input
                    type="number"
                    step="0.000001"
                    min="0"
                    placeholder="e.g. 0.0128"
                    value={manual[code] ?? ''}
                    onChange={(e) => setManual({ ...manual, [code]: e.target.value })}
                  />
                </label>
              </div>
            );
          })}

          {otherCurrencies.length > 0 && (
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Used whenever no live rate can be fetched, so your totals still add up. Leave blank to
              use the last known rate instead.
            </span>
          )}

          {otherCurrencies.length > 0 && (
            <>
              <div className="spread">
                <strong style={{ fontSize: '0.9rem' }}>Rate sources</strong>
                <button type="button" className="tiny" onClick={runDiagnosis} disabled={busy}>
                  Test connection
                </button>
              </div>

              {!diagnosis && (
                <span className="muted" style={{ fontSize: '0.8rem' }}>
                  Rates are tried against several providers in turn. Test them if a rate isn't
                  showing, to see which one is at fault.
                </span>
              )}

              {diagnosis?.results.map((r) => (
                <div key={r.base} className="stack-sm" style={{ gap: 2 }}>
                  <span style={{ fontSize: '0.85rem' }}>
                    <strong>
                      {r.base} → {r.target}
                    </strong>
                  </span>
                  {r.providers.map((p) => (
                    <div key={p.provider} className="spread" style={{ fontSize: '0.8rem' }}>
                      <span className="muted">{p.provider}</span>
                      <span className={p.ok ? '' : 'muted'}>
                        {p.ok ? `${p.rate} · ${p.ms}ms` : p.reason}
                      </span>
                    </div>
                  ))}
                </div>
              ))}
            </>
          )}
        </div>

        {note && <div className="secondary" style={{ fontSize: '0.85rem' }}>{note}</div>}
        {error && <div className="error-text">{error}</div>}

        <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
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
  const accountTab = () => (
    <div className="stack">
      {/* onSaved so that saying which person you are reorders the dashboard
          behind the dialog straight away. */}
      <LoginSettings user={user} onSignedOut={onSignedOut} onChanged={onSaved} />
      <hr className="divider" />
      <PasskeySettings locked={locked} onLockedChange={onLockedChange} />
    </div>
  );

  return (
    <Modal
      title="Settings"
      onClose={onClose}
      tabs={[
        ['money', 'Money', moneyTab],
        ['account', 'Account', accountTab],
      ]}
    />
  );
}
