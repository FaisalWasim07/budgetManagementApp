import { useCallback, useEffect, useState } from 'react';
import Hero from '../components/Hero';
import MonthFlow from '../components/MonthFlow';
import QuickAdd from '../components/QuickAdd';
import PersonSection from '../components/PersonSection';
import AccountFormModal from '../components/AccountFormModal';
import TransferModal from '../components/TransferModal';
import { listSubscriptions } from '../api/subscriptions';

export default function Dashboard({
  summary,
  trend,
  categories,
  month,
  onChanged,
  onAddEntry,
  readOnly = false,
}) {
  const [accountModal, setAccountModal] = useState(null);
  const [showTransfer, setShowTransfer] = useState(false);
  const [subscriptions, setSubscriptions] = useState([]);

  const primaryCurrency = summary.primaryCurrency;
  const allAccounts = summary.persons.flatMap((p) =>
    p.accounts.map((a) => ({ ...a, personName: p.name }))
  );
  const categoryNames = categories.map((c) => c.category);

  // Recurring items are shown inside the account they come out of, and counted
  // in the flow card. They are read once here rather than by every account row.
  const loadSubscriptions = useCallback(() => {
    listSubscriptions(month).then(
      (list) => setSubscriptions(list.filter((s) => s.is_active && s.dueThisMonth)),
      () => {}
    );
  }, [month]);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  const refresh = async () => {
    loadSubscriptions();
    await onChanged();
  };

  return (
    <>
      <Hero summary={summary} trend={trend} month={month} />

      {!readOnly && allAccounts.length > 0 && (
        <QuickAdd
          accounts={allAccounts}
          categories={categoryNames}
          month={month}
          onSaved={refresh}
          onMove={() => setShowTransfer(true)}
        />
      )}

      <MonthFlow
        summary={summary}
        month={month}
        subscriptionCount={subscriptions.filter((s) => s.direction !== 'income').length}
      />

      <div className="people">
        {summary.persons.map((person) => (
          <PersonSection
            key={person.id}
            person={person}
            month={month}
            primaryCurrency={primaryCurrency}
            subscriptions={subscriptions}
            onChanged={onChanged}
            readOnly={readOnly}
            onAddAccount={(p) => setAccountModal({ personId: p.id, personName: p.name })}
            onEditAccount={(account) => setAccountModal({ account })}
            onAddEntry={(account) => onAddEntry(account.id)}
          />
        ))}
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
    </>
  );
}
