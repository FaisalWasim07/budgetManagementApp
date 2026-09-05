// The categories a statement was read into, grouped so they can be read.
//
// The server already groups them (statementFindings.byCategory) and that
// grouping is what the summary and the digest use. This one exists for the
// report screen, and does two things the server's cannot:
//
//   * It keeps the rows. The server strips them on the way out — "they repeat
//     what the caller already has" — which is true, and the caller is here, so
//     here is where they get put back together. A category that cannot show
//     its own lines is a count nobody can follow.
//
//   * It merges spellings. The server groups on the raw string, so `Groceries`
//     and `groceries` are two categories with two bars. The machinery to fix
//     that already exists a few lines away in the same file — `key()`, which
//     lowercases and collapses punctuation — but it is applied to merchants
//     only. A statement read in eighteen slices, none of which can see what the
//     one before it called things, produces exactly the sprawl that fold is
//     for.
//
// Nothing here is a second opinion on the money: the totals are the same sums
// over the same rows. It is the same arithmetic, grouped better and kept.

// Case and spacing folded away, so `Eating out`, `Eating Out` and `eating  out`
// are one category. Deliberately not punctuation-stripping the way the merchant
// key is: `Health & fitness` and `Health and fitness` are different enough
// words that merging them would be guessing rather than tidying.
export const categoryKey = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// What the reading could not place, whichever word it reached for. `Other` is
// the model's own — no such literal exists anywhere in the app — and
// `Uncategorised` is the code's fallback for an empty one. They mean the same
// thing and belong in the same row.
const UNPLACED = new Set(['other', 'uncategorised', 'uncategorized', 'misc', 'miscellaneous']);

export const isUnplaced = (name) => UNPLACED.has(categoryKey(name));

// The key a row is actually grouped under. Everything the reading could not
// place shares one, whichever word it reached for — and anything that follows a
// category out of the list has to narrow by the same rule the list grouped by,
// or a row labelled "6 lines" opens onto three.
export const groupKey = (name) => {
  const raw = categoryKey(name) || 'uncategorised';
  return isUnplaced(raw) ? 'uncategorised' : raw;
};

const round = (n) => Math.round(n * 100) / 100;

/**
 * Spend rows grouped by category, largest first.
 *
 * Money going out only: a share of what was spent is not a share of everything
 * that moved, and a card payment is not a category of spending.
 */
export function groupCategories(rows) {
  const out = (rows ?? []).filter((row) => row?.direction === 'out');
  const total = out.reduce((sum, row) => sum + (row.amount ?? 0), 0);

  const groups = new Map();
  for (const row of out) {
    // Everything the reading could not place shares one row, whichever word it
    // reached for. Two of them at twelve and eight per cent are one failure at
    // twenty, and splitting it is how a fifth of a month hides in plain sight.
    const key = groupKey(row.category);
    if (!groups.has(key)) groups.set(key, { key, rows: [], names: new Map() });
    const group = groups.get(key);
    group.rows.push(row);
    // Every spelling seen, and how often. The one the group is labelled with is
    // the one the statement used most — a single stray `groceries` should not
    // rename eleven lines of `Groceries`.
    const name = String(row.category || '').trim() || 'Uncategorised';
    group.names.set(name, (group.names.get(name) ?? 0) + 1);
  }

  return [...groups.values()]
    .map((group) => {
      const spent = group.rows.reduce((sum, row) => sum + row.amount, 0);
      const [name] = [...group.names.entries()].sort(
        (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
      )[0];
      return {
        category: name,
        key: group.key,
        total: round(spent),
        count: group.rows.length,
        average: round(spent / group.rows.length),
        // Worked out from the raw amounts rather than by adding up the server's
        // shares: those are each rounded to a decimal place, and eighteen of
        // them added together do not come to a hundred.
        share: total > 0 ? Math.round((spent / total) * 1000) / 10 : 0,
        unplaced: isUnplaced(name),
        // Largest first, because "what are these three lines" is a question
        // about the big ones.
        rows: [...group.rows].sort((a, b) => b.amount - a.amount),
      };
    })
    .sort((a, b) => b.total - a.total);
}

/**
 * The category the reading could not place, when it is big enough to say
 * something about — either the largest thing on the statement or a large enough
 * slice of it that calling it a kind of spending would be a lie.
 *
 * Returned rather than rendered, because what to do about it is the screen's
 * business and whether it is true is this file's.
 */
export const NOTEWORTHY_UNPLACED_SHARE = 15;

export function unplacedNote(groups) {
  const unplaced = (groups ?? []).find((group) => group.unplaced);
  if (!unplaced) return null;
  const leads = groups[0]?.key === unplaced.key;
  if (!leads && unplaced.share < NOTEWORTHY_UNPLACED_SHARE) return null;
  return { ...unplaced, leads };
}
