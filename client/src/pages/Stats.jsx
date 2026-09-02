import { lazy, Suspense, useState } from 'react';
import KpiRow from '../components/charts/KpiRow';
import IncomeExpenseChart from '../components/charts/IncomeExpenseChart';
import NetWorthTrendChart from '../components/charts/NetWorthTrendChart';
import AccountBalancesChart from '../components/charts/AccountBalancesChart';
import CategoryChart from '../components/charts/CategoryChart';
import KeptChart from '../components/charts/KeptChart';
import PersonSpendChart from '../components/charts/PersonSpendChart';
import ToolbarSlot from '../components/ToolbarSlot';
import { Search } from '../components/icons';
import { formatMonth } from '../utils/month';

// Loaded when someone actually scans something. It carries pdf.js, which is
// half a megabyte — a weight every visit would otherwise pay for a thing done
// once a month.
const StatementScanner = lazy(() => import('../components/StatementScanner'));

export default function Stats({ summary, trend, categories, month, phone }) {
  const currency = summary.primaryCurrency;
  const [scanning, setScanning] = useState(false);

  // Reading a statement belongs on the screen for understanding money rather
  // than beside the button for recording it: nothing here is written down, and
  // sitting it next to Add would suggest otherwise. It opens as a dialog for
  // the same reason — a destination implies you can come back and find it, and
  // this disappears when you close it.
  const scanButton = (
    <button onClick={() => setScanning(true)}>
      <Search size={14} /> Scan a statement
    </button>
  );

  return (
    <>
      {/* At a desk the action sits in the top bar; a phone's bar has no room,
          so there it stays on the page — the same arrangement Recurring uses. */}
      {phone ? (
        <div className="section-head">
          <span />
          {scanButton}
        </div>
      ) : (
        <ToolbarSlot>{scanButton}</ToolbarSlot>
      )}

      {scanning && (
        <Suspense fallback={null}>
          <StatementScanner
            onClose={() => setScanning(false)}
            accounts={summary.persons.flatMap((person) => person.accounts)}
          />
        </Suspense>
      )}

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
