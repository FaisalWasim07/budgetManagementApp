import IncomeExpenseChart from '../components/charts/IncomeExpenseChart';
import NetWorthTrendChart from '../components/charts/NetWorthTrendChart';
import AccountBalancesChart from '../components/charts/AccountBalancesChart';
import CategoryChart from '../components/charts/CategoryChart';
import { formatMonth } from '../utils/month';

export default function Stats({ summary, trend, categories, month }) {
  const currency = summary.primaryCurrency;

  return (
    <div className="stack">
      <div>
        <h2>Stats</h2>
        <span className="muted" style={{ fontSize: '0.85rem' }}>
          Trends cover the last 12 months. The breakdown is for {formatMonth(month)}. Everything is
          shown in {currency}.
        </span>
      </div>

      <div className="charts">
        <IncomeExpenseChart trend={trend} currency={currency} />
        <NetWorthTrendChart trend={trend} currency={currency} />
        <AccountBalancesChart persons={summary.persons} currency={currency} />
        <CategoryChart categories={categories} currency={currency} />
      </div>
    </div>
  );
}
