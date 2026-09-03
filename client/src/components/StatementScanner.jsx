import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import { scanStatement, analyseStatement, getScanChoices } from '../api/statements';
import { chunkStatement, inBatches, linesFor, AT_ONCE } from '../utils/statementChunks';
import { DisplayContext, Money } from '../utils/display';
import { readPdf, PdfPasswordError, WRONG_PASSWORD } from '../utils/pdfText';
import { redact } from '../utils/statementRedact';

// Reading a statement, and nothing more than reading it. Nothing here is saved:
// no row, no file, no table. Close the dialog and the statement is gone, which
// is the whole arrangement — this looks at money without ever being able to
// change the record of it.
//
// The file is opened in this browser rather than posted anywhere, so a
// password-protected statement never has to hand over its password to be read.

// Only what was found. A section with nothing in it is not shown at all —
// a list of empty headings reads as the feature having failed.
function Findings({ findings, currency }) {
  if (!findings) return null;
  const { duplicates = [], repeats = [], outliers = [], frequent = [] } = findings;

  const sections = [
    // Everything here is about this statement and only this statement. It used
    // to compare against the household's subscriptions — which ones were
    // already budgeted for, and which budgeted ones had not been charged — and
    // that section listed things the statement had never mentioned, in a report
    // about the statement.
    repeats.length && {
      key: 'repeats',
      title: 'Charging on a regular cycle',
      items: repeats.map((r) => (
        <>
          <b>{r.merchant}</b> — <Money amount={r.amount} currency={currency} />, {r.times} times
        </>
      )),
    },
    duplicates.length && {
      key: 'dupes',
      title: 'The same charge twice on one day',
      // Flagged, not accused: a repeat on one day is often perfectly real.
      items: duplicates.map((d) => (
        <>
          <b>{d.merchant}</b> — <Money amount={d.amount} currency={currency} />, {d.times} times on{' '}
          {d.date}. Worth a look.
        </>
      )),
    },
    outliers.length && {
      key: 'outliers',
      title: 'Larger than usual for their category',
      items: outliers.map((o) => (
        <>
          <b>{o.merchant}</b> — <Money amount={o.amount} currency={currency} /> against a typical{' '}
          <Money amount={o.typical} currency={currency} /> in {o.category}
        </>
      )),
    },
    frequent.length && {
      key: 'frequent',
      title: 'Small, and often',
      items: frequent.map((f) => (
        <>
          <b>{f.merchant}</b> — {f.times} times, <Money amount={f.total} currency={currency} /> in
          total
        </>
      )),
    },
  ].filter(Boolean);

  if (sections.length === 0) return null;

  return (
    <div className="scan-findings">
      {sections.map((section) => (
        <div key={section.key}>
          <h3>{section.title}</h3>
          <ul>
            {section.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

// Whoever scans statements scans them the same way every month, so the choice
// is remembered. It is only ever a preference: the server checks it against its
// own list, so a stale name left here from a model that has since gone falls
// back rather than failing.
const REMEMBERED = 'budget.scan';

function remember(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private browsing. The choice still holds for this scan.
  }
}

function recall(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// A scan costs cents, so two decimal places would round most of them to zero
// and the honest answer to "what did that cost" would read as "nothing". Under
// a cent it says so in words rather than printing $0.00 — and "about" is
// dropped there, because "about less than a cent" is not a figure.
function costPhrase(dollars) {
  if (!dollars) return '';
  if (dollars < 0.01) return ' for less than a cent';
  return ` for about $${dollars.toFixed(dollars < 1 ? 3 : 2)}`;
}

// What was taken out, as a sentence. A count on its own — "7 things hidden" —
// invites the one question it does not answer.
function hiddenPhrase({ found, dropped }) {
  const bits = found.map((f) => f.what);
  if (dropped) bits.push(`${dropped} line${dropped === 1 ? '' : 's'} of letterhead`);
  if (!bits.length) return 'Nothing in this statement needed hiding.';
  const last = bits.pop();
  return `Hidden before sending: ${bits.length ? `${bits.join(', ')} and ${last}` : last}.`;
}

// Effort is a capability, not a preference — Haiku rejects the field outright.
// The picker follows what the chosen model actually takes.
const EFFORT_WORDS = {
  low: 'Low — read it and write it out',
  medium: 'Medium — think a little about the odd line',
  high: 'High — deliberate over every line',
};

export default function StatementScanner({ onClose, accounts = [] }) {
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [password, setPassword] = useState('');
  // Set when the file turned out to be locked. Holds the reason, so a first
  // ask and a refused attempt do not read the same.
  const [locked, setLocked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  // Which account this statement is from. It decides the currency the amounts
  // are read in, which is not something to guess at from the page.
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? null);
  const [report, setReport] = useState(null);
  const [reading, setReading] = useState(false);
  // The slices as they were cut, and whichever answers came back, held at their
  // own index. Kept so the parts that failed can be asked for again on their
  // own — re-reading the whole statement to recover one slice means paying for
  // all of it a second time.
  const [slices, setSlices] = useState(null);
  // On by default. Off is there because no rule that catches an account number
  // can be certain it has not caught something else, and the person holding the
  // statement can see which it did.
  const [sanitise, setSanitise] = useState(true);
  // What may be read with, and what was picked. The list comes from the server
  // so the prices have one home; until it arrives there is nothing to choose
  // between and the controls stay out of the way.
  const [choices, setChoices] = useState(null);
  const [model, setModel] = useState(() => recall(`${REMEMBERED}.model`) ?? '');
  const [effort, setEffort] = useState(() => recall(`${REMEMBERED}.effort`) ?? '');
  // How far through the slices it is. Shown rather than kept, because the wait
  // is long enough that a spinner alone reads as the app having died.
  const [progress, setProgress] = useState(null);
  const passwordRef = useRef(null);

  const account = accounts.find((a) => a.id === Number(accountId)) ?? accounts[0] ?? null;
  const currency = account?.currency ?? '';

  // Asked for once, when the dialog opens, rather than on every file: it is a
  // fixed list and the answer does not change between statements. A failure
  // here is not worth an error — the scan works perfectly well on the server's
  // own defaults, so the pickers simply do not appear.
  useEffect(() => {
    let live = true;
    getScanChoices()
      .then((got) => {
        if (!live) return;
        setChoices(got);
        setModel((current) =>
          got.models.some((m) => m.id === current) ? current : got.defaultModel
        );
        setEffort((current) => (got.efforts.includes(current) ? current : got.defaultEffort));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  // What will actually be sent. Everything downstream reads this rather than
  // the text as it came out of the file — the slicer, the preview and the
  // request — so there is no path by which the screen shows one thing and
  // another leaves.
  const outgoing = useMemo(() => {
    if (!result?.hasText) return null;
    return sanitise ? redact(result.text) : { text: result.text, found: [], dropped: 0, count: 0 };
  }, [result, sanitise]);

  const chosen = choices?.models.find((m) => m.id === model) ?? null;

  // Named in the report from what actually read it, which is not necessarily
  // what was picked — the server has the last word on the model.
  const modelLabel =
    choices?.models.find((m) => m.id === (report?.model ?? model))?.label ?? 'the model';

  // Written down as it is picked, not when the scan starts: the choice is worth
  // keeping even if the file turns out to be the wrong one and the dialog is
  // closed again.
  function pickModel(id) {
    setModel(id);
    remember(`${REMEMBERED}.model`, id);
  }

  function pickEffort(value) {
    setEffort(value);
    remember(`${REMEMBERED}.effort`, value);
  }

  // Figures are hidden everywhere else in the app because the ledger simply
  // sits there: open the app on a train and your balances are on screen
  // whether you meant them to be or not. A scan is the opposite — you have
  // just chosen a file and asked for it to be read, with the statement itself
  // in your hand. Masking what you asked to see in that moment is friction
  // with nothing behind it, and it reads as the feature having failed.
  //
  // So the dialog opts out for itself, and the rest of the app is untouched:
  // this is a smaller scope than the toggle, not an override of it. Closing
  // the dialog leaves the setting exactly as it was.
  const display = useContext(DisplayContext);
  const shown = { ...display, amountsHidden: false };

  function reset() {
    setFile(null);
    setBytes(null);
    setPassword('');
    setLocked(null);
    setError(null);
    setResult(null);
    setReport(null);
    setSlices(null);
  }

  async function read(chosen, raw, tryPassword) {
    setBusy(true);
    setError(null);
    try {
      if (isPdf(chosen)) {
        setResult(await readPdf(raw, tryPassword || undefined));
      } else {
        // CSV and anything else with a text body needs none of the above.
        const text = new TextDecoder().decode(raw).trim();
        setResult({
          text,
          pageCount: null,
          pages: [],
          hasText: text.length > 0,
          imageCount: 0,
        });
      }
      setLocked(null);
    } catch (err) {
      if (err instanceof PdfPasswordError) {
        setLocked(err.kind);
        setResult(null);
        // Focus the box rather than leaving it to be found: at this point the
        // only thing to do is type a password.
        setTimeout(() => passwordRef.current?.focus(), 0);
      } else {
        setError(err.message || 'That file could not be read.');
      }
    }
    setBusy(false);
  }

  async function pick(e) {
    const chosen = e.target.files?.[0];
    if (!chosen) return;
    reset();
    setFile(chosen);
    const raw = new Uint8Array(await chosen.arrayBuffer());
    setBytes(raw);
    await read(chosen, raw, '');
  }

  function unlock(e) {
    e.preventDefault();
    if (file && bytes) read(file, bytes, password);
  }

  // The one thing here that leaves the machine, and only when asked for. The
  // text goes; the file and the password never do.
  // Builds the report from whatever slices are in hand. Kept apart from asking
  // for them because it runs twice: once after the reading, and again after the
  // missing parts of it have been fetched.
  async function makeReport(chunks, held) {
    const parts = held.filter(Boolean);

    // Slices are held at their own index, so the rows are already in the order
    // they were printed in whatever order the requests finished.
    const rows = parts.flatMap((part) => part.rows ?? []);
    // Balances are printed once, at the top, so they arrive with whichever
    // slice happened to carry the header.
    const statement =
      parts.map((part) => part.statement).find((s) => s && s.closingBalance != null) ?? null;

    if (rows.length === 0) {
      setError('Nothing in this file read as a transaction.');
      return;
    }

    // What the reading cost, added up across the slices. Shown rather than kept
    // quiet: this is the one part of the app that spends money when a button is
    // pressed, and finding that out from a bill later is no way to learn it.
    const usage = parts.reduce(
      (total, part) => ({
        // Three separate buckets, not one carved out of another: `input` is
        // what was sent uncached, and the cached and written tokens are on top
        // of it. Added together they are the input; taken as a subset they
        // produced a line reading "25,459 tokens in, of which 29,206 were read
        // from cache", which is not possible.
        input: total.input + (part.usage?.input ?? 0),
        output: total.output + (part.usage?.output ?? 0),
        cached: total.cached + (part.usage?.cacheRead ?? 0),
        written: total.written + (part.usage?.cacheWrite ?? 0),
        // Priced by the server, per slice, and added up here. Tokens are what
        // happened; money is what was actually being asked about.
        cost: total.cost + (part.cost ?? 0),
      }),
      { input: 0, output: 0, cached: 0, written: 0, cost: 0 }
    );
    const analysis = await analyseStatement(rows, statement);
    setReport({
      rows,
      statement,
      ...analysis,
      usage,
      parts: parts.length,
      // Parts that never came back. Everything below is worked out from what
      // did, so this is the first thing the report has to say: totals over five
      // sixths of a statement are not that statement's totals.
      missing: chunks.length - parts.length,
      // What it was read with, taken from the reply rather than from the
      // picker: if the server fell back, the report should say what actually
      // read the statement.
      model: parts.find((part) => part.model)?.model ?? model,
    });
  }

  // Asks for a set of slices and puts each answer at its own index. `which` is
  // the indexes to read — everything on the first go, only what is missing on a
  // second. Returns the slices in hand afterwards.
  async function fetchSlices(chunks, held, which) {
    setProgress({ done: 0, total: which.length });
    const { results } = await inBatches(
      which.map((i) => chunks[i]),
      AT_ONCE,
      (chunk) => scanStatement(chunk, account?.id ?? null, model || null, effort || null),
      (done, total) => setProgress({ done, total }),
    );
    const next = [...held];
    which.forEach((chunkIndex, k) => {
      if (results[k]) next[chunkIndex] = results[k];
    });
    return next;
  }

  async function readTransactions() {
    setReading(true);
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      // Shorter slices where the model has been asked to think, because the
      // thinking happens before the first row is written and the host stops
      // waiting at sixty seconds regardless.
      const chunks = chunkStatement(outgoing.text, linesFor(effort));
      const held = await fetchSlices(chunks, [], chunks.map((_, i) => i));
      setSlices({ chunks, held });
      await makeReport(chunks, held);
    } catch (err) {
      setError(err.message);
    }
    setReading(false);
    setProgress(null);
  }

  // Asks again only for the parts that never arrived. The rest are already in
  // hand and already paid for; fetching them a second time would cost the same
  // again to learn nothing new.
  async function readMissing() {
    if (!slices) return;
    const which = slices.chunks.map((_, i) => i).filter((i) => !slices.held[i]);
    if (!which.length) return;

    setReading(true);
    setError(null);
    try {
      const held = await fetchSlices(slices.chunks, slices.held, which);
      setSlices({ chunks: slices.chunks, held });
      await makeReport(slices.chunks, held);
    } catch (err) {
      // The reading in hand is still the reading in hand. A failed second
      // attempt says so and leaves it on screen rather than clearing it.
      setError(`Those parts did not come back either: ${err.message}`);
    }
    setReading(false);
    setProgress(null);
  }

  return (
    <DisplayContext.Provider value={shown}>
      <Modal title="Scan a statement" onClose={onClose} className="scanner">
        <div className="stack-sm">
          <span className="muted" style={{ fontSize: '0.85rem' }}>
            Read here in your browser. The file is not uploaded and nothing is saved — close this
            and it is gone.
          </span>
        </div>

        <label className="field">
          Statement
          <input type="file" accept=".pdf,.csv,application/pdf,text/csv" onChange={pick} />
        </label>

        {locked && (
          <form className="stack-sm" onSubmit={unlock}>
            <label className="field">
              Password
              <input
                type="password"
                ref={passwordRef}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
                required
              />
              <span className="muted">
                {locked === WRONG_PASSWORD
                  ? 'That one did not open it. Banks often use a date of birth with part of a card number.'
                  : 'This statement is locked. The password stays in this browser — it is not sent anywhere.'}
              </span>
            </label>
            <button type="submit" className="primary" disabled={busy || !password}>
              {busy ? 'Opening…' : 'Open it'}
            </button>
          </form>
        )}

        {busy && !locked && <span className="muted">Reading…</span>}

        {error && <div className="error-text">{error}</div>}

        {result && (
          <div className="stack-sm">
            {/* A class, not the prose: the browser suites used to select this
              sort of thing by its wording, and rewording one broke six of
              them. */}
            <span className="muted scan-summary" style={{ fontSize: '0.85rem' }}>
              {file?.name}
              {result.pageCount
                ? ` · ${result.pageCount} page${result.pageCount === 1 ? '' : 's'}`
                : ''}
              {result.hasText ? ` · ${result.text.split('\n').length} lines of text` : ''}
              {result.imageCount
                ? ` · ${result.imageCount} scanned page${result.imageCount === 1 ? '' : 's'}`
                : ''}
            </span>

            {/* Said once, at the top, rather than beside every picture. A page
              that is a photograph is not a failure — it is simply read a
              different way, and there is nothing here for the person to fix. */}
            {result.imageCount > 0 && (
              <div className="warn-banner">
                {result.hasText
                  ? 'Some pages are scanned rather than typed, so there are no words to pull out of them. They are shown below as they are.'
                  : 'This statement is scanned — the pages are pictures rather than words. They are shown below as they are.'}
              </div>
            )}

            {result.hasText && (
              <>
                {accounts.length > 1 && !report && (
                  <label className="field">
                    Which account is this from?
                    <select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value)}>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.currency}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {choices && !report && (
                  <div className="scan-model">
                    <label className="field">
                      Read it with
                      <select
                        value={model}
                        onChange={(e) => pickModel(e.target.value)}
                        disabled={reading}
                      >
                        {choices.models.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.label}
                          </option>
                        ))}
                      </select>
                      {/* The note is the whole reason for offering a choice.
                        Naming three models without saying what the difference
                        buys you is a question nobody can answer. */}
                      <span className="muted">{chosen?.note}</span>
                    </label>

                    {/* Only where the model takes one. Haiku refuses the field
                      outright rather than ignoring it, so an effort picker
                      beside it would be a control that breaks the scan. */}
                    {chosen?.effort && (
                      <label className="field">
                        How hard to think
                        <select
                          value={effort}
                          onChange={(e) => pickEffort(e.target.value)}
                          disabled={reading}
                        >
                          {choices.efforts.map((e) => (
                            <option key={e} value={e}>
                              {EFFORT_WORDS[e] ?? e}
                            </option>
                          ))}
                        </select>
                        <span className="muted">
                          Reading a printed list is mostly transcription, and thinking is billed
                          like writing. Low is usually right.
                        </span>
                      </label>
                    )}
                  </div>
                )}

                {!report && (
                  <>
                    <button className="primary" onClick={readTransactions} disabled={reading}>
                      {!reading
                        ? 'Read the transactions'
                        : progress?.total
                          ? `Reading… part ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                          : 'Reading…'}
                    </button>
                    <span className="muted" style={{ fontSize: '0.8rem' }}>
                      The text below is sent to be read. The file and any password stay here.
                    </span>
                  </>
                )}
              </>
            )}

            {report && (
              <div className="stack-sm scan-report">
                {/* Some of the statement never came back. Said first, and in
                  the strongest terms the dialog has, because every figure below
                  is worked out from what did arrive: the total is not the
                  statement's total, and a category missing its largest charge
                  looks exactly like a category that never had one. */}
                {report.missing > 0 && (
                  <div className="warn-banner">
                    <b>
                      {report.missing} part{report.missing === 1 ? '' : 's'} of this statement could
                      not be read
                    </b>
                    , so what follows is {report.parts} part
                    {report.parts === 1 ? '' : 's'} of it and nothing below is a complete total.
                    {' '}
                    <button className="link" onClick={readMissing} disabled={reading}>
                      {reading
                        ? progress?.total
                          ? `Reading… ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                          : 'Reading…'
                        : `Read the missing part${report.missing === 1 ? '' : 's'}`}
                    </button>{' '}
                    — only those, so the rest is not paid for twice. A lower effort makes each part
                    quicker and less likely to be dropped.
                  </div>
                )}

                {/* Whether to believe any of the rest of it. The bank prints what
                  the account started and ended at, so the reading can be checked
                  against arithmetic rather than trusted — and when it does not
                  add up, that is said before anything else, not after.
                  Held back when parts are missing: rows we know were never read
                  cannot fail to add up, and saying "this does not add up" there
                  blames the reading for something already admitted above. */}
                {!report.missing && report.reconciliation?.status === 'mismatch' && (
                  <div className="warn-banner">
                    This does not add up. Following the rows from the opening balance lands on{' '}
                    <b>
                      <Money amount={report.reconciliation.expected} currency={currency} />
                    </b>
                    , where the statement closes at{' '}
                    <b>
                      <Money amount={report.reconciliation.closing} currency={currency} />
                    </b>{' '}
                    — a gap of{' '}
                    <b>
                      <Money amount={Math.abs(report.reconciliation.delta)} currency={currency} />
                    </b>
                    .
                    {report.reconciliation.countedTwice
                      ? ` That is the size of the ${report.reconciliation.countedTwice.merchant} line, which may have been counted twice.`
                      : ' A line was probably missed or misread.'}{' '}
                    Take the figures below as a reading, not as fact.
                  </div>
                )}

                {/* What the statement closes at — on a card, the bill. It was
                  being used and not shown: the reading was checked against it,
                  the screen said it added up, and the one figure a person opens
                  a statement to find was nowhere on the report. */}
                {report.reconciliation?.closing != null && (
                  <div className="scan-bill">
                    <span className="scan-bill-what">
                      {report.reconciliation.reads === 'card' ? 'Owed at the end of this statement' : 'Balance at the end of this statement'}
                    </span>
                    <b>
                      <Money amount={report.reconciliation.closing} currency={currency} />
                    </b>
                    {report.reconciliation.opening != null && (
                      <span className="muted">
                        opened at <Money amount={report.reconciliation.opening} currency={currency} />
                      </span>
                    )}
                  </div>
                )}

                <div className="scan-head">
                  <span>
                    <b>
                      <Money amount={report.overview.spent} currency={currency} />
                    </b>{' '}
                    spent
                    {report.overview.lines ? ` over ${report.overview.lines} lines` : ''}
                    {report.overview.from
                      ? `, ${report.overview.from} to ${report.overview.to}`
                      : ''}
                  </span>
                  {report.reconciliation?.status === 'ok' && (
                    <span className="reconciled">adds up to the closing balance</span>
                  )}
                </div>

                {/* Credits are not one thing. Paying a card off is a credit for the
                  whole balance and is not money anybody received. */}
                {report.overview.credits && (
                  <div className="scan-credits">
                    {[
                      ['paid off the card', report.overview.credits.payments],
                      ['came in', report.overview.credits.income],
                      ['refunded', report.overview.credits.refunds],
                      ['cashback', report.overview.credits.cashback],
                    ]
                      .filter(([, amount]) => amount > 0)
                      .map(([label, amount]) => (
                        <span key={label}>
                          <Money amount={amount} currency={currency} /> {label}
                        </span>
                      ))}
                  </div>
                )}

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

                <Findings findings={report.findings} currency={currency} />

                <details className="scan-rows-toggle">
                  <summary>Every line ({report.rows.length})</summary>
                  <div className="tablewrap">
                    <table className="scan-rows">
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>What</th>
                          <th>Category</th>
                          <th className="num">Amount</th>
                        </tr>
                      </thead>
                      <tbody>
                        {report.rows.map((row, i) => (
                          <tr key={i} className={row.confidence === 'low' ? 'unsure' : undefined}>
                            <td className="when">{row.date}</td>
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
                      </tbody>
                    </table>
                  </div>
                </details>

                <span className="muted scan-cost" style={{ fontSize: '0.8rem' }}>
                  Nothing has been saved. This is gone when you close it.
                  {report.usage?.output
                    ? ` Read by ${modelLabel} in ${report.parts} part${
                        report.parts === 1 ? '' : 's'
                      }` +
                      // Money first, because that is the question. Tokens are
                      // kept because they are what explains the money — a scan
                      // that costs twice as much as the last one did so for a
                      // reason that is visible here.
                      `${costPhrase(report.usage.cost)}: ` +
                      `${(
                        report.usage.input +
                        report.usage.cached +
                        report.usage.written
                      ).toLocaleString()} tokens in and ` +
                      `${report.usage.output.toLocaleString()} out` +
                      // Cached tokens are charged at about a tenth, so this is
                      // the difference between the bill and what it would have
                      // been. Nothing to show when nothing cached.
                      (report.usage.cached
                        ? `, of which ${report.usage.cached.toLocaleString()} were read back from cache rather than sent again.`
                        : '.')
                    : ''}
                </span>
              </div>
            )}

            {result.hasText && (
              <div className="scan-sanitise">
                <label>
                  <input
                    type="checkbox"
                    checked={sanitise}
                    onChange={(e) => setSanitise(e.target.checked)}
                    disabled={reading || !!report}
                  />
                  Hide account numbers and contact details
                </label>
                {/* Said against the preview it describes, because the preview
                  is the proof: this is not a promise about what was sent, it
                  is the thing that was sent. */}
                <span className="muted">
                  {sanitise
                    ? `${hiddenPhrase(outgoing)} What you see below is what leaves this browser — the file and any password do not.`
                    : 'The text below goes exactly as it is printed, account numbers and all.'}
                </span>
              </div>
            )}

            {result.hasText && <pre className="scan-preview">{outgoing.text}</pre>}

            {result.pages
              ?.filter((page) => page.image)
              .map((page) => (
                <figure className="scan-page" key={page.n}>
                  <img src={page.image} alt={`Page ${page.n} of the statement`} />
                  <figcaption>Page {page.n}</figcaption>
                </figure>
              ))}
          </div>
        )}
      </Modal>
    </DisplayContext.Provider>
  );
}
