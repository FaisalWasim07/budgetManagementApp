import { useState } from 'react';
import { refreshRate } from '../api/exchangeRates';
import { formatCurrency } from '../utils/currency';

export default function HouseholdSummary({ summary, onRefresh }) {
  const [refreshing, setRefreshing] = useState(false);
  const { household, persons } = summary;

  const foreignAccount = persons
    .flatMap((p) => p.accounts)
    .find((a) => a.currency !== 'AED');

  async function handleRefreshRate() {
    if (!foreignAccount) return;
    setRefreshing(true);
    try {
      await refreshRate(foreignAccount.currency, 'AED');
      onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <section className="card stack">
      <h2>Household Summary</h2>
      <div className="row">
        <div className="stat">
          <span className="value">{formatCurrency(household.totalIncome, 'AED')}</span>
          <span className="label">Income this month</span>
        </div>
        <div className="stat">
          <span className="value">{formatCurrency(household.totalExpenses, 'AED')}</span>
          <span className="label">Expenses this month</span>
        </div>
        <div className="stat">
          <span className="value">{formatCurrency(household.netWorthAED, 'AED')}</span>
          <span className="label">Total net worth (AED)</span>
        </div>
        <div className="stat">
          <span className="value">
            {formatCurrency(household.currencyComposition.AED, 'AED')} / {formatCurrency(household.currencyComposition.foreignAED, 'AED')}
          </span>
          <span className="label">AED accounts / Foreign-in-AED</span>
        </div>
      </div>
      {foreignAccount && (
        <div className="row secondary" style={{ alignItems: 'center' }}>
          <span>
            {foreignAccount.currency} → AED rate: {foreignAccount.rate?.rate != null ? foreignAccount.rate.rate.toFixed(4) : 'unavailable'}
            {foreignAccount.rate?.fetchedAt ? ` (as of ${new Date(foreignAccount.rate.fetchedAt).toLocaleString()})` : ''}
            {foreignAccount.rate?.stale ? ' · cached/stale' : ''}
          </span>
          <button onClick={handleRefreshRate} disabled={refreshing}>
            {refreshing ? 'Refreshing…' : 'Refresh rate'}
          </button>
        </div>
      )}
    </section>
  );
}
