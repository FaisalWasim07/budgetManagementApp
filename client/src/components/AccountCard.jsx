import { formatCurrency } from '../utils/currency';

const TYPE_LABELS = {
  primary: 'Primary',
  savings: 'Rent / Savings',
  expense: 'Monthly Expense',
  multi_currency: 'Multi-Currency',
};

export default function AccountCard({ account }) {
  const isForeign = account.currency !== 'AED';
  return (
    <div className="card stack" style={{ gap: 8 }}>
      <div>
        <span className="account-badge">{TYPE_LABELS[account.type] || account.type}</span>
        <h3>{account.name}</h3>
      </div>
      <div className="stat">
        <span className="value">{formatCurrency(account.balance, account.currency)}</span>
        <span className="label">Balance ({account.currency})</span>
      </div>
      {isForeign && (
        <div className="stat">
          <span className="value">{formatCurrency(account.balanceAED, 'AED')}</span>
          <span className="label">
            AED equivalent
            {account.rate?.rate != null ? ` · rate ${account.rate.rate.toFixed(4)}` : ' · rate unavailable'}
            {account.rate?.stale ? ' (cached)' : ''}
          </span>
        </div>
      )}
    </div>
  );
}
