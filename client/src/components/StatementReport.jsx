import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Money } from '../utils/display';
import { rank } from '../utils/statementRanking';
import { groupCategories, groupKey, unplacedNote } from '../utils/statementCategories';
import { describeCost } from '../utils/statementCost';
import { formatMonth } from '../utils/month';

// The report a scan produces, as a document rather than as a dialog.
//
// It answers four questions in order — what do I owe, where did it go, what
// stands out, and what were the lines — and the nav down the left is that list.
// The order is the point: the bill is what somebody opened the statement to
// find, and a hundred and fifteen rows are what they look at last, if at all.
//
// It scrolls inside itself, which the app's other dialogs deliberately do not.
// That rule exists so a dialog is never a scroll region inside the page's own
// scroll region — and it holds here, because this fills the window: the page
// behind it has nothing left to scroll, so this pane is the only scroller on
// screen rather than the inner one of two.

// How many of a category's lines the panel shows before handing over to the
// table. Thirty-two of them in place is a scroll with the way out at the far
// end of it, which is worse than the wall this replaced. Eight answers "what
// are these lines" for the sizes that question is asked at, and says plainly
// what it is not showing.
const MOST_LINES_SHOWN = 8;

const QUESTIONS = [
  ['bill', 'The bill', 'Question one', 'What do I owe?'],
  ['went', 'Where it went', 'Question two', 'Where did it go?'],
  ['stands', 'What stands out', 'Question three', 'What stands out?'],
  ['lines', 'The lines', 'Question four', 'The lines, as the bank printed them'],
];

// The filters over the rows. "Out" and "in" are the two directions; the three
// after them are kinds, because on a card the difference between a purchase, a
// payment and a refund is the difference between what you spent, what you
// settled and what came back — three questions that all look like "in" or "out"
// until they are named.
const FILTERS = [
  ['all', 'All', () => true],
  ['out', 'Out', (r) => r.direction === 'out'],
  ['in', 'In', (r) => r.direction === 'in'],
  ['purchase', 'Purchases', (r) => r.kind === 'purchase'],
  ['payment', 'Payments', (r) => r.kind === 'payment'],
  ['refund', 'Refunds', (r) => r.kind === 'refund' || r.kind === 'cashback'],
];

const SORTS = {
  date: (a, b) => String(a.date).localeCompare(String(b.date)),
  merchant: (a, b) => String(a.merchant).localeCompare(String(b.merchant)),
  category: (a, b) => String(a.category).localeCompare(String(b.category)),
  // Signed, so money coming in sorts below money going out rather than
  // interleaving with it by size alone.
  amount: (a, b) =>
    (a.direction === 'in' ? a.amount : -a.amount) - (b.direction === 'in' ? b.amount : -b.amount),
};

const COLUMNS = [
  ['date', 'Date'],
  ['merchant', 'Merchant'],
  ['category', 'Category'],
  ['amount', 'Amount'],
];

// The figure shown beside a finding is the plain money involved in it — the
// charge, the pair, the cycle, the habit's total — and not the number that
// decided its place in the list. Those two are different on purpose: an
// unusually large line is *ranked* by how far above normal it sits, because
// that is what makes it worth reading first, but the figure a person wants to
// see is the charge itself. Ranking is in ../utils/statementRanking.js; this is
// only what gets printed.
const STAKE = {
  duplicates: [(f) => f.total, (f) => `across ${f.times} charges`],
  repeats: [(f) => f.amount, () => 'each time'],
  outliers: [(f) => f.amount, () => 'this line'],
  frequent: [(f) => f.total, () => 'in total'],
};

// What each finding is, in the words somebody would use about it rather than
// the words the arithmetic used to find it.
function whyFor(finding, currency) {
  switch (finding.kind) {
    case 'duplicates':
      return (
        <>
          the same <Money amount={finding.amount} currency={currency} /> {finding.times} times on{' '}
          {finding.date} — often perfectly real, worth a look
        </>
      );
    case 'repeats':
      return <>charging on a monthly cycle, {finding.times} times</>;
    case 'outliers':
      return (
        <>
          far above anything else in {finding.category}, where the usual line is{' '}
          <Money amount={finding.typical} currency={currency} />
        </>
      );
    default:
      return (
        <>
          <Money amount={finding.average ?? finding.total / finding.times} currency={currency} /> on{' '}
          {finding.times} days — small enough that no single line looks like anything
        </>
      );
  }
}

// While parts of a statement are missing, a figure summed from its rows is a
// floor: the real one is that much or more. A figure the bank printed is not —
// the closing balance arrives in the header of every part and is complete the
// moment one of them lands. That single distinction decides every mark on this
// screen, and it is why the treatment is not a grey wash over everything: the
// one number somebody opened the statement to find is unaffected, and dimming
// it would be a lie in the other direction.
function Floor({ on }) {
  if (!on) return null;
  return <span className="scan-floor">at least </span>;
}

// A short date for the table. The year is on the period line above, and
// repeating it on a hundred and fifteen rows says nothing.
function shortDate(date) {
  const [, month, day] = String(date).split('-');
  if (!month || !day) return date;
  return `${day} ${formatMonth(`2000-${month}`).split(' ')[0].slice(0, 3)}`;
}

export default function StatementReport({
  report,
  currency,
  account,
  fileName,
  modelLabel,
  costPhrase,
  summary,
  summaryLabel,
  writing,
  summaryError,
  onWriteSummary,
  onDownloadCsv,
  onScanAnother,
  onClose,
  reading,
  progress,
  onReadMissing,
  // What it would cost to fetch only the parts that never arrived, priced over
  // those slices alone. The parts in hand are never re-sent and never re-billed,
  // so the figure on the button is the whole of what pressing it spends.
  missingCost,
  source,
}) {
  const [active, setActive] = useState('bill');
  const [sort, setSort] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  // A category the table has been narrowed to, set by following one from
  // question two rather than by anything in question four. Held apart from the
  // chips above so it reads as what it is: a door somebody came through.
  const [only, setOnly] = useState(null);
  const paneRef = useRef(null);
  const marks = useRef({});

  const ranked = useMemo(() => rank(report.findings), [report.findings]);
  const rows = report.rows;
  const { overview, reconciliation = {} } = report;

  // Parts of the statement never arrived, so everything below is short by
  // however much was printed on them. See <Floor> above for what that changes
  // and what it deliberately does not.
  const partial = report.missing > 0;

  // Grouped here rather than read off the server's own grouping, because the
  // screen needs two things that one does not have: the rows behind each
  // category, and spellings folded together. See ../utils/statementCategories.js.
  const categories = useMemo(() => groupCategories(rows), [rows]);
  const unplaced = useMemo(() => unplacedNote(categories), [categories]);

  // Which question is being read, so the nav says where you are. An observer
  // rather than a scroll handler: the pane is the scroller, and asking the
  // browser which section is crossing it is both cheaper and correct when a
  // section is shorter than the pane.
  useEffect(() => {
    const pane = paneRef.current;
    if (!pane || typeof IntersectionObserver === 'undefined') return undefined;
    const seen = new Map();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) seen.set(entry.target.id, entry.intersectionRatio);
        const best = [...seen.entries()].sort((a, b) => b[1] - a[1])[0];
        if (best && best[1] > 0) setActive(best[0]);
      },
      { root: pane, rootMargin: '-8% 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    for (const el of Object.values(marks.current)) if (el) observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const goTo = useCallback((id) => {
    marks.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // Every count on this page names something, and until now naming was all it
  // did. These are the two ways through: a category, which the table can be
  // narrowed to exactly, and a merchant, which it can be searched for.
  //
  // Each clears the other. Arriving at the table already narrowed two ways, by
  // two different clicks, is how a person ends up looking at nothing and not
  // knowing why.
  const showCategory = useCallback(
    (name) => {
      setOnly(name);
      setQuery('');
      setFilter('all');
      setSort(null);
      goTo('lines');
    },
    [goTo],
  );

  const showMerchant = useCallback(
    (merchant) => {
      setOnly(null);
      setQuery(merchant);
      setFilter('all');
      setSort(null);
      goTo('lines');
    },
    [goTo],
  );

  const counts = {
    went: categories.length,
    stands: ranked.length,
    lines: rows.length,
  };

  // The rows as the table is currently asking for them: filtered, searched,
  // then ordered. It opens in the order the bank printed, which carries
  // information no sort can put back.
  const shown = useMemo(() => {
    const match = FILTERS.find(([key]) => key === filter)?.[2] ?? (() => true);
    const needle = query.trim().toLowerCase();
    let list = rows.filter(match);
    // By the key the list grouped on, not by the word on the row: following
    // "Other" has to bring back everything that row is counting, including the
    // lines the code called Uncategorised.
    if (only) list = list.filter((row) => groupKey(row.category) === groupKey(only));
    if (needle) {
      list = list.filter((row) =>
        [row.merchant, row.raw, row.category, row.what].some((field) =>
          String(field ?? '')
            .toLowerCase()
            .includes(needle),
        ),
      );
    }
    if (!sort) return list;
    return [...list].sort((a, b) => SORTS[sort.by](a, b) * sort.dir);
  }, [rows, filter, query, sort, only]);

  const clickHeader = (by) =>
    setSort((held) => (held?.by === by ? { by, dir: held.dir * -1 } : { by, dir: 1 }));

  // The two things a list of categories does not tell you by itself: the one
  // line that moved the month, and the habit that turns up most often.
  const biggest = useMemo(
    () =>
      rows
        .filter((row) => row.direction === 'out')
        .reduce((top, row) => (!top || row.amount > top.amount ? row : top), null),
    [rows],
  );
  // Read off the same grouping the list above uses, or the callout names
  // `groceries` where the list two inches higher says `Groceries`. Whatever
  // could not be placed is left out of it: "most lines" is meant to name a
  // habit, and the reading giving up is not one — the note above says that.
  const busiest = useMemo(
    () =>
      categories
        .filter((c) => !c.unplaced)
        .reduce((top, c) => (!top || c.count > top.count ? c : top), null),
    [categories],
  );
  const biggestCategory = biggest
    ? categories.find((c) => c.key === groupKey(biggest.category))
    : null;

  // Credits are not one thing. Paying a card off is a credit for the whole
  // balance and is not money anybody received.
  const credits = [
    ['Paid off the card', overview.credits?.payments, 'not income'],
    ['Came in', overview.credits?.income, 'earnings'],
    ['Refunded', overview.credits?.refunds, 'money back'],
    ['Cashback', overview.credits?.cashback, 'money back'],
  ].filter(([, amount]) => amount > 0);

  const checked = reconciliation.status === 'ok' || reconciliation.status === 'mismatch';

  return (
    // `scan-report` rides along: it is what everything outside here has
    // always called the thing a scan produces, and that has not changed.
    <div className="scan-doc scan-report">
      {/* A document's header: which file this is, and the two things you can do
        with it. Not a dialog title with an ✕ parked beside it. */}
      <header className="scan-doc-head">
        <span className="scan-doc-file">
          <b>{fileName}</b>
          <small className="scan-summary">
            {[account?.name, currency].filter(Boolean).join(' · ')}
            {account?.name || currency ? ' · ' : ''}read just now
          </small>
        </span>
        <button className="secondary scan-doc-csv" onClick={onDownloadCsv}>
          <span className="scan-wide-only">Download </span>CSV
        </button>
        <button className="subtle" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </header>

      <div className="scan-doc-body">
        <nav className="scan-doc-nav" aria-label="This statement">
          <span className="scan-doc-eyebrow">This statement</span>
          {QUESTIONS.map(([id, label]) => (
            <button
              key={id}
              className={`scan-doc-link${active === id ? ' on' : ''}`}
              onClick={() => goTo(id)}
            >
              <span>{label}</span>
              <span className="scan-doc-count">
                {id === 'bill' ? (
                  reconciliation.closing != null ? (
                    <Money amount={reconciliation.closing} currency={currency} compact />
                  ) : null
                ) : (
                  <>
                    {counts[id]}
                    {/* Said in the space a count has: "at least 74" does not
                      fit a 40px margin, and a bare 74 beside a statement this
                      app has two thirds of is wrong. */}
                    {partial ? '+' : ''}
                  </>
                )}
              </span>
            </button>
          ))}

          <div className="scan-doc-nav-foot">
            {/* The one part of this app that spends money when a button is
              pressed. Money first, because that is the question; the tokens
              stay because they are what explains the money — a scan that costs
              twice what the last one did says why here. */}
            <span className="scan-cost">
              Nothing is saved. Closing this is the whole cleanup.
              {report.usage?.output
                ? ` Read by ${modelLabel} in ${report.parts} part${
                    report.parts === 1 ? '' : 's'
                  }${costPhrase(report.usage.cost)}: ${(
                    report.usage.input +
                    report.usage.cached +
                    report.usage.written
                  ).toLocaleString()} tokens in and ${report.usage.output.toLocaleString()} out` +
                  (report.usage.cached
                    ? `, of which ${report.usage.cached.toLocaleString()} were read back from cache rather than sent again.`
                    : '.')
                : ''}
            </span>
            <button className="link scan-again" onClick={onScanAnother}>
              Scan another statement
            </button>
          </div>
        </nav>

        <main className="scan-doc-pane" ref={paneRef}>
          {/* Said first and loudest: while any part is missing, every figure
            below is short of the truth. */}
          {partial && (
            <div className="warn-banner scan-short">
              <span>
                <b>
                  {report.missing} of {report.parts + report.missing} parts of this statement could
                  not be read
                </b>
                , so every total below is a floor rather than a figure — the real one is that much or
                more. The {report.parts} that arrived {report.parts === 1 ? 'is' : 'are'} kept and
                already paid for.
              </span>
              {/* The price rides on the button the way it does on the desk's own
                button, and it is the price of the missing slices alone. */}
              <span className="scan-short-do">
                <button className="primary" onClick={onReadMissing} disabled={reading}>
                  {reading
                    ? progress?.total
                      ? `Reading… ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                      : 'Reading…'
                    : `Read the missing ${report.missing}${
                        missingCost ? ` · ${describeCost(missingCost)}` : ''
                      }`}
                </button>
                <small>
                  only the {report.missing} {report.missing === 1 ? 'is' : 'are'} fetched again · a
                  lower effort makes each part quicker and less likely to be dropped
                </small>
              </span>
            </div>
          )}

          {/* Whether to believe any of the rest of it — said before anything
            else, because every figure below is worked out from a reading this
            says is wrong somewhere. The badge on the bill card says the same
            word, but a word beside a figure is not a warning.
            Held back when parts are missing: rows nobody read cannot fail to
            add up, and calling that a mismatch blames the reading for
            something already admitted above. */}
          {!report.missing && reconciliation.status === 'mismatch' && (
            <div className="warn-banner">
              This does not add up. Following the rows from the opening balance lands on{' '}
              <b>
                <Money amount={reconciliation.expected} currency={currency} />
              </b>
              , where the statement closes at{' '}
              <b>
                <Money amount={reconciliation.closing} currency={currency} />
              </b>{' '}
              — a gap of{' '}
              <b>
                <Money amount={Math.abs(reconciliation.delta)} currency={currency} />
              </b>
              .
              {reconciliation.countedTwice
                ? ` That is the size of the ${reconciliation.countedTwice.merchant} line, which may have been counted twice.`
                : ' A line was probably missed or misread.'}{' '}
              Take the figures below as a reading, not as fact.
            </div>
          )}

          {/* ── Question one ──────────────────────────────────────────── */}
          <section
            id="bill"
            className="scan-q"
            ref={(el) => {
              marks.current.bill = el;
            }}
          >
            <span className="scan-q-eyebrow">{QUESTIONS[0][2]}</span>
            <h3 className="scan-q-title">{QUESTIONS[0][3]}</h3>

            {/* No balance came back. The headline question then has no answer,
              and saying nothing at all leaves a report whose first section is
              simply missing — which reads as a bug rather than as a statement
              that did not print one. What the lines add up to is shown instead,
              and named as what it is: a movement worked out from the rows, not
              a figure the bank printed and not something to pay. */}
            {reconciliation.closing == null && (
              <div className="scan-bill scan-bill-none">
                <span className="scan-bill-what">This statement printed no balance to read</span>
                <b>
                  <Money
                    amount={Math.abs(overview.spent - overview.credited)}
                    currency={currency}
                  />
                </b>
                <span className="muted">
                  {overview.spent >= overview.credited ? 'more went out than came in' : 'more came in than went out'}
                </span>
                <span className="scan-verdict">Not checked</span>
                <span className="scan-bill-verdict reconciled">
                  That is what these lines move, not what you owe. Without the bank’s own opening
                  and closing figures there is nothing to check the reading against — and a total
                  worked out from the rows cannot check the rows it came from.
                </span>
              </div>
            )}

            {reconciliation.closing != null && (
              <div className="scan-bill">
                <span className="scan-bill-what">
                  {reconciliation.reads === 'card'
                    ? 'Owed at the end of this statement'
                    : 'Balance at the end of this statement'}
                </span>
                <b>
                  <Money amount={reconciliation.closing} currency={currency} />
                </b>
                <span className="muted">
                  {reconciliation.opening != null && (
                    <>
                      opened at <Money amount={reconciliation.opening} currency={currency} />
                    </>
                  )}
                  {overview.from ? ` · ${overview.from} to ${overview.to}` : ''}
                </span>
                {/* The verdict, in one word, beside the figure it is about.
                  Withheld rather than guessed at when part of the statement
                  never arrived: a reading that is missing lines cannot fail to
                  add up, and calling that a mismatch blames the reading for
                  something already admitted above. */}
                {report.missing > 0 || !checked ? (
                  <span className="scan-verdict">Not checked</span>
                ) : reconciliation.status === 'ok' ? (
                  <span className="scan-verdict ok">Reconciled</span>
                ) : (
                  <span className="scan-verdict bad">Does not add up</span>
                )}
                <span className="scan-bill-verdict reconciled">
                  {partial
                    ? 'The bank printed this one. It is not a total of the rows, so the missing parts do not change it — and it is why the reading below can be checked at all once they are in.'
                    : reconciliation.status === 'ok'
                      ? 'Every line adds up to the bank’s own closing balance.'
                      : reconciliation.status === 'mismatch'
                        ? 'The lines do not add up to the printed closing balance.'
                        : 'This statement prints no balances, so there is nothing to check against.'}
                </span>
              </div>
            )}

            {/* What moved, as figures rather than as a sentence. Money out and
              money in are the same shape here on purpose — a card statement's
              largest credit is usually you settling the bill, and reading it as
              a windfall is the mistake this row exists to prevent. */}
            <div className="scan-tiles">
              <div className={`scan-tile${partial ? ' short' : ''}`}>
                <small>Spent</small>
                <b>
                  <Floor on={partial} />
                  <Money amount={overview.spent} currency={currency} />
                </b>
                <span>
                  {overview.lines
                    ? `over ${overview.lines} lines${partial ? ' read so far' : ''}`
                    : 'over this statement'}
                </span>
              </div>
              {credits.map(([label, amount, note]) => (
                <div className={`scan-tile${partial ? ' short' : ''}`} key={label}>
                  <small>{label}</small>
                  <b>
                    <Floor on={partial} />
                    <Money amount={amount} currency={currency} />
                  </b>
                  <span>{note}</span>
                </div>
              ))}
            </div>

            {/* The claim the whole report rests on, shown rather than asserted.
              The model transcribed the lines; this sum, computed in code from
              those lines, is what says none was dropped, doubled or read
              backwards. */}
            {/* The check cannot run over part of a statement, and saying so is
              worth as much as running it: a reading missing lines cannot fail
              to add up, so a mismatch reported now blames the reading for
              something already admitted at the top of the page. */}
            {/* Only where the bank printed something to check against: a
              statement with no balances on it has nothing withheld, it simply
              has nothing to check, which the bill card above already says. */}
            {partial && reconciliation.closing != null && (
              <div className="scan-arith">
                <b>The check is withheld until the statement is whole</b>
                <span>
                  Every total here is computed in code and checked against the bank’s printed opening
                  and closing balances. Rows nobody read cannot fail to add up, so running that check
                  now would report a mismatch you did not cause. Read the missing {report.missing} and
                  it runs by itself.
                </span>
              </div>
            )}

            {!partial && reconciliation.opening != null && (
              <div className="scan-arith">
                <b>The arithmetic is the app’s, not the model’s</b>
                <span>
                  The model transcribed the lines. Every total here was then computed in code and
                  checked against the printed opening and closing balances:{' '}
                  <span className="scan-sum">
                    <Money amount={reconciliation.opening} currency={currency} />
                    {reconciliation.reads === 'card' ? ' + ' : ' − '}
                    <Money amount={overview.spent} currency={currency} />
                    {reconciliation.reads === 'card' ? ' − ' : ' + '}
                    <Money amount={overview.credited} currency={currency} />
                    {' = '}
                    <Money
                      amount={reconciliation.expected ?? reconciliation.closing}
                      currency={currency}
                    />
                  </span>
                  {'. '}
                  {reconciliation.status === 'ok'
                    ? 'It lands exactly, so no line was dropped, doubled or read backwards.'
                    : 'It does not land on the printed closing balance, so take everything here as a reading rather than as fact.'}
                </span>
              </div>
            )}
          </section>

          {/* ── Question two ──────────────────────────────────────────── */}
          <section
            id="went"
            className="scan-q"
            ref={(el) => {
              marks.current.went = el;
            }}
          >
            <span className="scan-q-eyebrow">{QUESTIONS[1][2]}</span>
            <h3 className="scan-q-title">{QUESTIONS[1][3]}</h3>
            <p className="scan-q-sub">
              <Floor on={partial} />
              <Money amount={overview.spent} currency={currency} /> across {categories.length}{' '}
              {categories.length === 1 ? 'category' : 'categories'}
              {partial && (
                <>
                  {' so far · '}
                  {/* Withheld rather than shown: a share has the missing rows in
                    its denominator, so unlike a total it is not a floor. It can
                    move either way, and there is no honest arrow to draw on it. */}
                  <span className="scan-withheld">
                    shares are withheld — a share of a statement this app has only part of is not a
                    share of anything
                  </span>
                </>
              )}
            </p>

            {/* What the reading could not place, said as that rather than left
              sitting at the top of the list looking like a kind of spending. A
              fifth of a month in "Other" is not a habit anybody has; it is the
              reading admitting it did not know. */}
            {unplaced && (
              <p className="scan-unplaced">
                <b>
                  {unplaced.leads ? 'The largest category is not a category.' : 'A large slice was not placed.'}
                </b>{' '}
                <Floor on={partial} />
                <Money amount={unplaced.total} currency={currency} />
                {partial ? ' of what has been read' : ` — ${unplaced.share}% of what went out —`} is
                in <b>{unplaced.category}</b>, which is the reading saying it could not tell what
                those {unplaced.count} line{unplaced.count === 1 ? '' : 's'} were. Open it to see
                them.
              </p>
            )}

            {categories.length > 0 && (
              <div className="scan-cats">
                {categories.map((cat) => (
                  // Closed, and one line while it is. Eighteen categories three
                  // lines tall is a wall; eighteen one-line rows is a list. The
                  // count in the summary is the promise the panel keeps — see
                  // `.scan-proof` and Latest.jsx, where an affordance always
                  // says how much is behind it.
                  <details className={`scan-cat${cat.unplaced ? ' unplaced' : ''}`} key={cat.key}>
                    <summary>
                      {/* One span so the summary keeps the browser's own
                        disclosure marker — laying the four parts out on the
                        summary itself takes it away. */}
                      <span className="scan-cat-head">
                        <b className="scan-cat-name">{cat.category}</b>
                        {/* The bar keeps its slot while its share is withheld,
                          drawn as a hatch, so the row does not reflow when the
                          missing parts land. */}
                        <span className={`scan-bar${partial ? ' withheld' : ''}`}>
                          {!partial && <i style={{ width: `${cat.share}%` }} />}
                        </span>
                        <span className="scan-cat-sum">
                          <Floor on={partial} />
                          <Money amount={cat.total} currency={currency} /> ·{' '}
                          {partial ? <span className="scan-withheld">—%</span> : `${cat.share}%`}
                        </span>
                        <small className="scan-cat-count">
                          {cat.count} line{cat.count === 1 ? '' : 's'}
                          {partial ? ' so far' : ''}
                        </small>
                      </span>
                    </summary>

                    <div className="scan-cat-lines">
                      {cat.rows.slice(0, MOST_LINES_SHOWN).map((row, i) => (
                        <div className="scan-cat-line" key={`${row.date}-${row.raw}-${i}`}>
                          <span className="when">{shortDate(row.date)}</span>
                          <span className="scan-cat-line-what">
                            <b>{row.merchant}</b>
                            <small>{row.what}</small>
                          </span>
                          <span className="num">
                            <Money amount={row.amount} currency={currency} />
                          </span>
                        </div>
                      ))}
                      <div className="scan-cat-foot">
                        <small>
                          {cat.count > MOST_LINES_SHOWN
                            ? `the ${MOST_LINES_SHOWN} largest of ${cat.count}`
                            : `${cat.count} line${cat.count === 1 ? '' : 's'}`}
                          {partial ? (
                            ' read so far'
                          ) : (
                            <>
                              {', averaging '}
                              <Money amount={cat.average} currency={currency} /> a line
                            </>
                          )}
                        </small>
                        <button className="link" onClick={() => showCategory(cat.category)}>
                          {cat.count > MOST_LINES_SHOWN
                            ? `See all ${cat.count} in the table`
                            : 'See these in the table'}
                        </button>
                      </div>
                    </div>
                  </details>
                ))}
              </div>
            )}

            {(biggest || busiest) && (
              <div className="scan-callouts">
                {biggest && (
                  <div className="scan-callout">
                    <small>Largest single line{partial ? ' so far' : ''}</small>
                    <b>
                      <button className="scan-jump" onClick={() => showMerchant(biggest.merchant)}>
                        {biggest.merchant}
                      </button>{' '}
                      — <Money amount={biggest.amount} currency={currency} />
                    </b>
                    <span>
                      {biggestCategory && biggestCategory.count === 1
                        ? `the whole of ${biggest.category}, in one line on ${biggest.date}`
                        : `${biggest.category}, on ${biggest.date}`}
                    </span>
                  </div>
                )}
                {busiest && (
                  <div className="scan-callout">
                    <small>Most lines{partial ? ' so far' : ''}</small>
                    <b>
                      <button className="scan-jump" onClick={() => showCategory(busiest.category)}>
                        {busiest.category}
                      </button>{' '}
                      — {busiest.count} line{busiest.count === 1 ? '' : 's'}
                    </b>
                    <span>
                      {partial ? (
                        'in the parts that arrived'
                      ) : (
                        <>
                          averaging <Money amount={busiest.average} currency={currency} /> a time
                        </>
                      )}
                    </span>
                  </div>
                )}
              </div>
            )}
          </section>

          {/* ── Question three ────────────────────────────────────────── */}
          <section
            id="stands"
            className="scan-q"
            ref={(el) => {
              marks.current.stands = el;
            }}
          >
            <span className="scan-q-eyebrow">{QUESTIONS[2][2]}</span>
            <h3 className="scan-q-title">{QUESTIONS[2][3]}</h3>

            <section className="scan-why">
              <h4>
                In a sentence <small>written from the figures above</small>
              </h4>
              {summary ? (
                <>
                  <p>{summary.summary}</p>
                  <span className="muted">
                    Written by {summaryLabel}
                    {costPhrase(summary.cost)}. Still nothing saved.
                  </span>
                </>
              ) : partial ? (
                // Not offered while parts are missing: a paragraph about a
                // month is a claim about all of it, and selling one written
                // over two thirds of a statement is the wrong sale.
                <span className="muted">
                  Not while parts are missing. A paragraph about a month is a claim about the whole
                  of it, and this reading is {report.missing} part
                  {report.missing === 1 ? '' : 's'} short. Read them and the offer comes back.
                </span>
              ) : (
                <>
                  <button className="secondary" onClick={onWriteSummary} disabled={writing}>
                    {writing ? 'Writing…' : 'Write it out'}
                  </button>
                  <span className="muted">
                    A short paragraph over the figures above — what the month looks like and what
                    the findings mean. A cent or two, and only when you ask.
                  </span>
                </>
              )}
              {summaryError && <div className="error-text">{summaryError}</div>}
            </section>

            {ranked.length > 0 ? (
              <div className="scan-findings">
                <h4>
                  Worth a second look{' '}
                  <small>ordered by what is at stake, not by how it was found</small>
                </h4>
                <ol>
                  {ranked.map((finding) => (
                    <li key={finding.id} className={`scan-finding ${finding.kind}`}>
                      <span className="scan-finding-kind">{finding.label}</span>
                      <span className="scan-finding-what">
                        {/* The merchant is the question this row raises, so it
                          is also the way to the lines it was raised from. */}
                        <button
                          className="scan-jump"
                          onClick={() => showMerchant(finding.merchant)}
                          title={`Find ${finding.merchant} in the table`}
                        >
                          {finding.merchant}
                        </button>
                        <small>{whyFor(finding, currency)}</small>
                      </span>
                      <span className="scan-finding-stake">
                        <b>
                          <Money
                            amount={STAKE[finding.kind][0](finding)}
                            currency={currency}
                          />
                        </b>
                        <small>{STAKE[finding.kind][1](finding)}</small>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            ) : partial ? (
              // "Nothing stands out" is the one finding that cannot be made
              // from part of a statement: the line that would have stood out
              // may be on a part that never arrived.
              <p className="scan-ordinary">
                Nothing in the {report.parts} part{report.parts === 1 ? '' : 's'} that arrived sits
                outside its own normal range. Whether that is true of the statement is not something
                this can say while {report.missing} part{report.missing === 1 ? ' is' : 's are'}{' '}
                missing.
              </p>
            ) : (
              // A month with nothing unusual in it says so, in as many words.
              // Anything that always finds something is a horoscope.
              <p className="scan-ordinary">
                Nothing on this statement sits outside its own normal range. That is a finding, not
                a failure to find one.
              </p>
            )}
          </section>

          {/* ── Question four ─────────────────────────────────────────── */}
          <section
            id="lines"
            className="scan-q"
            ref={(el) => {
              marks.current.lines = el;
            }}
          >
            <span className="scan-q-eyebrow">{QUESTIONS[3][2]}</span>
            <h3 className="scan-q-title">{QUESTIONS[3][3]}</h3>

            <div className="scan-rows-head">
              <input
                className="scan-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Search ${rows.length} lines`}
                aria-label={`Search ${rows.length} lines`}
              />
              <div className="scan-chips">
                {FILTERS.map(([key, label]) => (
                  <button
                    key={key}
                    className={`scan-chip${filter === key ? ' on' : ''}`}
                    onClick={() => setFilter(key)}
                  >
                    {label}
                  </button>
                ))}
                {/* Somebody arrived here from a category above. The table is
                  narrower than it looks, and the only honest way to show that
                  is to say which category and offer the way out in the same
                  breath. */}
                {only && (
                  <button
                    className="scan-chip on scan-chip-only"
                    onClick={() => setOnly(null)}
                    title="Show every category again"
                  >
                    Category: {only} <span aria-hidden="true">×</span>
                  </button>
                )}
              </div>
              <span className="muted scan-showing">
                {shown.length === rows.length
                  ? `showing all ${rows.length}`
                  : `showing ${shown.length} of ${rows.length}`}
              </span>
              {sort && (
                <button className="link" onClick={() => setSort(null)}>
                  Back to the order it was printed in
                </button>
              )}
            </div>

            <div className="tablewrap">
              <table className="scan-rows">
                <thead>
                  <tr>
                    {COLUMNS.map(([by, label]) => (
                      <th
                        key={by}
                        className={`${by === 'amount' ? 'num ' : ''}${
                          sort?.by === by ? 'sorted' : ''
                        }`}
                        aria-sort={
                          sort?.by === by ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'
                        }
                      >
                        <button className="scan-sort" onClick={() => clickHeader(by)}>
                          {label}
                          <span aria-hidden="true">
                            {sort?.by === by ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
                          </span>
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row, i) => (
                    <tr key={i} className={row.confidence === 'low' ? 'unsure' : undefined}>
                      <td className="when">
                        {shortDate(row.date)}
                        {/* The posting date, when the statement printed two
                          columns and they differ — a bank fact rather than a
                          spending fact, so it sits quieter. */}
                        {row.postDate && <small className="post-date">posts {row.postDate}</small>}
                      </td>
                      <td>
                        <b>{row.merchant}</b>
                        <small>{row.what}</small>
                        {/* The line as the bank printed it, so the tidier
                          version above can be checked rather than trusted. */}
                        <small className="raw">{row.raw}</small>
                      </td>
                      <td>{row.category}</td>
                      <td className={`num ${row.direction === 'in' ? 'in' : ''}`}>
                        {row.direction === 'in' ? '+' : ''}
                        <Money amount={row.amount} currency={currency} />
                      </td>
                    </tr>
                  ))}
                  {shown.length === 0 && (
                    <tr>
                      <td className="muted" colSpan={4}>
                        No line here matches that.
                        {(only || query || filter !== 'all') && (
                          <button
                            className="link"
                            onClick={() => {
                              setOnly(null);
                              setQuery('');
                              setFilter('all');
                            }}
                          >
                            Show every line again
                          </button>
                        )}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* The list is short by the same parts every figure above is short
              by, and the table is where somebody goes to check a figure they
              did not believe. Said at the end of it, where the rows run out. */}
            {partial && (
              <div className="scan-short-tail">
                <b>
                  {report.missing} part{report.missing === 1 ? '' : 's'} of this statement
                  {report.missing === 1 ? ' is' : ' are'} not in this list
                </b>
                <span>
                  Whatever was printed on {report.missing === 1 ? 'it' : 'them'} is missing from
                  every figure above, and from the CSV.
                </span>
                <button className="link" onClick={onReadMissing} disabled={reading}>
                  {reading
                    ? 'Reading…'
                    : `Read the missing ${report.missing}${
                        missingCost ? ` · ${describeCost(missingCost)}` : ''
                      }`}
                </button>
              </div>
            )}
          </section>

          {source}
        </main>
      </div>
    </div>
  );
}
