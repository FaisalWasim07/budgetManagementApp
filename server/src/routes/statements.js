const express = require('express');
const db = require('../db/pool');
const statementService = require('../services/statementService');
const statementFindings = require('../services/statementFindings');
const statementHistory = require('../services/statementHistory');
const { h } = require('../util/route');

const router = express.Router();

// This router is mounted ABOVE blockViewerWrites — see the comment at that
// line in app.js. That was right when every POST here wrote nothing at all:
// reading a statement is a look at a document somebody is holding, and
// view-only access to a household is no reason to refuse it.
//
// Keeping and forgetting a statement DO write, so they carry the guard the
// mount point does not. It is declared here, next to the routes it protects,
// rather than by moving the mount: moving it would take the scan route's
// exemption away with it, and that exemption is the reason the mount is where
// it is.
function blockViewers(req, res, next) {
  if (req.household.role === 'viewer') {
    return res.status(403).json({
      error: 'You have view-only access to this household.',
      code: 'VIEW_ONLY',
    });
  }
  next();
}

// One request now carries a slice of a statement rather than all of it, so the
// ceiling is per slice. It is a guard against a mistake — a book pasted into
// the box — not against any statement anybody holds.
const MAX_TEXT = 400_000;

// A statement with more lines than this is not a statement.
const MAX_ROWS = 2000;

// Reading is split because the answer is long, not because the question is: a
// statement of a hundred and fifteen transactions needs a hundred and fifteen
// rows written out, which takes minutes and times the request out long before
// the model is finished. Slices of thirty lines come back in seconds each, and
// the browser asks for the next one.

// Nothing here reads the ledger. Scanning a statement is a look at a document
// somebody is holding, and it stays that: no transactions, no subscriptions, no
// category list. Two of those used to be read — the household's subscriptions,
// so the report could say which recurring charges were already budgeted for,
// and its category names, so the model would use the same words the rest of the
// app does. Both were useful and both were the wrong shape: they put the ledger
// inside a statement report, which then listed things the statement had never
// mentioned, and sent the household's own category names out with every slice.
//
// The account is looked up for one thing only, its currency, and that is a
// property of what is being read rather than anything in the books.
// What a statement may be read with. Served rather than hardcoded in the
// browser so the list of models — and their prices — has one home, and a client
// cannot ask for a model nobody put on it.
router.get(
  '/models',
  h(async (req, res) => {
    res.json(statementService.choices());
  })
);

// Reads a statement and hands the rows straight back. Nothing is written: no
// statement row, no transaction, no file. The response *is* the result, and
// closing the tab is the whole cleanup.
router.post(
  '/scan',
  h(async (req, res) => {
    const text = typeof req.body?.text === 'string' ? req.body.text.trim() : '';
    if (!text) {
      return res.status(400).json({ error: 'There was no statement text to read.' });
    }
    if (text.length > MAX_TEXT) {
      return res.status(413).json({
        error: 'That is longer than any statement this can read in one go.',
      });
    }

    // The currency is the account's, not a guess from the page. A statement is
    // read against one account and inherits what that account is kept in.
    let currency = null;
    if (req.body.account_id) {
      const account = await db.get(
        'SELECT currency FROM accounts WHERE id = ? AND household_id = ?',
        [req.body.account_id, req.household.id]
      );
      currency = account?.currency ?? null;
    }

    try {
      // The model and effort are a suggestion from the browser. An
      // unrecognised one falls back to the default rather than being passed on
      // to the API, so the choice is always one of ours.
      const model = statementService.modelFor(req.body.model);
      const { rows, statement, usage } = await statementService.scan({
        text,
        currency,
        model,
        effort: req.body.effort,
      });

      // Every figure below this line is worked out from the rows, in code. The
      // model counted nothing and totalled nothing — including the check that
      // says whether its reading of the statement adds up to the bank's own
      // closing balance.
      const analysis = statementFindings.analyse(rows, statement);

      // Priced here, where the prices live, so the browser adds up dollars
      // rather than tokens times a rate it holds a stale copy of.
      res.json({
        rows,
        statement,
        ...analysis,
        usage,
        model,
        cost: statementService.priceOf({ model, usage }),
      });
    } catch (err) {
      if (err instanceof statementService.StatementScanError) {
        // Logged in full; the caller is told the shape of the problem without
        // the detail, which is the same bargain the health check makes.
        console.error('Statement scan failed:', err.code, err.message);
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  })
);

// Only the fields the arithmetic uses, and coerced here rather than trusted:
// these arrive from a browser, which is to say from anywhere. Shared by the two
// routes below so the summary is written from exactly the figures the report
// shows, worked out the same way.
function cleanRows(rows) {
  return rows
    .map((row) => ({
      date: String(row.date ?? '').slice(0, 10),
      merchant: String(row.merchant ?? ''),
      amount: Math.abs(Number(row.amount)),
      direction: row.direction === 'in' ? 'in' : 'out',
      kind: String(row.kind ?? 'other'),
      category: String(row.category ?? '') || 'Uncategorised',
    }))
    .filter((row) => Number.isFinite(row.amount) && row.amount > 0);
}

// Rows arrive from the browser, so they are checked before either route works
// from them. Returns the cleaned rows, or answers and returns null.
function rowsFrom(req, res) {
  const rows = Array.isArray(req.body?.rows) ? req.body.rows : null;
  if (!rows) {
    res.status(400).json({ error: 'There were no rows to work through.' });
    return null;
  }
  if (rows.length > MAX_ROWS) {
    res.status(413).json({ error: 'That is more lines than this can work through at once.' });
    return null;
  }
  return cleanRows(rows);
}

// The arithmetic, over every slice at once. No model, so it answers in
// milliseconds — and it has to be separate from reading, because findings over
// a third of a statement are not findings, they are a third of the truth.
router.post(
  '/analyse',
  h(async (req, res) => {
    const rows = rowsFrom(req, res);
    if (!rows) return undefined;
    return res.json(statementFindings.analyse(rows, req.body.statement ?? null));
  })
);

// The written half of the report: what this month looks like, in prose, over
// the figures the arithmetic above already produced.
//
// Asked for, never automatic. It is the second time a scan spends money, and
// the first time it does so for something to read rather than something to
// check — so it happens when a button is pressed and the price of pressing it
// comes back in the answer.
//
// The rows are sent again rather than the report: the figures the model is
// given are worked out here, from the rows, by the same code that produced what
// is on screen. A browser cannot hand this route a total and have it described.
router.post(
  '/summary',
  h(async (req, res) => {
    const rows = rowsFrom(req, res);
    if (!rows) return undefined;
    if (rows.length === 0) {
      return res.status(400).json({ error: 'There were no rows to work through.' });
    }

    // The account is read for its currency and nothing else, exactly as the
    // scan route reads it. A statement is described in the money it is printed
    // in; nothing else about the household goes into this.
    let currency = null;
    if (req.body.account_id) {
      const account = await db.get(
        'SELECT currency FROM accounts WHERE id = ? AND household_id = ?',
        [req.body.account_id, req.household.id]
      );
      currency = account?.currency ?? null;
    }

    const analysis = statementFindings.analyse(rows, req.body.statement ?? null);

    try {
      const model = statementService.modelFor(req.body.model);
      const { summary, usage } = await statementService.summarise({
        analysis,
        currency,
        model,
        effort: req.body.effort,
      });
      return res.json({
        summary,
        usage,
        model,
        cost: statementService.priceOf({ model, usage }),
      });
    } catch (err) {
      if (err instanceof statementService.StatementScanError) {
        console.error('Statement summary failed:', err.code, err.message);
        return res.status(err.status).json({ error: err.message, code: err.code });
      }
      throw err;
    }
  })
);

// --- kept statements -------------------------------------------------------

// Everything above this line reads a document and hands it straight back.
// Everything below keeps what was read, so that next month has something to be
// compared against — which is the one thing a scan could never do before,
// however well it read the file.

// The enum the scan schema uses. A row arrives from a browser, and the column
// carries a CHECK, so anything unrecognised becomes 'other' here rather than
// reaching the database and raising a 500 on a value a client chose.
const KINDS = ['purchase', 'payment', 'refund', 'cashback', 'income', 'fee', 'other'];

const date = (value) => {
  const text = String(value ?? '').slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
};

// The rows as they will be stored: everything the report shows, coerced, with
// the line the bank printed kept exactly as it was. This is deliberately wider
// than `cleanRows` above — that one keeps only what the arithmetic reads,
// because it is answering a question and throwing the rows away. These are
// being kept, so `raw`, `what` and `confidence` come too: a tidied merchant
// name you cannot check against the original is worth very little in a year,
// and a guess that loses its low-confidence mark on being stored becomes a
// fact nobody agreed to.
function rowsToKeep(rows) {
  return rows
    .map((row, i) => ({
      sortOrder: i,
      entryDate: date(row.date),
      postDate: date(row.postDate),
      raw: String(row.raw ?? ''),
      merchant: String(row.merchant ?? ''),
      what: row.what == null ? null : String(row.what),
      amount: Math.abs(Number(row.amount)),
      direction: row.direction === 'in' ? 'in' : 'out',
      kind: KINDS.includes(row.kind) ? row.kind : 'other',
      // Through the canonicaliser, which is the difference between a category
      // and a join key. A scan cannot invent a word any more — the schema
      // closed that — but these rows arrive from a browser, and a statement
      // stored saying "eating  out" would compare against next month's
      // "Eating out" as two unrelated categories, one vanishing and one
      // appearing, both totals wrong.
      category: statementService.canonicalCategory(row.category),
      confidence: row.confidence === 'low' ? 'low' : 'high',
    }))
    .filter((row) => row.entryDate && Number.isFinite(row.amount) && row.amount > 0);
}

// What period this statement covers. The bank's own dates where it printed
// them, and the span of the rows where it did not — a plain transaction list
// often prints neither, and a statement with no period could not be put in a
// sequence, which is the whole point of keeping it.
function periodOf(statement, rows) {
  const dates = rows.map((row) => row.entryDate).sort();
  const start = date(statement?.periodStart) ?? dates[0] ?? null;
  const end = date(statement?.periodEnd) ?? dates[dates.length - 1] ?? null;
  return { start, end };
}

const number = (value) => (Number.isFinite(Number(value)) && value !== null ? Number(value) : null);

// Keeps one statement. Re-keeping the same account and period replaces what
// was there: a statement is a document, and scanning August twice does not
// give you two Augusts. The delete and the insert share a transaction so a
// failed re-keep cannot leave the old one gone and the new one unwritten.
router.post(
  '/kept',
  blockViewers,
  h(async (req, res) => {
    const submitted = Array.isArray(req.body?.rows) ? req.body.rows : null;
    if (!submitted) {
      return res.status(400).json({ error: 'There were no rows to keep.' });
    }
    if (submitted.length > MAX_ROWS) {
      return res.status(413).json({ error: 'That is more lines than this can keep at once.' });
    }

    const rows = rowsToKeep(submitted);
    if (rows.length === 0) {
      return res.status(400).json({ error: 'None of those lines could be kept.' });
    }

    const period = periodOf(req.body?.statement, rows);
    if (!period.start || !period.end) {
      return res.status(400).json({ error: 'That statement has no dates to file it under.' });
    }

    // The account is a claim from a browser until it is confirmed to be one of
    // this household's, exactly as the scan route treats it.
    let accountId = null;
    let currency = null;
    if (req.body.account_id) {
      const account = await db.get(
        'SELECT id, currency FROM accounts WHERE id = ? AND household_id = ?',
        [req.body.account_id, req.household.id]
      );
      accountId = account?.id ?? null;
      currency = account?.currency ?? null;
    }

    const kept = await db.tx(async (t) => {
      // IS NOT DISTINCT FROM rather than =, so a statement kept without an
      // account matches another kept without one. With = the null would match
      // nothing and every re-keep would pile up another copy.
      await t.run(
        `DELETE FROM statements
          WHERE household_id = ?
            AND account_id IS NOT DISTINCT FROM ?
            AND period_start = ?
            AND period_end = ?`,
        [req.household.id, accountId, period.start, period.end]
      );

      const { rows: created } = await t.run(
        `INSERT INTO statements
           (household_id, account_id, period_start, period_end, currency,
            opening_balance, closing_balance, kept_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING id`,
        [
          req.household.id,
          accountId,
          period.start,
          period.end,
          currency,
          number(req.body?.statement?.openingBalance),
          number(req.body?.statement?.closingBalance),
          req.user.id,
        ]
      );
      const id = created[0].id;

      // Every row in one statement, not one statement per row.
      //
      // This was a loop of awaited inserts, which is the same work and the
      // same transaction — and on a database reached over a unix socket it is
      // indistinguishable. Over a pooler in another region it is not: each
      // insert is a network round-trip, they are sequential because each is
      // awaited, and a hundred-line statement spent a hundred latencies end
      // to end. The figure people saw was "keeping…" for several seconds on a
      // statement that takes milliseconds to write.
      //
      // Twelve columns and a ceiling of MAX_ROWS rows is 24,000 parameters,
      // comfortably under Postgres's 65,535 per statement, so this never needs
      // chunking at any size this route accepts.
      const columns = 12;
      const placeholders = rows.map(() => `(${new Array(columns).fill('?').join(', ')})`).join(', ');
      await t.run(
        `INSERT INTO statement_rows
           (statement_id, sort_order, entry_date, post_date, raw, merchant, what,
            amount, direction, kind, category, confidence)
         VALUES ${placeholders}`,
        rows.flatMap((row) => [
          id,
          row.sortOrder,
          row.entryDate,
          row.postDate,
          row.raw,
          row.merchant,
          row.what,
          row.amount,
          row.direction,
          row.kind,
          row.category,
          row.confidence,
        ])
      );

      return id;
    });

    res.status(201).json({ id: kept, periodStart: period.start, periodEnd: period.end, rows: rows.length });
  })
);

const toRow = (row) => ({
  date: row.entry_date,
  postDate: row.post_date,
  raw: row.raw,
  merchant: row.merchant,
  what: row.what,
  amount: row.amount,
  direction: row.direction,
  kind: row.kind,
  category: row.category,
  confidence: row.confidence,
});

// Every kept statement with its rows, for this household. The rows come back
// too: the comparison needs all of them, the whole point is having several at
// once, and a year of statements is a few thousand rows rather than a size
// worth paginating.
async function keptFor(householdId) {
  const statements = await db.all(
    `SELECT s.id, s.account_id, s.period_start, s.period_end, s.currency,
            s.opening_balance, s.closing_balance, s.kept_at,
            a.name AS account_name, p.name AS person_name
       FROM statements s
       LEFT JOIN accounts a ON a.id = s.account_id
       LEFT JOIN persons p ON p.id = a.person_id
      WHERE s.household_id = ?
      ORDER BY s.period_start`,
    [householdId]
  );
  if (statements.length === 0) return [];

  const rows = await db.all(
    `SELECT r.* FROM statement_rows r
       JOIN statements s ON s.id = r.statement_id
      WHERE s.household_id = ?
      ORDER BY r.statement_id, r.sort_order`,
    [householdId]
  );

  const byStatement = new Map();
  for (const row of rows) {
    if (!byStatement.has(row.statement_id)) byStatement.set(row.statement_id, []);
    byStatement.get(row.statement_id).push(toRow(row));
  }

  return statements.map((s) => ({
    id: s.id,
    accountId: s.account_id,
    accountName: s.account_name,
    personName: s.person_name,
    periodStart: s.period_start,
    periodEnd: s.period_end,
    currency: s.currency,
    openingBalance: s.opening_balance,
    closingBalance: s.closing_balance,
    keptAt: s.kept_at,
    rows: byStatement.get(s.id) ?? [],
  }));
}

// What has been kept, and everything that can be said across it. The
// comparison is computed here rather than in the browser for the same reason
// every other figure in this app is: one implementation, in one place, that
// the tests can hold to account.
router.get(
  '/kept',
  h(async (req, res) => {
    const statements = await keptFor(req.household.id);
    const trend = statementHistory.trend(statements);

    // The two most recent periods, which is the comparison somebody opening
    // this page is asking for without having to choose anything.
    let latest = null;
    if (trend.length >= 2) {
      const before = statements.find((s) => s.id === trend[trend.length - 2].id);
      const after = statements.find((s) => s.id === trend[trend.length - 1].id);
      latest = {
        beforeId: before.id,
        afterId: after.id,
        ...statementHistory.compare(before.rows, after.rows),
      };
    }

    res.json({
      statements: statements.map(({ rows, ...rest }) => ({ ...rest, lines: rows.length })),
      trend,
      latest,
      recurring: statementHistory.recurring(statements),
    });
  })
);

// One kept statement, read back with its rows and the same analysis the report
// showed when it was scanned — worked out again from the stored rows rather
// than stored alongside them, so it can never drift from what the rows say.
router.get(
  '/kept/:id',
  h(async (req, res) => {
    const statements = await keptFor(req.household.id);
    const statement = statements.find((s) => String(s.id) === String(req.params.id));
    if (!statement) return res.status(404).json({ error: 'That statement is not kept here.' });

    const { rows, ...rest } = statement;
    return res.json({
      ...rest,
      rows,
      ...statementFindings.analyse(rows, {
        openingBalance: statement.openingBalance,
        closingBalance: statement.closingBalance,
        periodStart: statement.periodStart,
        periodEnd: statement.periodEnd,
      }),
    });
  })
);

// Two kept statements against each other, chosen by the reader.
router.get(
  '/kept/:before/against/:after',
  h(async (req, res) => {
    const statements = await keptFor(req.household.id);
    const find = (id) => statements.find((s) => String(s.id) === String(id));
    const before = find(req.params.before);
    const after = find(req.params.after);
    if (!before || !after) {
      return res.status(404).json({ error: 'One of those statements is not kept here.' });
    }
    return res.json({
      before: { id: before.id, periodStart: before.periodStart, periodEnd: before.periodEnd },
      after: { id: after.id, periodStart: after.periodStart, periodEnd: after.periodEnd },
      ...statementHistory.compare(before.rows, after.rows),
    });
  })
);

// Forgetting one. The rows go with it, by the cascade on the table.
router.delete(
  '/kept/:id',
  blockViewers,
  h(async (req, res) => {
    const { rowCount } = await db.run('DELETE FROM statements WHERE id = ? AND household_id = ?', [
      req.params.id,
      req.household.id,
    ]);
    if (!rowCount) return res.status(404).json({ error: 'That statement is not kept here.' });
    return res.status(204).end();
  })
);

module.exports = router;
