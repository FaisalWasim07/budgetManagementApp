import { useState } from 'react';
import Modal from './Modal';
import { updateSettings } from '../api/settings';
import { refreshRates } from '../api/exchangeRates';
import { CURRENCIES } from '../utils/currency';

export default function SettingsModal({ primaryCurrency, rates, onClose, onSaved }) {
  const [currency, setCurrency] = useState(primaryCurrency);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  const rateRows = Object.entries(rates || {}).filter(([code]) => code !== primaryCurrency);

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await updateSettings({ primary_currency: currency });
      onSaved();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    try {
      await refreshRates();
      onSaved();
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
            Every balance is converted into this for the household totals and charts. Accounts keep
            their own currency.
          </span>
        </label>

        <div className="stack-sm">
          <div className="spread">
            <strong style={{ fontSize: '0.9rem' }}>Exchange rates</strong>
            <button type="button" className="tiny" onClick={refresh} disabled={busy}>
              Refresh
            </button>
          </div>
          {rateRows.length === 0 && <span className="muted">No other currencies in use yet.</span>}
          {rateRows.map(([code, info]) => (
            <div key={code} className="spread" style={{ fontSize: '0.85rem' }}>
              <span>
                1 {code} → {primaryCurrency}
              </span>
              <span className={info.rate == null ? 'error-text' : ''}>
                {info.rate == null ? 'unavailable' : info.rate.toFixed(4)}
                {info.stale && info.rate != null ? ' (cached)' : ''}
              </span>
            </div>
          ))}
        </div>

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
