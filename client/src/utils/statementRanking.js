// The findings, in one list, worst first.
//
// The report used to show four headed sections in a fixed order — cycles,
// duplicates, outliers, small-and-often — which is the order the code happens
// to compute them in and has nothing to do with which one matters. A statement
// where the only real problem is a doubled 1,700 dirham charge showed it third,
// under a heading, below two subscriptions of forty.
//
// So they are ranked here instead, by what is actually at stake in each, and
// the kind becomes a label on the row rather than a heading over it. Nothing is
// dropped: every finding the arithmetic produced is still in the list, in the
// order somebody would want to read them.
//
// This is ordering, not arithmetic. Every number below was worked out on the
// server from the rows; all this does is decide which of them goes first.

// What each kind of finding puts at stake, in money:
//
//   duplicate — what may have been charged more than once. One of the two is
//               presumably real, so the exposure is the extra, not the pair.
//   repeat    — what the whole cycle took over the statement. The question a
//               subscription asks is whether to keep paying it, and that is
//               the figure that answers it.
//   outlier   — how far above its category's typical line it sits. The line
//               itself is not surprising; the excess is.
//   frequent  — what the habit came to. Individually beneath noticing, which
//               is exactly why the total is the point.
const AT_STAKE = {
  duplicates: (f) => f.amount * (f.times - 1),
  repeats: (f) => f.total,
  outliers: (f) => f.amount - f.typical,
  frequent: (f) => f.total,
};

// How each row says what it is. Short, because it sits beside the finding
// rather than above it.
export const KIND_LABELS = {
  duplicates: 'Charged twice',
  outliers: 'Unusually large',
  repeats: 'On a cycle',
  frequent: 'Small, and often',
};

// Where two findings put the same money at stake, the more actionable goes
// first: a possible double charge is something to do something about today, a
// habit is something to know.
const KIND_ORDER = ['duplicates', 'outliers', 'repeats', 'frequent'];

export function rank(findings) {
  if (!findings) return [];

  return KIND_ORDER.flatMap((kind) =>
    (findings[kind] ?? []).map((finding, i) => ({
      ...finding,
      kind,
      label: KIND_LABELS[kind],
      // Keyed by what it is rather than by where it landed, so re-ranking the
      // list does not remount every row in it.
      id: `${kind}-${finding.merchant}-${finding.amount ?? finding.total}-${i}`,
      atStake: Math.max(0, Math.round((AT_STAKE[kind](finding) ?? 0) * 100) / 100),
    })),
  ).sort(
    (a, b) =>
      b.atStake - a.atStake ||
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      a.merchant.localeCompare(b.merchant),
  );
}
