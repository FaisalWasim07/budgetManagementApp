import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Money } from '../utils/display';
import { rank } from '../utils/statementRanking';
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
  source,
}) {
  const [active, setActive] = useState('bill');
  const [sort, setSort] = useState(null);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const paneRef = useRef(null);
  const marks = useRef({});

  const ranked = useMemo(() => rank(report.findings), [report.findings]);
  const rows = report.rows;
  const { overview, reconciliation = {} } = report;

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

  const counts = {
    went: report.categories?.length ?? 0,
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
  }, [rows, filter, query, sort]);

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
  const busiest = useMemo(
    () =>
      (report.categories ?? []).reduce((top, c) => (!top || c.count > top.count ? c : top), null),
    [report.categories],
  );
  const biggestCategory = biggest
    ? report.categories?.find((c) => c.category === biggest.category)
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
          Download CSV
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
                  counts[id]
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
          {report.missing > 0 && (
            <div className="warn-banner">
              <b>
                {report.missing} part{report.missing === 1 ? '' : 's'} of this statement could not
                be read
              </b>
              , so what follows covers {report.parts} part{report.parts === 1 ? '' : 's'} and
              nothing below is a complete total. The {report.parts} that did arrive{' '}
              {report.parts === 1 ? 'is' : 'are'} kept — and already paid for — so only the missing{' '}
              {report.missing} {report.missing === 1 ? 'is' : 'are'} fetched again.{' '}
              <button className="link" onClick={onReadMissing} disabled={reading}>
                {reading
                  ? progress?.total
                    ? `Reading… ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                    : 'Reading…'
                  : `Read the missing part${report.missing === 1 ? '' : 's'}`}
              </button>{' '}
              — a lower effort makes each part quicker and less likely to be dropped.
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
                  {report.missing > 0
                    ? 'Parts of this statement are missing, so there is nothing complete to check.'
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
            <div className="scan-tiles scan-head scan-credits">
              <div className="scan-tile">
                <small>Spent</small>
                <b>
                  <Money amount={overview.spent} currency={currency} />
                </b>
                <span>
                  {overview.lines ? `over ${overview.lines} lines` : 'over this statement'}
                </span>
              </div>
              {credits.map(([label, amount, note]) => (
                <div className="scan-tile" key={label}>
                  <small>{label}</small>
                  <b>
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
            {reconciliation.opening != null && (
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
                  {report.missing > 0
                    ? 'A reading that is missing lines cannot fail to add up, so the check is withheld rather than reported as a mismatch you did not cause.'
                    : reconciliation.status === 'ok'
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
              <Money amount={overview.spent} currency={currency} /> across{' '}
              {report.categories?.length ?? 0}{' '}
              {(report.categories?.length ?? 0) === 1 ? 'category' : 'categories'}
            </p>

            {report.categories?.length > 0 && (
              <div className="scan-cats">
                {report.categories.map((cat) => (
                  <div className="scan-cat" key={cat.category}>
                    <div className="row-tight" style={{ justifyContent: 'space-between' }}>
                      <b>{cat.category}</b>
                      <span>
                        <Money amount={cat.total} currency={currency} /> · {cat.share}%
                      </span>
                    </div>
                    <div className="scan-bar">
                      <i style={{ width: `${cat.share}%` }} />
                    </div>
                    <small>
                      {cat.count} line{cat.count === 1 ? '' : 's'}, averaging{' '}
                      <Money amount={cat.average} currency={currency} />
                    </small>
                  </div>
                ))}
              </div>
            )}

            {(biggest || busiest) && (
              <div className="scan-callouts">
                {biggest && (
                  <div className="scan-callout">
                    <small>Largest single line</small>
                    <b>
                      {biggest.merchant} — <Money amount={biggest.amount} currency={currency} />
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
                    <small>Most lines</small>
                    <b>
                      {busiest.category} — {busiest.count} line{busiest.count === 1 ? '' : 's'}
                    </b>
                    <span>
                      averaging <Money amount={busiest.average} currency={currency} /> a time
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
                        <b>{finding.merchant}</b>
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
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {source}
        </main>
      </div>
    </div>
  );
}
