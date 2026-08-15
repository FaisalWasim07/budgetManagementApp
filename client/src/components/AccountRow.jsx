import { Money } from '../utils/display';
import { iconForAccount } from '../utils/categoryIcon';

// An account is a line in a ledger, not a card in a grid: six accounts should
// read as six lines. The row used to expand in place, which pushed everything
// below it down the page and still only had room for a list. It opens the
// account's own screen instead.
export default function AccountRow({ account, primaryCurrency, onOpen }) {
  const card = account.type === 'credit';
  const foreign = account.currency !== primaryCurrency;
  const owed = card && account.balance < 0;
  const TypeIcon = iconForAccount(account.type);

  return (
    <button className="account-row" onClick={() => onOpen(account)}>
      <span className={card ? 'tile card' : 'tile'}>
        <TypeIcon />
      </span>
      <span className="name">
        <b>{account.name}</b>
        {/* Plain text, not badges. Three pills on every row turned a column of
            six accounts into a column of eighteen little boxes, and none of
            them was worth that much of the eye. */}
        <span className="meta">
          {[account.currency, account.type === 'savings' && 'savings', card && 'credit card']
            .filter(Boolean)
            .join(' · ')}
          {foreign && account.balancePrimary == null && (
            <span className="error-text">
              {' · '}no {account.currency}→{primaryCurrency} rate
            </span>
          )}
        </span>
      </span>
      <span className={owed ? 'bal owed' : 'bal'}>
        <Money
          amount={owed ? -account.balance : account.balance}
          currency={account.currency}
          compact
        />
        {owed && <span className="sub">owed</span>}
        {foreign && account.balancePrimary != null && (
          <span className="sub">
            ≈ <Money amount={account.balancePrimary} currency={primaryCurrency} compact />
          </span>
        )}
      </span>
    </button>
  );
}
