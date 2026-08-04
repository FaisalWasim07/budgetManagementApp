import { useState } from 'react';
import Overview from '../components/Overview';
import PersonSection from '../components/PersonSection';
import AccountFormModal from '../components/AccountFormModal';
import TransferModal from '../components/TransferModal';
import TransactionsTable from '../components/TransactionsTable';

export default function Dashboard({ summary, month, onChanged }) {
  const [accountModal, setAccountModal] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);

  const primaryCurrency = summary.primaryCurrency;
  const allAccounts = summary.persons.flatMap((p) =>
    p.accounts.map((a) => ({ ...a, personName: p.name }))
  );
  const accountsById = Object.fromEntries(allAccounts.map((a) => [a.id, a]));
  const personsById = Object.fromEntries(summary.persons.map((p) => [p.id, p]));

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

      <TransactionsTable
        month={month}
        accountsById={accountsById}
        personsById={personsById}
        onChanged={onChanged}
      />

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
