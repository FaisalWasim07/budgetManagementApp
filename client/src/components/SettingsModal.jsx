import { useEffect, useState } from 'react';
import Modal from './Modal';
import { getSettings, updateSettings } from '../api/settings';
import { refreshRates } from '../api/exchangeRates';
import { CURRENCIES } from '../utils/currency';

const SOURCE_LABELS = {
  live: 'live',
  manual: 'your fallback',
  cache: 'cached',
  none: 'unavailable',
  same: '—',
};

export default function SettingsModal({ primaryCurrency, rates, onClose, onSaved }) {
  const [currency, setCurrency] = useState(primaryCurrency);
  const [manual, setManual] = useState({});
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const [error, setError] = useState(null);

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

  return (
    <Modal title="Settings" onClose={onClose}>
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
              Used whenever the live rate can't be fetched, so your totals still add up. Leave blank
              to use the last known rate instead. Live lookups give up after 4 seconds rather than
              holding up the page.
            </span>
          )}
        </div>

        {note && <div className="secondary" style={{ fontSize: '0.85rem' }}>{note}</div>}
        {error && <div className="error-text">{error}</div>}

        <div className="row-tight" style={{ justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="primary" disabled={busy}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}
