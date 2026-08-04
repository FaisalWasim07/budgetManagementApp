import { formatCurrency } from '../utils/currency';

function Tile({ label, value, sub, tone, hero, small }) {
  return (
    <div className={`tile${hero ? ' hero' : ''}${small ? ' sm' : ''}`}>
      <span className="label">{label}</span>
      <span className={`value${tone ? ` ${tone}` : ''}`}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  );
}

// Each person's own month, broken down the same way as the household row above
// so the two read consistently.
function PersonTiles({ person, primaryCurrency, fmt }) {
  const leftover = person.income - person.expenses - person.subscriptions;

  return (
    <div className="person-summary">
      <div className="person-summary-head">
        <span className="label">{person.name}</span>
        <span className="value">{fmt(person.netWorth)}</span>
        <span className="sub">net worth ({primaryCurrency})</span>
      </div>
      <div className="tiles tiles-sm">
        <Tile small label="Income" value={fmt(person.income)} tone={person.income > 0 ? 'pos' : undefined} />
        <Tile small label="Spent" value={fmt(person.expenses)} />
        <Tile small label="Subscriptions" value={fmt(person.subscriptions)} />
        <Tile small label="Left over" value={fmt(leftover)} tone={leftover < 0 ? 'neg' : 'pos'} />
      </div>
    </div>
  );
}

export default function Overview({ summary }) {
  const { household, primaryCurrency, persons } = summary;
  const fmt = (v) => formatCurrency(v, primaryCurrency, { compact: true });

  return (
    <div className="stack">
      <div className="tiles">
        <Tile
          hero
          label={`Net worth (${primaryCurrency})`}
          value={fmt(household.netWorth)}
          sub={`${fmt(household.savings)} of it in savings`}
        />
        <Tile label="Income this month" value={fmt(household.income)} tone={household.income > 0 ? 'pos' : undefined} />
        <Tile label="Spent this month" value={fmt(household.expenses)} />
        <Tile
          label="Subscriptions"
          value={fmt(household.subscriptions)}
          sub="charged automatically"
        />
        <Tile
          label="Left over"
          value={fmt(household.leftover)}
          tone={household.leftover < 0 ? 'neg' : 'pos'}
          sub="income − spending − subs"
        />
        {household.debt > 0 && (
          <Tile
            label="Owed on cards"
            value={fmt(household.debt)}
            tone="neg"
            sub="already subtracted from net worth"
          />
        )}
      </div>

      {household.unconvertedCurrencies?.length > 0 && (
        <div className="warn-banner">
          No exchange rate available for {household.unconvertedCurrencies.join(', ')}, so{' '}
          {household.unconvertedCurrencies.length > 1 ? 'those accounts are' : 'that account is'} left
          out of the totals above. Check your connection, then hit Refresh in Settings.
        </div>
      )}

      <div className="person-summaries">
        {persons.map((p) => (
          <PersonTiles key={p.id} person={p} primaryCurrency={primaryCurrency} fmt={fmt} />
        ))}
      </div>
    </div>
  );
}
