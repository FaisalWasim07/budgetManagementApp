import KpiRow from '../components/charts/KpiRow';
import IncomeExpenseChart from '../components/charts/IncomeExpenseChart';
import NetWorthTrendChart from '../components/charts/NetWorthTrendChart';
import AccountBalancesChart from '../components/charts/AccountBalancesChart';
import CategoryChart from '../components/charts/CategoryChart';
import KeptChart from '../components/charts/KeptChart';
import PersonSpendChart from '../components/charts/PersonSpendChart';
import { formatMonth } from '../utils/month';

// Scanning a statement used to start here, and that was right while there was
// nowhere else for it to be: a statement is not a thing you record, so it had
// no business beside Add, and Stats was the nearest screen about understanding
// money rather than entering it. Statements is now that screen, and it is
// where the reading starts — beside the statements a reading can be kept
// alongside, rather than one tab away from them.
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
