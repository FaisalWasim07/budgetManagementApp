import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  getKeptStatements,
  compareKeptStatements,
  forgetStatement,
} from '../api/statements';
import { Money } from '../utils/display';
import { SkeletonRows } from '../components/Skeleton';
import ConfirmDialog from '../components/ConfirmDialog';
import ToolbarSlot from '../components/ToolbarSlot';
import { Search, Trash } from '../components/icons';
import { useToast } from '../utils/toast';

// Loaded when someone actually scans something. It carries pdf.js, which is
// half a megabyte — a weight every visit would otherwise pay for a thing done
// once a month.
const StatementScanner = lazy(() => import('../components/StatementScanner'));

// The statements somebody kept, and what can only be said once there are two.
//
// This page reads nothing from the ledger and writes nothing to it. A
// statement is a document a bank printed; the ledger is what the household
// decided to record. They disagree constantly and on purpose — a card payment
// is one line here and a transfer there, cash spent is in the ledger and
// invisible to the bank — so putting them on one screen would force an answer
// to a question nobody has asked yet.
//
// Every figure here is arithmetic over stored rows, worked out on the server
// by the same code that produced each report when it was read. Nothing on this
// page calls the model, so none of it costs anything and none of it can be
// wrong about an amount.

// A period said the way a person would say it. Two dates where the statement
// straddles months, which card statements nearly always do, and one month
// where it sits inside one — because "August 2026" is what you would call it,
// and "1 Aug — 31 Aug" is the same fact spelled out to no one's benefit.
const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function periodName(start, end) {
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(from.valueOf()) || Number.isNaN(to.valueOf())) return `${start} — ${end}`;

  const sameMonth =
    from.getUTCFullYear() === to.getUTCFullYear() && from.getUTCMonth() === to.getUTCMonth();
  if (sameMonth) return `${MONTHS[from.getUTCMonth()]} ${from.getUTCFullYear()}`;

  const day = (d) => d.getUTCDate();
  const short = (d) => MONTHS[d.getUTCMonth()].slice(0, 3);
  const sameYear = from.getUTCFullYear() === to.getUTCFullYear();
  return sameYear
    ? `${day(from)} ${short(from)} — ${day(to)} ${short(to)} ${to.getUTCFullYear()}`
    : `${day(from)} ${short(from)} ${from.getUTCFullYear()} — ${day(to)} ${short(to)} ${to.getUTCFullYear()}`;
}

// A change, coloured by what it means rather than by its sign. Spending more
// is the bad direction, which is the opposite of everywhere else in the app,
// so it is said here rather than assumed.
function Change({ amount, pct, currency }) {
  if (amount === 0) return <span className="stmt-flat">no change</span>;
  const up = amount > 0;
  return (
    <span className={`stmt-change ${up ? 'up' : 'down'}`}>
      {up ? '↑' : '↓'} <Money amount={Math.abs(amount)} currency={currency} compact />
      {pct == null ? null : <small> ({up ? '+' : ''}{pct}%)</small>}
    </span>
  );
}

function MoverRow({ row, currency }) {
  return (
    <li className="stmt-mover">
      <span className="n">{row.name}</span>
      <span className="was">
        <Money amount={row.before} currency={currency} compact />
        {' → '}
        <Money amount={row.after} currency={currency} compact />
      </span>
      <Change amount={row.change} pct={row.pct} currency={currency} />
    </li>
  );
}

export default function Statements({ phone, readOnly, accounts = [] }) {
  const [kept, setKept] = useState(null);
  const [error, setError] = useState(null);
  const [scanning, setScanning] = useState(false);
  // Which two are being compared. Null means the two most recent, which the
  // server already worked out — opening this page should answer the question
  // without anybody choosing anything first.
  const [pair, setPair] = useState(null);
  const [chosen, setChosen] = useState(null);
  const [forgetting, setForgetting] = useState(null);
  const { show } = useToast();

  const load = useCallback(async () => {
    try {
      setError(null);
      setKept(await getKeptStatements());
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const statements = kept?.statements ?? [];
  const currency = statements[0]?.currency ?? '';

  // Newest first on screen, oldest first in the trend: a list is read from the
  // top and a trend is read left to right.
  const newestFirst = useMemo(
    () => [...statements].sort((a, b) => String(b.periodStart).localeCompare(String(a.periodStart))),
    [statements],
  );

  const comparison = pair ?? kept?.latest ?? null;

  async function choose(beforeId, afterId) {
    if (!beforeId || !afterId || beforeId === afterId) return;
    setChosen({ before: beforeId, after: afterId });
    try {
      setPair(await compareKeptStatements(beforeId, afterId));
    } catch (err) {
      setError(err.message);
    }
  }

  async function forget(statement) {
    try {
      await forgetStatement(statement.id);
      setPair(null);
      setChosen(null);
      await load();
      show(`${periodName(statement.periodStart, statement.periodEnd)} forgotten`);
    } catch (err) {
      setError(err.message);
    } finally {
      setForgetting(null);
    }
  }

  // Reading a statement starts here, which is the one action this page has.
  // It opens as a dialog rather than a screen of its own: a destination
  // implies you can come back and find it, and a reading you did not keep is
  // gone the moment it closes.
  const scanButton = readOnly ? null : (
    <button onClick={() => setScanning(true)}>
      <Search size={14} /> Scan a statement
    </button>
  );

  // Above every early return below, not inside the one that has statements to
  // show. The state where nothing is kept yet is exactly the state where
  // somebody most needs the button, and a first run that offers no way to
  // start would be the one screen this page cannot afford to get wrong.
  const chrome = (
    <>
      {/* At a desk the action sits in the top bar; a phone's bar has no room,
          so there it stays on the page — the same arrangement Recurring uses. */}
      {scanButton ? (
        phone ? (
          <div className="section-head">
            <span />
            {scanButton}
          </div>
        ) : (
          <ToolbarSlot>{scanButton}</ToolbarSlot>
        )
      ) : null}

      {scanning && (
        <Suspense fallback={null}>
          <StatementScanner
            onClose={() => setScanning(false)}
            accounts={accounts}
            // Keeping one is the only thing in that dialog this page can see
            // the result of, so it says so and the list behind it fills in
            // without waiting for the dialog to close or the tab to be
            // reloaded.
            onKept={load}
          />
        </Suspense>
      )}
    </>
  );

  if (error) {
    return (
      <>
        {chrome}
        <div className="card">
          <p className="error-text">{error}</p>
        </div>
      </>
    );
  }

  if (!kept) {
    return (
      <>
        {chrome}
        <SkeletonRows count={4} />
      </>
    );
  }

  // Nothing kept yet. The page says what it is for and where the button is,
  // rather than showing an empty frame for a table that has no rows — this is
  // the first thing most people will see here, and "no data" would not tell
  // them that keeping is a thing they have to choose.
  if (statements.length === 0) {
    return (
      <>
        {chrome}
        <div className="card stmt-empty">
          <h3>No statements kept yet</h3>
          <p className="muted">
            Scanning a statement reads it and then forgets it — the rows are gone when you close
            the dialog, which is the promise the scanner has always made. Press <b>Keep</b> on a
            report and it stays here instead, so the next one has something to be compared against.
          </p>
          <p className="muted">
            Statements live on their own. Nothing kept here is written to your accounts, and
            nothing in your accounts is read to produce any of it.
          </p>
          <p className="muted">
            {readOnly
              ? 'You have view-only access to this household, so scanning and keeping are not yours to do here.'
              : 'Scan a statement to start.'}
          </p>
        </div>
      </>
    );
  }

  return (
    <>
      {chrome}
      <p className="page-note">
        {statements.length === 1
          ? 'One statement kept. Keep another to compare them.'
          : `${statements.length} statements kept, ${periodName(
              statements[0].periodStart,
              statements[0].periodEnd,
            )} to ${periodName(
              statements[statements.length - 1].periodStart,
              statements[statements.length - 1].periodEnd,
            )}`}
      </p>

      <div className="stmt-cols">
        {/* The left column is everything true across all the statements kept;
            the right is two of them against each other. Stacked rather than
            side by side because the comparison is far the longer of the two,
            and a short list beside it left a column's worth of nothing. */}
        <div className="stmt-side">
        {/* What is kept. Each one says what it covers and what left the
            account, which is the figure the comparison below is built on. */}
        <section className="card stmt-list">
          <div className="section-head">
            <h3>Kept</h3>
          </div>
          <ul>
            {newestFirst.map((statement) => {
              const figures = kept.trend.find((t) => t.id === statement.id);
              const isChosen =
                chosen &&
                (String(chosen.before) === String(statement.id) ||
                  String(chosen.after) === String(statement.id));
              return (
                <li key={statement.id} className={isChosen ? 'on' : ''}>
                  <span className="n">
                    {periodName(statement.periodStart, statement.periodEnd)}
                    <small>
                      {[statement.personName, statement.accountName].filter(Boolean).join(' · ')}
                      {statement.accountName ? ' · ' : ''}
                      {statement.lines} lines
                    </small>
                  </span>
                  <span className="a">
                    <Money amount={figures?.spent ?? 0} currency={statement.currency} compact />
                  </span>
                  {readOnly ? null : (
                    <button
                      className="subtle"
                      aria-label={`Forget ${periodName(statement.periodStart, statement.periodEnd)}`}
                      onClick={() => setForgetting(statement)}
                    >
                      <Trash />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        {/* The finding a single statement structurally cannot produce. A monthly
            subscription appears exactly once in a one-month statement, so the
            scanner's own repeat-finder can only see a repeat already inside the
            file. Across kept statements the same charge appears once per
            statement, which is the rhythm it was always looking for. */}
        {kept.recurring.length > 0 && (
          <section className="card stmt-recurring">
            <div className="section-head">
              <h3>Charging you every statement</h3>
            </div>
            <p className="muted stmt-sub">
              Found by comparing the statements you kept, not by reading any one of them.
            </p>
            <ul className="stmt-movers">
              {kept.recurring.slice(0, 12).map((item) => (
                <li className="stmt-mover" key={item.merchant}>
                  <span className="n">
                    {item.merchant}
                    <small>
                      {item.statements} statements
                      {item.priceMove ? ` · was ${item.priceMove.before}` : ''}
                    </small>
                  </span>
                  <span className="a">
                    <Money amount={item.latest} currency={currency} compact />
                  </span>
                  {item.priceMove ? (
                    <Change
                      amount={item.priceMove.change}
                      pct={item.priceMove.pct}
                      currency={currency}
                    />
                  ) : (
                    <span className="stmt-flat">same each time</span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
        </div>

        {/* The comparison. Two statements the reader picked, or the two most
            recent when they have not picked any. */}
        <section className="card stmt-compare">
          <div className="section-head">
            <h3>What changed</h3>
          </div>

          {statements.length < 2 ? (
            <p className="muted">
              One statement cannot be compared with anything. Keep a second and this fills in.
            </p>
          ) : (
            <>
              <div className="stmt-pick">
                <select
                  aria-label="Earlier statement"
                  value={chosen?.before ?? comparison?.beforeId ?? comparison?.before?.id ?? ''}
                  onChange={(e) =>
                    choose(
                      e.target.value,
                      chosen?.after ?? comparison?.afterId ?? comparison?.after?.id,
                    )
                  }
                >
                  {newestFirst.map((s) => (
                    <option key={s.id} value={s.id}>
                      {periodName(s.periodStart, s.periodEnd)}
                    </option>
                  ))}
                </select>
                <span className="stmt-vs">against</span>
                <select
                  aria-label="Later statement"
                  value={chosen?.after ?? comparison?.afterId ?? comparison?.after?.id ?? ''}
                  onChange={(e) =>
                    choose(
                      chosen?.before ?? comparison?.beforeId ?? comparison?.before?.id,
                      e.target.value,
                    )
                  }
                >
                  {newestFirst.map((s) => (
                    <option key={s.id} value={s.id}>
                      {periodName(s.periodStart, s.periodEnd)}
                    </option>
                  ))}
                </select>
              </div>

              {comparison ? (
                <>
                  <p className="stmt-headline">
                    Spending{' '}
                    <Change
                      amount={comparison.spent.change}
                      pct={comparison.spent.pct}
                      currency={currency}
                    />
                    <small>
                      <Money amount={comparison.spent.before} currency={currency} compact /> then{' '}
                      <Money amount={comparison.spent.after} currency={currency} compact />
                    </small>
                  </p>

                  {/* Before the category list, not after it: this is the one
                      thing that can make every figure under it misleading, and
                      a caveat printed below the claim it qualifies is a caveat
                      nobody reads. */}
                  {comparison.recategorised?.length > 0 && (
                    <div className="stmt-caveat">
                      <b>Read the categories with this in mind.</b> The reading filed{' '}
                      {comparison.recategorised.length === 1 ? 'a merchant' : 'some merchants'}{' '}
                      differently in the two statements, so part of what looks like a category
                      moving is the same spending wearing another name.
                      <ul>
                        {comparison.recategorised.map((r) => (
                          <li key={r.merchant}>
                            <b>{r.merchant}</b> — {r.was} then {r.now},{' '}
                            <Money amount={r.amount} currency={currency} compact /> of it
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <h4>Categories</h4>
                  {comparison.categories.length === 0 ? (
                    <p className="muted">Nothing moved between categories.</p>
                  ) : (
                    <ul className="stmt-movers">
                      {comparison.categories.slice(0, 8).map((row) => (
                        <MoverRow key={row.name} row={row} currency={currency} />
                      ))}
                    </ul>
                  )}

                  <h4>Merchants</h4>
                  {comparison.merchants.appeared.length > 0 && (
                    <>
                      <p className="stmt-sub">New this statement</p>
                      <ul className="stmt-movers">
                        {comparison.merchants.appeared.slice(0, 6).map((row) => (
                          <MoverRow key={row.name} row={row} currency={currency} />
                        ))}
                      </ul>
                    </>
                  )}
                  {comparison.merchants.stopped.length > 0 && (
                    <>
                      <p className="stmt-sub">Gone since the last one</p>
                      <ul className="stmt-movers">
                        {comparison.merchants.stopped.slice(0, 6).map((row) => (
                          <MoverRow key={row.name} row={row} currency={currency} />
                        ))}
                      </ul>
                    </>
                  )}
                  {comparison.merchants.moved.length > 0 && (
                    <>
                      <p className="stmt-sub">Charging something different</p>
                      <ul className="stmt-movers">
                        {comparison.merchants.moved.slice(0, 6).map((row) => (
                          <MoverRow key={row.name} row={row} currency={currency} />
                        ))}
                      </ul>
                    </>
                  )}
                </>
              ) : null}
            </>
          )}
        </section>
      </div>

      {forgetting && (
        <ConfirmDialog
          title="Forget this statement?"
          detail={`${periodName(
            forgetting.periodStart,
            forgetting.periodEnd,
          )} and its ${forgetting.lines} lines are removed. Nothing in your accounts changes.`}
          confirmLabel="Forget it"
          onConfirm={() => forget(forgetting)}
          onCancel={() => setForgetting(null)}
        />
      )}
    </>
  );
}
