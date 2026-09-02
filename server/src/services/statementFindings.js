// Everything the scanner says with a number in it is worked out here, in code,
// from the rows the model returned. The model is not asked to add up, compare
// or count — it is allowed to be wrong about what a line is, which you can see
// and correct, and never about how much, which you cannot.
//
// Nothing in this file touches the database or writes anything. It takes rows
// and a household's subscriptions, and returns what can be said about them.

// Two amounts are the same charge if they are within a fraction of a unit of
// each other. Statements round, and a subscription recorded as 55.99 will show
// up as 56.00 often enough to matter.
const SAME_AMOUNT = 0.02;

// A line is an outlier if it is this many times its own category's median. A
// median rather than a mean, so one large payment does not raise the bar past
// itself and hide.
const OUTLIER_MULTIPLE = 4;

// Below this a category cannot say anything about a typical line, so no line in
// it is called unusual.
const MIN_FOR_OUTLIERS = 4;

// Small and frequent is only worth pointing at when there is a habit rather
// than a handful.
const FREQUENT_TIMES = 5;

const money = (n) => Math.round(n * 100) / 100;
const sum = (rows) => money(rows.reduce((total, row) => total + row.amount, 0));
const sameAmount = (a, b) => Math.abs(a - b) <= SAME_AMOUNT;

// Merchants are compared loosely on purpose. A bank writes "NETFLIX.COM
// AMSTERDAM" where the subscription is called "Netflix", and an exact match
// would find nothing at all.
const key = (text) =>
  String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const looksLike = (a, b) => {
  const x = key(a);
  const y = key(b);
  if (!x || !y) return false;
  if (x === y) return true;
  // One containing the other covers both "Netflix" inside "netflix com
  // amsterdam" and a statement that abbreviates what the household spelled out.
  return x.includes(y) || y.includes(x);
};

const median = (numbers) => {
  const sorted = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

// --- the shape of the statement ------------------------------------------

// Money coming back is not one thing, and on a card statement it is mostly not
// income at all. Paying the card off appears as a credit of the whole balance —
// counting that as money received says you earned ten thousand dirhams by
// settling your own bill. Refunds and cashback are money back from a purchase.
// Only `income` is earnings.
function overview(rows) {
  const out = rows.filter((r) => r.direction === 'out');
  const inn = rows.filter((r) => r.direction === 'in');
  const ofKind = (kind) => sum(inn.filter((r) => r.kind === kind));
  const dates = rows.map((r) => r.date).filter(Boolean).sort();

  return {
    lines: rows.length,
    spent: sum(out),
    credited: sum(inn),
    credits: {
      payments: ofKind('payment'),
      refunds: ofKind('refund'),
      cashback: ofKind('cashback'),
      income: ofKind('income'),
    },
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
  };
}

// Categories, largest first. Share is of what left the account, not of
// everything that moved — money arriving is not part of how it was spent.
function byCategory(rows) {
  const out = rows.filter((r) => r.direction === 'out');
  const total = out.reduce((t, r) => t + r.amount, 0);
  const groups = new Map();

  for (const row of out) {
    const name = row.category || 'Uncategorised';
    if (!groups.has(name)) groups.set(name, []);
    groups.get(name).push(row);
  }

  return [...groups.entries()]
    .map(([category, items]) => ({
      category,
      total: sum(items),
      count: items.length,
      average: money(items.reduce((t, r) => t + r.amount, 0) / items.length),
      // Zero rather than NaN when nothing went out at all.
      share: total > 0 ? Math.round((items.reduce((t, r) => t + r.amount, 0) / total) * 1000) / 10 : 0,
      rows: items,
    }))
    .sort((a, b) => b.total - a.total);
}

// --- findings -------------------------------------------------------------

// The same amount to the same place on the same day. Usually a genuine repeat,
// occasionally a bank charging twice — either way it is worth a look, and it is
// exact rather than a guess.
function duplicates(rows) {
  const seen = new Map();
  for (const row of rows) {
    const id = `${row.date}|${key(row.merchant)}|${row.amount.toFixed(2)}`;
    if (!seen.has(id)) seen.set(id, []);
    seen.get(id).push(row);
  }

  return [...seen.values()]
    .filter((group) => group.length > 1)
    .map((group) => ({
      date: group[0].date,
      merchant: group[0].merchant,
      amount: group[0].amount,
      times: group.length,
      total: sum(group),
    }))
    .sort((a, b) => b.total - a.total);
}

// The shortest gap that can look like a subscription rather than a habit. A
// works canteen charging the same 20.00 on fifteen days of one month is not a
// recurring charge somebody forgot to budget for, and reporting it as one is
// worse than saying nothing — it buries the real finding under lunch.
const PERIODIC_DAYS = 20;

const daysBetween = (a, b) => Math.abs(new Date(a) - new Date(b)) / 86400000;

// Charges that come back at something like a monthly rhythm, and whether the
// household already budgets for them.
//
// Worth being straight about what this cannot do: a monthly subscription
// appears exactly once in a one-month statement, and nothing here can find a
// repeat that is not in the file. This earns its keep on a statement spanning
// more than one cycle. Over a single month it will usually say nothing, which
// is the honest answer rather than a guess dressed up as a finding.
function repeats(rows, subscriptions) {
  const groups = new Map();
  for (const row of rows.filter((r) => r.direction === 'out')) {
    const id = `${key(row.merchant)}|${row.amount.toFixed(2)}`;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }

  return [...groups.values()]
    .filter((group) => group.length > 1)
    // A same-day repeat is a duplicate, reported above.
    .filter((group) => new Set(group.map((r) => r.date)).size > 1)
    // And a charge that comes back every few days is a habit, not a
    // subscription. Every gap has to look like a billing cycle, not just the
    // longest one, or a daily charge with a gap over a holiday would qualify.
    .filter((group) => {
      const dates = [...new Set(group.map((r) => r.date))].sort();
      return dates.every((date, i) => i === 0 || daysBetween(date, dates[i - 1]) >= PERIODIC_DAYS);
    })
    .map((group) => {
      const known = subscriptions.find(
        (sub) => looksLike(sub.name, group[0].merchant) && sameAmount(sub.amount, group[0].amount)
      );
      return {
        merchant: group[0].merchant,
        amount: group[0].amount,
        times: group.length,
        total: sum(group),
        listed: Boolean(known),
        listedAs: known?.name ?? null,
      };
    })
    .sort((a, b) => b.total - a.total);
}

// Something the household budgets for every month that this statement has no
// charge for. Either it stopped and the budget has not caught up, or it went
// out of a different account.
function missingSubscriptions(rows, subscriptions) {
  const out = rows.filter((r) => r.direction === 'out');
  return subscriptions
    .filter((sub) => sub.direction === 'expense' && sub.cycle === 'monthly')
    .filter((sub) => !out.some((row) => looksLike(sub.name, row.merchant) && sameAmount(sub.amount, row.amount)))
    .map((sub) => ({ name: sub.name, amount: money(sub.amount) }));
}

// Lines far above what is normal for their own category. Compared within the
// category rather than across the statement, so a large rent payment is not
// reported as unusual for being larger than a coffee.
function outliers(groups) {
  const found = [];
  for (const group of groups) {
    if (group.count < MIN_FOR_OUTLIERS) continue;
    const typical = median(group.rows.map((r) => r.amount));
    if (!(typical > 0)) continue;
    for (const row of group.rows) {
      if (row.amount >= typical * OUTLIER_MULTIPLE) {
        found.push({
          date: row.date,
          merchant: row.merchant,
          category: group.category,
          amount: row.amount,
          typical: money(typical),
        });
      }
    }
  }
  return found.sort((a, b) => b.amount - a.amount);
}

// The spend that hides by being boring: small amounts, over and over, to the
// same place. Individually beneath noticing and collectively not.
function frequent(rows) {
  const groups = new Map();
  for (const row of rows.filter((r) => r.direction === 'out')) {
    const id = key(row.merchant);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(row);
  }

  return [...groups.values()]
    .filter((group) => group.length >= FREQUENT_TIMES)
    .map((group) => ({
      merchant: group[0].merchant,
      times: group.length,
      total: sum(group),
      average: money(group.reduce((t, r) => t + r.amount, 0) / group.length),
    }))
    .sort((a, b) => b.total - a.total);
}

// Does the reading add up? The bank prints what the account started and ended
// at, and those two figures plus the rows are enough to check the whole scan
// arithmetically:
//
//   opening + everything out - everything in === closing
//
// This is the only check here that can catch the model dropping a line,
// inventing one, or misreading a digit. Everything else describes what was
// read; this says whether to believe it. When it fails the app should say so
// rather than present the findings as fact — a wrong figure shown confidently
// in a budget is worse than a visible failure.
//
// Skipped, not failed, when the statement prints no balances: plenty of
// transaction lists do not, and having nothing to check against is not the
// same as failing the check.
function reconcile(rows, statement) {
  const opening = statement?.openingBalance;
  const closing = statement?.closingBalance;
  if (typeof opening !== 'number' || typeof closing !== 'number') {
    return { status: 'unchecked' };
  }

  const out = rows.filter((r) => r.direction === 'out').reduce((t, r) => t + r.amount, 0);
  const inn = rows.filter((r) => r.direction === 'in').reduce((t, r) => t + r.amount, 0);
  const expected = money(opening + out - inn);
  const delta = money(expected - closing);

  // A cent of rounding is not a misread statement.
  if (Math.abs(delta) <= 0.01) return { status: 'ok', closing: money(closing) };

  // A gap the size of one line is usually a row counted twice or missed at a
  // page break. Only the first of those can be pointed at: a line that was
  // counted twice is still in the rows, where a line that was missed is by
  // definition not there to name. So this hint is offered when it exists and
  // the delta is reported either way.
  const twice = rows.find((r) => sameAmount(r.amount, Math.abs(delta)));

  return {
    status: 'mismatch',
    expected,
    closing: money(closing),
    delta,
    countedTwice: twice ? { date: twice.date, merchant: twice.merchant, amount: twice.amount } : null,
  };
}

// Everything, in one pass, for a route that has rows and a household's
// subscriptions and wants what can be said about them.
function analyse(rows, subscriptions = [], statement = null) {
  const groups = byCategory(rows);
  return {
    overview: overview(rows),
    reconciliation: reconcile(rows, statement),
    // The rows within each group are useful on screen but repeat what the
    // caller already has, so they are dropped from the summary itself.
    categories: groups.map(({ rows: _rows, ...rest }) => rest),
    findings: {
      duplicates: duplicates(rows),
      repeats: repeats(rows, subscriptions),
      missingSubscriptions: missingSubscriptions(rows, subscriptions),
      outliers: outliers(groups),
      frequent: frequent(rows),
    },
  };
}

module.exports = {
  analyse,
  reconcile,
  overview,
  byCategory,
  duplicates,
  repeats,
  missingSubscriptions,
  outliers,
  frequent,
};
