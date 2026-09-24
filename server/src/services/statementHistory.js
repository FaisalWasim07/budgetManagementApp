const { key, money } = require('./statementFindings');

// What can be said once there is more than one statement to say it about.
//
// statementFindings answers questions about a single document: what is in it,
// what looks odd in it, whether it adds up. Everything here needs two or more,
// and none of it could be asked before statements were kept.
//
// Same division of labour as the rest of the scanner, and for the same reason:
// the model read the lines and named the merchants, and every figure below is
// arithmetic over what it returned. Nothing here calls the API, so comparing
// twelve months costs nothing and cannot be wrong about an amount.
//
// The one thing to be careful about across statements is that a merchant is a
// fuzzy idea. `key` comes from statementFindings so that "NETFLIX.COM
// AMSTERDAM" and "Netflix.com" fold together here exactly as they already do
// inside a single report.

// A charge has to turn up in at least this many statements before it is called
// recurring. Two is enough — that is the whole point of keeping them, and it
// is the first thing a single statement could never tell you.
const SEEN_TO_RECUR = 2;

// Two amounts are the same price if they are within a hundredth of each other
// after rounding. Anything further apart is a price that moved, which is the
// interesting case.
const SAME_PRICE = 0.01;

const out = (rows) => rows.filter((row) => row.direction === 'out');
const total = (rows) => money(rows.reduce((sum, row) => sum + row.amount, 0));

// A change, said in the two ways a reader wants it. `pct` is null rather than
// infinite where there was nothing before: a category that went from nothing
// to sixty dirhams has not risen by any percentage, it has appeared, and
// saying "↑ ∞%" is worse than saying nothing.
function move(before, after) {
  const change = money(after - before);
  return {
    before: money(before),
    after: money(after),
    change,
    pct: before > 0 ? Math.round((change / before) * 1000) / 10 : null,
  };
}

// --- the shape of a run of statements -------------------------------------

// One entry per statement, oldest first, with the figures a trend is drawn
// from. Ordered by the period the bank printed rather than by when it was
// kept, so scanning March after April still puts March first.
function trend(statements) {
  return [...statements]
    .sort((a, b) => String(a.periodStart).localeCompare(String(b.periodStart)))
    .map((statement) => {
      const rows = statement.rows ?? [];
      const outgoing = out(rows);
      const incoming = rows.filter((row) => row.direction === 'in');
      const ofKind = (kind) => total(incoming.filter((row) => row.kind === kind));

      return {
        id: statement.id,
        accountId: statement.accountId ?? null,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        currency: statement.currency ?? null,
        lines: rows.length,
        spent: total(outgoing),
        credited: total(incoming),
        // Split the same way the single-statement overview splits it, because
        // on a card statement most of what comes back is not income at all —
        // paying the card off is a credit of the whole balance, and counting
        // that as money received would say you earned your own bill.
        credits: {
          payments: ofKind('payment'),
          refunds: ofKind('refund'),
          cashback: ofKind('cashback'),
          income: ofKind('income'),
        },
      };
    });
}

// --- one statement against another ----------------------------------------

// Merchants and categories are folded by different rules, and using one rule
// for both is a bug either way round.
//
// A merchant needs the loose fold: a bank writes "NETFLIX.COM AMSTERDAM" where
// the next statement writes "NETFLIX.COM*4471", and an exact match would call
// them two different companies.
//
// A category needs the strict one. It arrives from a closed list, canonicalised
// before it was stored, so the only thing left to absorb is case — and
// stripping punctuation as well would merge "Health & fitness" into "Health
// and fitness", which is guessing rather than tidying.
const merchantOf = { name: (row) => row.merchant, fold: (value) => key(value) };
const categoryOf = {
  name: (row) => row.category,
  fold: (value) =>
    String(value ?? '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim(),
};

// Groups the outgoing rows of one statement by some name, as a Map of folded
// key to total. The name kept is the first spelling seen, because that is what
// the reader will recognise.
function totalsBy(rows, by) {
  const groups = new Map();
  for (const row of out(rows)) {
    const id = by.fold(by.name(row)) || 'unknown';
    const held = groups.get(id);
    if (held) held.amount += row.amount;
    else groups.set(id, { name: by.name(row) || 'Unknown', amount: row.amount, count: 0 });
    groups.get(id).count += 1;
  }
  return groups;
}

// Every name in either statement, with what it was and what it became. Sorted
// by how much it moved rather than by how big it is: a category that sat still
// at two thousand is not news, and one that doubled from three hundred is.
function movers(before, after, by) {
  const was = totalsBy(before, by);
  const now = totalsBy(after, by);

  return [...new Set([...was.keys(), ...now.keys()])]
    .map((id) => {
      const b = was.get(id);
      const a = now.get(id);
      return {
        name: (a ?? b).name,
        ...move(b?.amount ?? 0, a?.amount ?? 0),
        countBefore: b?.count ?? 0,
        countAfter: a?.count ?? 0,
      };
    })
    .filter((row) => row.change !== 0)
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change));
}

// Two statements, side by side. `before` and `after` are the row arrays; the
// caller decides which is which, and it is always the periods that order them
// rather than anything in here.
// Merchants the two statements filed under different categories.
//
// This is the drift a fixed vocabulary cannot fix. The list of words is closed,
// so September cannot invent "Dining" — but it can still read the same coffee
// shop as Eating out where August read it as Groceries, and both answers are
// defensible. When it happens, two categories move by equal and opposite
// amounts and the comparison above reports both with a confident arrow, as
// though spending had shifted when nothing did.
//
// It cannot be schema'd away, so it is surfaced instead: the same merchant,
// what each statement called it, and how much rode on the difference. The
// reader can then see that a category swing was a relabelling — which is the
// scanner's standing bargain, that the model may be wrong about what something
// is as long as you can see it and say so.
function recategorised(before, after) {
  const filedIn = (rows) => {
    const seen = new Map();
    for (const row of out(rows)) {
      const id = key(row.merchant);
      if (!id) continue;
      if (!seen.has(id)) seen.set(id, { name: row.merchant, categories: new Map() });
      const held = seen.get(id).categories;
      held.set(row.category, (held.get(row.category) ?? 0) + row.amount);
    }
    // The category a merchant mostly sat in, and what that came to.
    return new Map(
      [...seen].map(([id, merchant]) => {
        const [category, amount] = [...merchant.categories].sort((a, b) => b[1] - a[1])[0];
        return [id, { name: merchant.name, category, amount: money(amount) }];
      }),
    );
  };

  const was = filedIn(before);
  const now = filedIn(after);

  return [...was.keys()]
    .filter((id) => now.has(id))
    .map((id) => ({ before: was.get(id), after: now.get(id) }))
    .filter((pair) => categoryOf.fold(pair.before.category) !== categoryOf.fold(pair.after.category))
    .map((pair) => ({
      merchant: pair.after.name,
      was: pair.before.category,
      now: pair.after.category,
      // What moved between the two categories because of it. The smaller of
      // the two, because that is the most the relabelling can account for —
      // anything above it is a real change in what was spent there.
      amount: money(Math.min(pair.before.amount, pair.after.amount)),
    }))
    .sort((a, b) => b.amount - a.amount);
}

function compare(before, after) {
  const merchants = movers(before, after, merchantOf);

  return {
    spent: move(
      out(before).reduce((sum, row) => sum + row.amount, 0),
      out(after).reduce((sum, row) => sum + row.amount, 0),
    ),
    lines: { before: before.length, after: after.length },
    categories: movers(before, after, categoryOf),
    // Read this before believing the category list above it.
    recategorised: recategorised(before, after),
    merchants: {
      // Split three ways because they are three different pieces of news.
      // A merchant that appeared is something new in your life; one that
      // stopped may be a subscription that lapsed, or one you cancelled and
      // want to confirm actually stopped; one that moved is the same
      // arrangement costing something different.
      appeared: merchants.filter((row) => row.before === 0),
      stopped: merchants.filter((row) => row.after === 0),
      moved: merchants.filter((row) => row.before > 0 && row.after > 0),
    },
  };
}

// --- charges that come back ------------------------------------------------

// What is charging you every statement, and whether the price has moved.
//
// This is the finding a single statement structurally cannot produce, and it
// is worth being clear about why. A monthly subscription appears exactly once
// in a one-month statement, so the single-statement version of this — see
// `repeats` in statementFindings — can only find a repeat that is already in
// the file, and says nothing at all on a normal month. Across kept statements
// the same subscription appears once per statement, which is precisely the
// rhythm it was always looking for.
//
// A price that moved is reported rather than smoothed. Going from 56 to 62 is
// the single most useful thing this can tell you about a subscription, and
// averaging the two would erase it.
function recurring(statements) {
  const ordered = [...statements].sort((a, b) =>
    String(a.periodStart).localeCompare(String(b.periodStart)),
  );

  const groups = new Map();
  for (const statement of ordered) {
    // Once per statement, not once per line: a merchant charged twice in one
    // month has been seen in one statement, and counting it twice would make
    // a fortnightly habit look like it spans more months than it does.
    const seen = new Map();
    for (const row of out(statement.rows ?? [])) {
      const id = key(row.merchant);
      if (!id) continue;
      const held = seen.get(id);
      if (held) held.amount += row.amount;
      else seen.set(id, { name: row.merchant, amount: row.amount });
    }

    for (const [id, charge] of seen) {
      if (!groups.has(id)) groups.set(id, { name: charge.name, charges: [] });
      groups.get(id).charges.push({
        statementId: statement.id,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
        amount: money(charge.amount),
      });
    }
  }

  return [...groups.values()]
    .filter((group) => group.charges.length >= SEEN_TO_RECUR)
    .map((group) => {
      const amounts = group.charges.map((charge) => charge.amount);
      const first = amounts[0];
      const last = amounts[amounts.length - 1];
      const steady = amounts.every((amount) => Math.abs(amount - first) <= SAME_PRICE);

      return {
        merchant: group.name,
        statements: group.charges.length,
        charges: group.charges,
        total: money(amounts.reduce((sum, amount) => sum + amount, 0)),
        // What it costs now, which is the figure worth acting on. The typical
        // one would be an average of a price that changed.
        latest: last,
        steady,
        // Only where it actually moved, so a caller can print "was 56" without
        // checking whether that is news.
        priceMove: steady ? null : move(first, last),
      };
    })
    .sort((a, b) => b.total - a.total);
}

module.exports = { trend, compare, recurring, recategorised, move, movers };
