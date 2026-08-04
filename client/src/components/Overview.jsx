import { formatCurrency } from '../utils/currency';

function Tile({ label, value, sub, tone, hero }) {
  return (
    <div className={`tile${hero ? ' hero' : ''}`}>
      <span className="label">{label}</span>
      <span className={`value${tone ? ` ${tone}` : ''}`}>{value}</span>
      {sub && <span className="sub">{sub}</span>}
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
      </div>

      {household.unconvertedCurrencies?.length > 0 && (
        <div className="warn-banner">
          No exchange rate available for {household.unconvertedCurrencies.join(', ')}, so{' '}
          {household.unconvertedCurrencies.length > 1 ? 'those accounts are' : 'that account is'} left
          out of the totals above. Check your connection, then hit Refresh in Settings.
        </div>
      )}

      <div className="tiles">
        {persons.map((p) => (
          <Tile
            key={p.id}
            label={p.name}
            value={fmt(p.netWorth)}
            sub={`+${fmt(p.income)} in · −${fmt(p.expenses + p.subscriptions)} out`}
          />
        ))}
      </div>
    </div>
  );
}
