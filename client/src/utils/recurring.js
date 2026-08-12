// The rules for reading a recurring item, mirroring what the server does when
// it works out a month's totals. They live here as well because the page has to
// answer "what does this cost a month" and "which months does it land in" for
// twelve months at once, and asking the server twelve times for something this
// arithmetic would be silly.
//
// If the server's rule ever changes, this changes with it — the test suite
// checks a month's total both ways round for exactly that reason.

const monthIndex = (month) => {
  const [year, mon] = String(month).split('-').map(Number);
  return year * 12 + (mon - 1);
};

const billingMonthOf = (item) =>
  item.billing_month || Number(String(item.start_month).split('-')[1]);

// Is this item charged in the given month? Monthly items are charged in every
// month they run; yearly ones only in their billing month.
export function dueIn(item, month) {
  if (item.is_active !== 1) return false;
  const at = monthIndex(month);
  if (at < monthIndex(item.start_month)) return false;
  if (item.end_month && at > monthIndex(item.end_month)) return false;
  if (item.cycle === 'yearly') return (at % 12) + 1 === billingMonthOf(item);
  return true;
}

// What a yearly item works out to per month. The comparable unit: an AED 1,200
// annual renewal and an AED 100 monthly subscription cost the same, and a list
// sorted by anything else would put them in the wrong order.
export const perMonth = (item) => (item.cycle === 'yearly' ? item.amount / 12 : item.amount);

// Recurring items sit in their account's currency. Converting each one before
// adding them is the only way to a single honest total; anything without a rate
// is reported separately rather than quietly dropped.
export function convert(amount, rate) {
  if (rate?.rate == null) return null;
  return amount * rate.rate;
}

export const hasEnded = (item, month) =>
  item.is_active !== 1 || Boolean(item.end_month && monthIndex(item.end_month) < monthIndex(month));

export const startsLater = (item, month) => monthIndex(item.start_month) > monthIndex(month);

// Running, in the sense of "still on the books this month" — which includes a
// yearly item in a month it does not happen to be billed in.
export const isRunning = (item, month) => !hasEnded(item, month) && !startsLater(item, month);
