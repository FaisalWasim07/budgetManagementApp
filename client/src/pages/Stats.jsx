import KpiRow from '../components/charts/KpiRow';
import IncomeExpenseChart from '../components/charts/IncomeExpenseChart';
import NetWorthTrendChart from '../components/charts/NetWorthTrendChart';
import AccountBalancesChart from '../components/charts/AccountBalancesChart';
import CategoryChart from '../components/charts/CategoryChart';
import KeptChart from '../components/charts/KeptChart';
import PersonSpendChart from '../components/charts/PersonSpendChart';
import { formatMonth } from '../utils/month';

export default function Stats({ summary, trend, categories, month }) {
  const currency = summary.primaryCurrency;

  return (
    <>
      {/* No "Stats" heading: the sidebar, the top bar and the tab bar all
          already say it, and printing it a fourth time above the first card
          was the page's own title repeated back at itself. */}
      <p className="page-note">
        Twelve months to {formatMonth(month)}, in {currency}
      </p>

      {/* The four figures first, then the charts that explain them. */}
      <KpiRow summary={summary} trend={trend} month={month} />

      <div className="charts">
        <IncomeExpenseChart trend={trend} currency={currency} />
        <NetWorthTrendChart trend={trend} currency={currency} />
        <CategoryChart categories={categories} currency={currency} month={month} />
        <KeptChart trend={trend} />
        <PersonSpendChart persons={summary.persons} currency={currency} month={month} />
        <AccountBalancesChart persons={summary.persons} currency={currency} />
      </div>
    </>
  );
}
