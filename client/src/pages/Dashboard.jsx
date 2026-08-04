import { useState } from 'react';
import Overview from '../components/Overview';
import PersonSection from '../components/PersonSection';
import AccountFormModal from '../components/AccountFormModal';
import TransferModal from '../components/TransferModal';
import IncomeExpenseChart from '../components/charts/IncomeExpenseChart';
import NetWorthTrendChart from '../components/charts/NetWorthTrendChart';
import AccountBalancesChart from '../components/charts/AccountBalancesChart';
import CategoryChart from '../components/charts/CategoryChart';

export default function Dashboard({ summary, trend, categories, month, onChanged }) {
  const [accountModal, setAccountModal] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);

  const primaryCurrency = summary.primaryCurrency;
  const allAccounts = summary.persons.flatMap((p) =>
    p.accounts.map((a) => ({ ...a, personName: p.name }))
  );

  return (
    <div className="stack">
      <Overview summary={summary} />

      <div className="spread">
        <h2>Accounts</h2>
        <button onClick={() => setShowTransfer(true)} disabled={allAccounts.length < 2}>
          Move money
        </button>
      </div>

      <div className="columns">
        {summary.persons.map((person) => (
          <PersonSection
            key={person.id}
            person={person}
            month={month}
            primaryCurrency={primaryCurrency}
            onChanged={onChanged}
            onAddAccount={(p) => setAccountModal({ personId: p.id, personName: p.name })}
            onEditAccount={(account) => setAccountModal({ account })}
          />
        ))}
      </div>

      <h2>Stats</h2>
      <div className="charts">
        <IncomeExpenseChart trend={trend} currency={primaryCurrency} />
        <NetWorthTrendChart trend={trend} currency={primaryCurrency} />
        <AccountBalancesChart persons={summary.persons} currency={primaryCurrency} />
        <CategoryChart categories={categories} currency={primaryCurrency} />
      </div>

      {accountModal && (
        <AccountFormModal
          account={accountModal.account}
          personId={accountModal.personId}
          personName={accountModal.personName}
          onClose={() => setAccountModal(null)}
          onSaved={onChanged}
        />
      )}

      {showTransfer && (
        <TransferModal
          accounts={allAccounts}
          month={month}
          onClose={() => setShowTransfer(false)}
          onSaved={onChanged}
        />
      )}
    </div>
  );
}
