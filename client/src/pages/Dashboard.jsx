import { useCallback, useEffect, useState } from 'react';
import { getSummary, getTrend } from '../api/summary';
import MonthSelector from '../components/MonthSelector';
import HouseholdSummary from '../components/HouseholdSummary';
import PersonSection from '../components/PersonSection';
import IncomeExpenseChart from '../components/charts/IncomeExpenseChart';
import NetWorthTrendChart from '../components/charts/NetWorthTrendChart';
import BalanceBreakdownChart from '../components/charts/BalanceBreakdownChart';
import CurrencyCompositionChart from '../components/charts/CurrencyCompositionChart';
import { currentMonth } from '../utils/month';

export default function Dashboard() {
  const [month, setMonth] = useState(currentMonth());
  const [summary, setSummary] = useState(null);
  const [trend, setTrend] = useState([]);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const [summaryData, trendData] = await Promise.all([getSummary(month), getTrend(12)]);
      setSummary(summaryData);
      setTrend(trendData);
      setError(null);
    } catch (err) {
      setError(err.message);
    }
  }, [month]);

  useEffect(() => {
    load();
  }, [load]);

  if (error) {
    return (
      <div className="stack">
        <h1>Household Monthly Budget</h1>
        <div className="card error-text">Failed to load: {error}</div>
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="stack">
        <h1>Household Monthly Budget</h1>
        <p className="muted">Loading…</p>
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>Household Monthly Budget</h1>
      <MonthSelector month={month} onChange={setMonth} />
      <HouseholdSummary summary={summary} onRefresh={load} />
      <div className="grid-2">
        {summary.persons.map((person) => (
          <PersonSection key={person.id} person={person} month={month} onRefresh={load} />
        ))}
      </div>
      <h2>Stats</h2>
      <div className="grid-2">
        <IncomeExpenseChart trend={trend} />
        <NetWorthTrendChart trend={trend} />
        <BalanceBreakdownChart persons={summary.persons} />
        <CurrencyCompositionChart composition={summary.household.currencyComposition} />
      </div>
    </div>
  );
}
