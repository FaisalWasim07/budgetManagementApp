import { useContext, useRef, useState } from "react";
import Modal from "./Modal";
import { scanStatement, analyseStatement } from "../api/statements";
import { chunkStatement, inBatches, AT_ONCE } from "../utils/statementChunks";
import { DisplayContext, Money } from "../utils/display";
import { readPdf, PdfPasswordError, WRONG_PASSWORD } from "../utils/pdfText";

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
  const {
    duplicates = [],
    repeats = [],
    missingSubscriptions = [],
    outliers = [],
    frequent = [],
  } = findings;
  const unlisted = repeats.filter((r) => !r.listed);

  const sections = [
    unlisted.length && {
      key: "unlisted",
      title: "Charging regularly, and not in your subscriptions",
      items: unlisted.map((r) => (
        <>
          <b>{r.merchant}</b> — <Money amount={r.amount} currency={currency} />,{" "}
          {r.times} times
        </>
      )),
    },
    missingSubscriptions.length && {
      key: "missing",
      title: "Budgeted for, but nothing charged on this statement",
      items: missingSubscriptions.map((m) => (
        <>
          <b>{m.name}</b> — <Money amount={m.amount} currency={currency} /> a
          month
        </>
      )),
    },
    duplicates.length && {
      key: "dupes",
      title: "The same charge twice on one day",
      // Flagged, not accused: a repeat on one day is often perfectly real.
      items: duplicates.map((d) => (
        <>
          <b>{d.merchant}</b> — <Money amount={d.amount} currency={currency} />,{" "}
          {d.times} times on {d.date}. Worth a look.
        </>
      )),
    },
    outliers.length && {
      key: "outliers",
      title: "Larger than usual for their category",
      items: outliers.map((o) => (
        <>
          <b>{o.merchant}</b> — <Money amount={o.amount} currency={currency} />{" "}
          against a typical <Money amount={o.typical} currency={currency} /> in{" "}
          {o.category}
        </>
      )),
    },
    frequent.length && {
      key: "frequent",
      title: "Small, and often",
      items: frequent.map((f) => (
        <>
          <b>{f.merchant}</b> — {f.times} times,{" "}
          <Money amount={f.total} currency={currency} /> in total
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

const isPdf = (file) =>
  file.type === "application/pdf" || /\.pdf$/i.test(file.name);

export default function StatementScanner({ onClose, accounts = [] }) {
  const [file, setFile] = useState(null);
  const [bytes, setBytes] = useState(null);
  const [password, setPassword] = useState("");
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
  // How far through the slices it is. Shown rather than kept, because the wait
  // is long enough that a spinner alone reads as the app having died.
  const [progress, setProgress] = useState(null);
  const passwordRef = useRef(null);

  const account =
    accounts.find((a) => a.id === Number(accountId)) ?? accounts[0] ?? null;
  const currency = account?.currency ?? "";

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
    setPassword("");
    setLocked(null);
    setError(null);
    setResult(null);
    setReport(null);
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
        setError(err.message || "That file could not be read.");
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
    await read(chosen, raw, "");
  }

  function unlock(e) {
    e.preventDefault();
    if (file && bytes) read(file, bytes, password);
  }

  // The one thing here that leaves the machine, and only when asked for. The
  // text goes; the file and the password never do.
  async function readTransactions() {
    setReading(true);
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      const chunks = chunkStatement(result.text);
      setProgress({ done: 0, total: chunks.length });

      const parts = await inBatches(
        chunks,
        AT_ONCE,
        (chunk) => scanStatement(chunk, account?.id ?? null),
        (done, total) => setProgress({ done, total }),
      );

      // Slices come back in the order they were sent, so the rows are already
      // in the order they were printed in.
      const rows = parts.flatMap((part) => part.rows ?? []);
      // Balances are printed once, at the top, so they arrive with whichever
      // slice happened to carry the header.
      const statement =
        parts
          .map((part) => part.statement)
          .find((s) => s && s.closingBalance != null) ?? null;

      if (rows.length === 0) {
        setError("Nothing in this file read as a transaction.");
      } else {
        const analysis = await analyseStatement(rows, statement);
        setReport({ rows, statement, ...analysis });
      }
    } catch (err) {
      setError(err.message);
    }
    setReading(false);
    setProgress(null);
  }

  return (
    <DisplayContext.Provider value={shown}>
      <Modal title="Scan a statement" onClose={onClose} className="scanner">
        <div className="stack-sm">
          <span className="muted" style={{ fontSize: "0.85rem" }}>
            Read here in your browser. The file is not uploaded and nothing is
            saved — close this and it is gone.
          </span>
        </div>

        <label className="field">
          Statement
          <input
            type="file"
            accept=".pdf,.csv,application/pdf,text/csv"
            onChange={pick}
          />
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
                  ? "That one did not open it. Banks often use a date of birth with part of a card number."
                  : "This statement is locked. The password stays in this browser — it is not sent anywhere."}
              </span>
            </label>
            <button
              type="submit"
              className="primary"
              disabled={busy || !password}
            >
              {busy ? "Opening…" : "Open it"}
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
            <span
              className="muted scan-summary"
              style={{ fontSize: "0.85rem" }}
            >
              {file?.name}
              {result.pageCount
                ? ` · ${result.pageCount} page${result.pageCount === 1 ? "" : "s"}`
                : ""}
              {result.hasText
                ? ` · ${result.text.split("\n").length} lines of text`
                : ""}
              {result.imageCount
                ? ` · ${result.imageCount} scanned page${result.imageCount === 1 ? "" : "s"}`
                : ""}
            </span>

            {/* Said once, at the top, rather than beside every picture. A page
              that is a photograph is not a failure — it is simply read a
              different way, and there is nothing here for the person to fix. */}
            {result.imageCount > 0 && (
              <div className="warn-banner">
                {result.hasText
                  ? "Some pages are scanned rather than typed, so there are no words to pull out of them. They are shown below as they are."
                  : "This statement is scanned — the pages are pictures rather than words. They are shown below as they are."}
              </div>
            )}

            {result.hasText && (
              <>
                {accounts.length > 1 && !report && (
                  <label className="field">
                    Which account is this from?
                    <select
                      value={accountId ?? ""}
                      onChange={(e) => setAccountId(e.target.value)}
                    >
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name} · {a.currency}
                        </option>
                      ))}
                    </select>
                  </label>
                )}

                {!report && (
                  <>
                    <button
                      className="primary"
                      onClick={readTransactions}
                      disabled={reading}
                    >
                      {!reading
                        ? "Read the transactions"
                        : progress?.total
                          ? `Reading… part ${Math.min(progress.done + 1, progress.total)} of ${progress.total}`
                          : "Reading…"}
                    </button>
                    <span className="muted" style={{ fontSize: "0.8rem" }}>
                      The text below is sent to be read. The file and any
                      password stay here.
                    </span>
                  </>
                )}
              </>
            )}

            {report && (
              <div className="stack-sm scan-report">
                {/* Whether to believe any of the rest of it. The bank prints what
                  the account started and ended at, so the reading can be checked
                  against arithmetic rather than trusted — and when it does not
                  add up, that is said before anything else, not after. */}
                {report.reconciliation?.status === "mismatch" && (
                  <div className="warn-banner">
                    This does not add up. Following the rows from the opening
                    balance lands on{" "}
                    <b>
                      <Money
                        amount={report.reconciliation.expected}
                        currency={currency}
                      />
                    </b>
                    , where the statement closes at{" "}
                    <b>
                      <Money
                        amount={report.reconciliation.closing}
                        currency={currency}
                      />
                    </b>{" "}
                    — a gap of{" "}
                    <b>
                      <Money
                        amount={Math.abs(report.reconciliation.delta)}
                        currency={currency}
                      />
                    </b>
                    .
                    {report.reconciliation.countedTwice
                      ? ` That is the size of the ${report.reconciliation.countedTwice.merchant} line, which may have been counted twice.`
                      : " A line was probably missed or misread."}{" "}
                    Take the figures below as a reading, not as fact.
                  </div>
                )}

                <div className="scan-head">
                  <span>
                    <b>
                      <Money
                        amount={report.overview.spent}
                        currency={currency}
                      />
                    </b>{" "}
                    spent
                    {report.overview.lines
                      ? ` over ${report.overview.lines} lines`
                      : ""}
                    {report.overview.from
                      ? `, ${report.overview.from} to ${report.overview.to}`
                      : ""}
                  </span>
                  {report.reconciliation?.status === "ok" && (
                    <span className="reconciled">
                      adds up to the closing balance
                    </span>
                  )}
                </div>

                {/* Credits are not one thing. Paying a card off is a credit for the
                  whole balance and is not money anybody received. */}
                {report.overview.credits && (
                  <div className="scan-credits">
                    {[
                      ["paid off the card", report.overview.credits.payments],
                      ["came in", report.overview.credits.income],
                      ["refunded", report.overview.credits.refunds],
                      ["cashback", report.overview.credits.cashback],
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
                        <div
                          className="row-tight"
                          style={{ justifyContent: "space-between" }}
                        >
                          <b>{cat.category}</b>
                          <span>
                            <Money amount={cat.total} currency={currency} /> ·{" "}
                            {cat.share}%
                          </span>
                        </div>
                        <div className="scan-bar">
                          <i style={{ width: `${cat.share}%` }} />
                        </div>
                        <small>
                          {cat.count} line{cat.count === 1 ? "" : "s"},
                          averaging{" "}
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
                          <tr
                            key={i}
                            className={
                              row.confidence === "low" ? "unsure" : undefined
                            }
                          >
                            <td className="when">{row.date}</td>
                            <td>
                              <b>{row.merchant}</b>
                              <small>{row.what}</small>
                              {/* The line as the bank printed it, so the tidier
                                version above can be checked rather than trusted. */}
                              <small className="raw">{row.raw}</small>
                            </td>
                            <td>{row.category}</td>
                            <td
                              className={`num ${row.direction === "in" ? "in" : ""}`}
                            >
                              {row.direction === "in" ? "+" : ""}
                              <Money amount={row.amount} currency={currency} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>

                <span className="muted" style={{ fontSize: "0.8rem" }}>
                  Nothing has been saved. This is gone when you close it.
                </span>
              </div>
            )}

            {result.hasText && (
              <pre className="scan-preview">{result.text}</pre>
            )}

            {result.pages
              ?.filter((page) => page.image)
              .map((page) => (
                <figure className="scan-page" key={page.n}>
                  <img
                    src={page.image}
                    alt={`Page ${page.n} of the statement`}
                  />
                  <figcaption>Page {page.n}</figcaption>
                </figure>
              ))}
          </div>
        )}
      </Modal>
    </DisplayContext.Provider>
  );
}
