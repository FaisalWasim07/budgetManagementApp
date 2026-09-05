import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import Modal from './Modal';
import {
  scanStatement,
  analyseStatement,
  getScanChoices,
  summariseStatement,
} from '../api/statements';
import { chunkStatement, inBatches, linesFor, AT_ONCE } from '../utils/statementChunks';
import { DisplayContext, Money } from '../utils/display';
import { readPdf, PdfPasswordError, WRONG_PASSWORD } from '../utils/pdfText';
import { redact } from '../utils/statementRedact';
import { toCsv, csvName } from '../utils/statementCsv';
import { estimateScan, describeCost, spentSoFar } from '../utils/statementCost';
import StatementReport from './StatementReport';

// Reading a statement, and nothing more than reading it. Nothing here is saved:
// no row, no file, no table. Close the dialog and the statement is gone, which
// is the whole arrangement — this looks at money without ever being able to
// change the record of it.
//
// The file is opened in this browser rather than posted anywhere, so a
// password-protected statement never has to hand over its password to be read.

// Everything the arithmetic found, in one list, worst first — see
// ../utils/statementRanking.js for what "worst" is measured in. The kind is a
// label on the row rather than a heading over it, because the order that
// matters is by consequence and not by category: a doubled seventeen-hundred
// dirham charge belongs above two subscriptions of forty, whatever they are
// each called.
//
// Each row says the same three things: what sort of finding it is, what the
// statement actually shows, and the money at stake in it — the last named,
// because "1,702.96" beside an unusually large charge could be the charge, the
// typical, or the difference, and only one of those is why it is first.
function sentenceFor(finding, currency) {
  switch (finding.kind) {
    case 'duplicates':
      return (
        <>
          <b>{finding.merchant}</b> — <Money amount={finding.amount} currency={currency} />,{' '}
          {finding.times} times on {finding.date}. Worth a look.
        </>
      );
    case 'repeats':
      return (
        <>
          <b>{finding.merchant}</b> — <Money amount={finding.amount} currency={currency} />,{' '}
          {finding.times} times
        </>
      );
    case 'outliers':
      return (
        <>
          <b>{finding.merchant}</b> — <Money amount={finding.amount} currency={currency} /> against a
          typical <Money amount={finding.typical} currency={currency} /> in {finding.category}
        </>
      );
    default:
      return (
        <>
          <b>{finding.merchant}</b> — {finding.times} times
        </>
      );
  }
}

const STAKE_WORDS = {
  duplicates: 'possibly charged twice',
  repeats: 'over this statement',
  outliers: 'above what is typical',
  frequent: 'in total',
};

function Findings({ findings, currency }) {
  const ranked = useMemo(() => rank(findings), [findings]);
  if (!ranked.length) return null;

  return (
    <section className="scan-findings">
      <h3>What stands out</h3>
      <ol>
        {ranked.map((finding) => (
          <li key={finding.id} className={`scan-finding ${finding.kind}`}>
            <span className="scan-finding-kind">{finding.label}</span>
            <span className="scan-finding-what">{sentenceFor(finding, currency)}</span>
            <span className="scan-finding-stake">
              <b>
                <Money amount={finding.atStake} currency={currency} />
              </b>
              <small>{STAKE_WORDS[finding.kind]}</small>
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

// The rows, sortable.
//
// "As printed" is the order the statement is in and the order it opens in:
// a bank prints a month in the order it happened, and losing that by default
// would be losing information the document carries. Every other order is one
// click away and one click back — sorting is for answering a question ("what
// was the largest thing this month"), not for living in.
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
  ['merchant', 'What'],
  ['category', 'Category'],
  ['amount', 'Amount'],
];

function RowsTable({ rows, currency }) {
  const [sort, setSort] = useState(null);

  const sorted = useMemo(() => {
    if (!sort) return rows;
    // Copied before sorting: `rows` is the reading itself, and the order it
    // arrived in is the order the statement was printed in.
    return [...rows].sort((a, b) => SORTS[sort.by](a, b) * sort.dir);
  }, [rows, sort]);

  const clickHeader = (by) =>
    setSort((held) => (held?.by === by ? { by, dir: held.dir * -1 } : { by, dir: 1 }));

  return (
    <section className="scan-rows-section">
      <div className="scan-rows-head">
        <h3>Every line ({rows.length})</h3>
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
                  className={`${by === 'amount' ? 'num ' : ''}${sort?.by === by ? 'sorted' : ''}`}
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
            {sorted.map((row, i) => (
              <tr key={i} className={row.confidence === 'low' ? 'unsure' : undefined}>
                <td className="when">
                  {row.date}
                  {/* The posting date, when the statement printed two columns
                    and they differ. Shown small and quieter than the
                    transaction date it sits under, because it is a bank fact
                    rather than a spending fact — useful for lining a row up
                    against a bank feed, but not what somebody asks "when did
                    that coffee happen". */}
                  {row.postDate && <small className="post-date">posts {row.postDate}</small>}
                </td>
                <td>
                  <b>{row.merchant}</b>
                  <small>{row.what}</small>
                  {/* The line as the bank printed it, so the tidier version
                    above can be checked rather than trusted. */}
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
    </section>
  );
}

const isPdf = (file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

// The size of the thing being asked about, so the locked card names a document
// rather than describing one.
function fileSize(file) {
  if (!file?.size) return null;
  const mb = file.size / 1024 / 1024;
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(file.size / 1024))} KB`;
}

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
  // How far through the slices it is, what they have cost, and which of them
  // are in the air — shown rather than kept, because the wait is long enough
  // that a spinner alone reads as the app having died.
  const [progress, setProgress] = useState(null);
  // The written paragraph, and only ever after it has been asked for. Held
  // apart from the report because the report is free once the reading is paid
  // for, and this is a second thing that costs money.
  const [summary, setSummary] = useState(null);
  const [writing, setWriting] = useState(false);
  const [summaryError, setSummaryError] = useState(null);
  // Dragging a file over the drop zone, and the flag that ends a reading early.
  const [dragging, setDragging] = useState(false);
  const [stopping, setStopping] = useState(false);
  const stopped = useRef(false);
  const passwordRef = useRef(null);

  const account = accounts.find((a) => a.id === Number(accountId)) ?? accounts[0] ?? null;
  const currency = account?.currency ?? '';

  // The bill so far, added up from what each slice actually reported rather
  // than from the estimate the button made.
  const spent = spentSoFar(progress?.parts);
  // Slices already read, plus the ones in the air behind them. AT_ONCE is the
  // concurrency, so that is how many are in flight at any moment until the end
  // of the queue is reached.
  const inFlightTo = Math.min(progress?.total ?? 0, (progress?.done ?? 0) + AT_ONCE);

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
          got.models.some((m) => m.id === current) ? current : got.defaultModel,
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

  // The slices as they will actually be sent, worked out once so the estimate,
  // the part count and the reading itself all describe the same thing.
  const chunks = useMemo(
    () => (outgoing?.text ? chunkStatement(outgoing.text, linesFor(effort)) : null),
    [outgoing, effort],
  );
  const slicesTotal = chunks?.length ?? 0;
  const estimate = useMemo(
    () => (chunks && chosen ? estimateScan({ chunks, prices: chosen }) : null),
    [chunks, chosen],
  );
  // What the next model up would cost for the same statement. Naming a price
  // without something to weigh it against is not a choice anybody can make —
  // "about 25¢" only means something beside "about $1.00".
  const dearer = useMemo(() => {
    if (!chunks || !choices || !chosen) return null;
    const up = choices.models
      .filter((m) => m.input > chosen.input)
      .sort((a, b) => a.input - b.input)[0];
    return up ? { label: up.label, cost: estimateScan({ chunks, prices: up }) } : null;
  }, [chunks, choices, chosen]);

  // Named in the report from what actually read it, which is not necessarily
  // what was picked — the server has the last word on the model.
  const modelLabel =
    choices?.models.find((m) => m.id === (report?.model ?? model))?.label ?? 'the model';

  // The paragraph and the reading can be written by different models — the
  // reply says which wrote this one, so the credit is not borrowed from above.
  const summaryLabel =
    choices?.models.find((m) => m.id === summary?.model)?.label ?? modelLabel;

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
    setSummary(null);
    setSummaryError(null);
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

  // One way in, whether the file was chosen from the picker or dropped on it.
  async function take(chosen) {
    if (!chosen) return;
    reset();
    setFile(chosen);
    const raw = new Uint8Array(await chosen.arrayBuffer());
    setBytes(raw);
    await read(chosen, raw, '');
  }

  const pick = (e) => take(e.target.files?.[0]);

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
      { input: 0, output: 0, cached: 0, written: 0, cost: 0 },
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
  async function fetchSlices(slices, held, which) {
    setProgress({ done: 0, total: which.length, parts: [] });
    const { results } = await inBatches(
      which.map((i) => slices[i]),
      AT_ONCE,
      (chunk) => scanStatement(chunk, account?.id ?? null, model || null, effort || null),
      // The slices that have settled come back with the count, so the running
      // total on screen is what has actually been billed rather than a share
      // of the estimate.
      (done, total, parts) => setProgress({ done, total, parts: [...parts] }),
      () => stopped.current,
    );
    const next = [...held];
    which.forEach((chunkIndex, k) => {
      if (results[k]) next[chunkIndex] = results[k];
    });
    return next;
  }

  // Stopping keeps everything already read. The slices in the air are already
  // paid for and are allowed to land; the ones not yet asked for never are, and
  // the report says so and offers to finish the job.
  function stopReading() {
    stopped.current = true;
    setStopping(true);
  }

  async function readTransactions() {
    setReading(true);
    setStopping(false);
    stopped.current = false;
    setError(null);
    setProgress({ done: 0, total: chunks?.length ?? 0, parts: [] });
    try {
      // The slices are the ones the estimate was made from — shorter where the
      // model has been asked to think, because the thinking happens before the
      // first row is written and the host stops waiting at sixty seconds
      // regardless.
      const slices = chunks ?? chunkStatement(outgoing.text, linesFor(effort));
      const held = await fetchSlices(
        slices,
        [],
        slices.map((_, i) => i),
      );
      setSlices({ chunks: slices, held });
      await makeReport(slices, held);
    } catch (err) {
      setError(err.message);
    }
    setReading(false);
    setStopping(false);
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
      stopped.current = false;
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

  // Asked for, not automatic. It is a cent or two a press — small, but not
  // nothing, and a scan opened to check one line should not be charged for
  // prose nobody wanted. Always at low effort: this is writing over figures
  // that are already worked out, not a problem to reason about, and thinking
  // bills as writing.
  async function writeSummary() {
    if (!report) return;
    setWriting(true);
    setSummaryError(null);
    try {
      setSummary(
        await summariseStatement(
          report.rows,
          report.statement,
          account?.id ?? null,
          report.model ?? model,
          'low',
        ),
      );
    } catch (err) {
      setSummaryError(err.message || 'The summary could not be written.');
    }
    setWriting(false);
  }

  // The one thing a scan lets out of this browser, and it never goes near a
  // server: the file is built here from the rows already on screen and handed
  // to the browser's own download. The promise above the dialog still holds —
  // nothing was uploaded and nothing was stored — but this is a copy that
  // outlives the dialog, so it is a button somebody presses rather than
  // something that happens.
  function downloadCsv() {
    if (!report) return;
    const blob = new Blob([toCsv(report.rows, currency)], {
      type: 'text/csv;charset=utf-8',
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = csvName(report.overview);
    document.body.appendChild(link);
    link.click();
    link.remove();
    // Released on the next turn rather than immediately: revoking it in the
    // same tick cancels the download in some browsers before it has started.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  // Once there is a report, that is the whole screen. It is a document with
  // its own header, its own nav and its own scroller — see StatementReport.jsx
  // — so the dialog goes bare and hands it the box, rather than stacking it
  // under a file picker and a title bar with nothing left to do.
  if (report) {
    return (
      <DisplayContext.Provider value={shown}>
        <Modal title="Scan a statement" onClose={onClose} className="scanner room" bare>
          <StatementReport
            report={report}
            currency={currency}
            account={account}
            fileName={file?.name}
            modelLabel={modelLabel}
            costPhrase={costPhrase}
            summary={summary}
            summaryLabel={summaryLabel}
            writing={writing}
            summaryError={summaryError}
            onWriteSummary={writeSummary}
            onDownloadCsv={downloadCsv}
            onScanAnother={reset}
            onClose={onClose}
            reading={reading}
            progress={progress}
            onReadMissing={readMissing}
            /* What was sent, kept and folded. The preview is the proof of what
               left this browser, and that does not stop being true once the
               answer arrives — it just stops being the thing on screen. */
            source={
              result?.hasText ? (
                <details className="scan-source">
                  <summary>What was sent to be read</summary>
                  <div className="scan-source-body">
                    <div className="scan-sanitise">
                      <span className="muted">
                        {sanitise
                          ? `${hiddenPhrase(outgoing)} This is what left this browser — the file and any password did not.`
                          : 'This went exactly as it is printed, account numbers and all.'}
                      </span>
                    </div>
                    <pre className="scan-preview">{outgoing.text}</pre>
                  </div>
                </details>
              ) : null
            }
          />
        </Modal>
      </DisplayContext.Provider>
    );
  }

  // Which of the three steps this is. Derived rather than held: the state that
  // decides it — a file, its text, a reading in flight — is state the scan
  // already keeps, and a second copy of it would be a second thing to get
  // wrong.
  // Step two is reached by a file that opened, not by one that had words in
  // it. A statement whose pages are photographs has nothing to send and so
  // nothing to check — but it has been opened, and showing it the picker again
  // says the file failed when it did not.
  const step = reading ? 3 : result ? 2 : 1;
  const stepWords = {
    1: locked ? 'This one is locked' : 'Choose the file',
    2: result?.hasText ? 'Check what is sent' : 'Nothing here to send',
    3: `about ${Math.max(10, (slicesTotal || 1) * 12)} seconds`,
  };

  return (
    <DisplayContext.Provider value={shown}>
      <Modal title="Scan a statement" onClose={onClose} className="scanner">
        {/* Three segments, drawn from the first screen, so the shape of the
          task is visible before any of it is done. A file picker with no idea
          how much comes after it is a file picker somebody abandons. */}
        <div className="scan-steps">
          <span className="scan-step-said">
            Step {step} of 3 · {stepWords[step]}
          </span>
          <span className="scan-step-rail" aria-hidden="true">
            {[1, 2, 3].map((n) => (
              <i key={n} className={n <= step ? 'on' : ''} />
            ))}
          </span>
        </div>

        {error && <div className="error-text">{error}</div>}

        {/* ── Step one: the file ─────────────────────────────────────── */}
        {step === 1 && !locked && (
          <>
            <label
              className={`scan-drop${dragging ? ' over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                const dropped = e.dataTransfer?.files?.[0];
                if (dropped) take(dropped);
              }}
            >
              <b>Drop a statement here</b>
              <span>PDF or CSV · a locked PDF is fine</span>
              <span className="scan-drop-button">{busy ? 'Opening…' : 'Choose a file'}</span>
              <input
                type="file"
                accept=".pdf,.csv,application/pdf,text/csv"
                onChange={pick}
                disabled={busy}
              />
            </label>

            {/* The promise, made where the file is handed over rather than in
              a footnote underneath everything. */}
            <p className="scan-promise">
              <b>The file and its password never leave this browser.</b> Only the text is sent to
              be read, and nothing is saved — closing this is the whole cleanup.
            </p>
          </>
        )}

        {/* ── Step one, locked ───────────────────────────────────────── */}
        {step === 1 && locked && (
          <>
            <div className="scan-file">
              <span className="scan-file-what">
                <b>{file?.name}</b>
                <small className="scan-summary">
                  {[fileSize(file), result?.pageCount ? `${result.pageCount} pages` : null]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
              <span className="scan-badge">Locked</span>
            </div>

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
                    ? 'That one did not open it. Banks often use a date of birth with the last four digits of the card.'
                    : 'Banks often use a date of birth with the last four digits of the card. It is tried here in your browser and sent nowhere.'}
                </span>
              </label>
              <button type="submit" className="primary" disabled={busy || !password}>
                {busy ? 'Opening…' : 'Open it'}
              </button>
            </form>
            <button type="button" className="subtle" onClick={reset}>
              Choose another file
            </button>
          </>
        )}

        {/* ── Step two: what is sent, and what it will cost ──────────── */}
        {step === 2 && (
          <>
            <div className="scan-file">
              <span className="scan-file-what">
                <b>{file?.name}</b>
                <small className="scan-summary">
                  {[
                    result.pageCount ? `${result.pageCount} page${result.pageCount === 1 ? '' : 's'}` : null,
                    `${result.text.split('\n').length} lines of text found`,
                    result.imageCount
                      ? `${result.imageCount} scanned page${result.imageCount === 1 ? '' : 's'}`
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </small>
              </span>
            </div>

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
            {/* What was taken out, as something readable in two seconds. It
              used to be a sentence over a thousand lines of proof, which meant
              the proof was the screen and the summary was a caption on it. The
              proof is still here and still exact; it is just folded. */}
            <div className="scan-hidden scan-sanitise">
              <div className="scan-hidden-head">
                <b>{sanitise ? 'Hidden before sending' : 'Nothing is being hidden'}</b>
                <label>
                  <input
                    type="checkbox"
                    checked={sanitise}
                    onChange={(e) => setSanitise(e.target.checked)}
                    disabled={reading}
                  />
                  Hide account numbers and contact details
                </label>
              </div>

              {sanitise && (outgoing.found.length > 0 || outgoing.dropped > 0) && (
                <ul className="scan-hidden-list">
                  {outgoing.found.map((f, i) => (
                    <li key={`${f.kind}-${i}`}>{f.what}</li>
                  ))}
                  {outgoing.dropped > 0 && (
                    <li>
                      {outgoing.dropped} line{outgoing.dropped === 1 ? '' : 's'} of letterhead
                    </li>
                  )}
                </ul>
              )}

              <span className="muted">
                {!sanitise
                  ? 'The text goes exactly as it is printed, account numbers and all.'
                  : outgoing.found.length || outgoing.dropped
                    ? 'Your name, address and card number have nothing to do with what you spent, and the letterhead rides along with every part.'
                    : 'Nothing in this statement needed hiding.'}
              </span>

              <details className="scan-proof">
                <summary>
                  See exactly what is sent{' '}
                  <small>{outgoing.text.split('\n').length} lines</small>
                </summary>
                {/* The claim sits against the thing that proves it. This is not
                  a promise about what will be sent — it is the text that will
                  be, and it is here to be read rather than believed. */}
                <span className="muted">
                  This is what leaves this browser — the file and any password do not.
                </span>
                <pre className="scan-preview">{outgoing.text}</pre>
              </details>
            </div>

            {/* Two rows of the same shape: which account this is read against,
              and what it is read with. */}
            <div className="scan-choice">
              <span className="scan-choice-what">Statement from</span>
              {accounts.length > 1 ? (
                <select value={accountId ?? ''} onChange={(e) => setAccountId(e.target.value)}>
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name} · {a.currency}
                    </option>
                  ))}
                </select>
              ) : (
                <b>{[account?.name, currency].filter(Boolean).join(' · ') || 'This household'}</b>
              )}
            </div>

            {choices && (
              <div className="scan-choice scan-model">
                <span className="scan-choice-what">How to read it</span>
                <div className="scan-choice-controls">
                  <select value={model} onChange={(e) => pickModel(e.target.value)} disabled={reading}>
                    {choices.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                  {/* Only where the model takes one. Haiku refuses the field
                    outright rather than ignoring it, so an effort picker beside
                    it would be a control that breaks the scan. */}
                  {chosen?.effort && (
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
                  )}
                  {/* The price, before the button rather than after it. This is
                    the one part of the app that spends money when something is
                    pressed, and finding that out afterwards is no way to learn
                    it. */}
                  {estimate != null && <b className="scan-estimate">{describeCost(estimate)}</b>}
                </div>
                <span className="muted">
                  {chosen?.note} {dearer ? `${dearer.label} reads the same statement for ${describeCost(dearer.cost)}.` : ''}
                </span>
              </div>
            )}

            <button className="primary" onClick={readTransactions} disabled={reading}>
              Read the transactions
            </button>
            <span className="muted" style={{ fontSize: '0.8rem' }}>
              Nothing is saved. This is gone when you close it.
            </span>
              </>
            )}

            {result.pages
              ?.filter((page) => page.image)
              .map((page) => (
                <figure className="scan-page" key={page.n}>
                  <img src={page.image} alt={`Page ${page.n} of the statement`} />
                  <figcaption>Page {page.n}</figcaption>
                </figure>
              ))}
          </>
        )}

        {/* ── Step three: the reading, part by part ──────────────────── */}
        {step === 3 && (
          <>
            <div className="scan-reading-head">
              <b>
                {progress?.total
                  ? `Part ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                  : 'Reading…'}
              </b>
              <span className="muted">{describeCost(spent)} so far</span>
            </div>

            {/* Each part drawn as itself. A single sliding bar hides that six
              readings are already safely in hand. */}
            <div className="scan-parts" aria-hidden="true">
              {Array.from({ length: progress?.total ?? 0 }, (_, i) => (
                <i
                  key={i}
                  className={i < (progress?.done ?? 0) ? 'read' : i < inFlightTo ? 'flight' : ''}
                />
              ))}
            </div>
            <span className="muted scan-parts-said">
              {progress?.total
                ? `${progress.done} read · ${Math.max(0, inFlightTo - progress.done)} in flight · ${Math.max(0, progress.total - inFlightTo)} to go · about ${linesFor(effort)} lines each`
                : ''}
            </span>

            <p className="scan-promise">
              A part that fails is asked for once more, and the parts already read are kept either
              way. One slow part no longer costs you the whole statement.
            </p>

            <button className="subtle" onClick={stopReading} disabled={stopping}>
              {stopping ? 'Stopping…' : 'Stop reading'}
            </button>
          </>
        )}
      </Modal>
    </DisplayContext.Provider>
  );
}
