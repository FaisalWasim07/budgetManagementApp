import { useCallback, useEffect, useState } from 'react';
import Hero from '../components/Hero';
import MonthFlow from '../components/MonthFlow';
import PersonSection from '../components/PersonSection';
import Latest from '../components/Latest';
import AccountFormModal from '../components/AccountFormModal';
import { listSubscriptions } from '../api/subscriptions';

export default function Dashboard({
  summary,
  trend,
  categories,
  month,
  onChanged,
  onOpenAccount,
  onSeeActivity,
  userId,
  readOnly = false,
}) {
  const [accountModal, setAccountModal] = useState(null);
  const [subscriptions, setSubscriptions] = useState([]);

  const primaryCurrency = summary.primaryCurrency;
  const allAccounts = summary.persons.flatMap((p) =>
    p.accounts.map((a) => ({ ...a, personName: p.name }))
  );

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
      {/* Net worth and the month read as one answer to "how are we doing",
          so they sit on one line rather than one under the other. */}
      <div className="home-top">
        <Hero summary={summary} trend={trend} month={month} />
        <MonthFlow
          summary={summary}
          month={month}
          subscriptionCount={subscriptions.filter((s) => s.direction !== 'income').length}
        />
      </div>

      {/* Both people beside each other, with the last few entries alongside
          rather than a screen below. */}
      <div className="home-cols">
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
            onOpenAccount={onOpenAccount}
            yours={person.userId != null && person.userId === userId}
          />
        ))}

        <Latest month={month} onSeeAll={onSeeActivity} />
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

    </>
  );
}
