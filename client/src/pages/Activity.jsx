import ActivityList from '../components/ActivityList';

// Activity used to be the last thing on Home, below every account, which made
// Home the longest screen in the app and buried the balances it exists to
// show. It is the same list; it just has a destination of its own now.
export default function Activity({ summary, month, onChanged, readOnly = false }) {
  const allAccounts = summary.persons.flatMap((p) =>
    p.accounts.map((a) => ({ ...a, personName: p.name }))
  );
  const accountsById = Object.fromEntries(allAccounts.map((a) => [a.id, a]));
  const personsById = Object.fromEntries(summary.persons.map((p) => [p.id, p]));

  return (
    <ActivityList
      month={month}
      accountsById={accountsById}
      personsById={personsById}
      onChanged={onChanged}
      readOnly={readOnly}
    />
  );
}
