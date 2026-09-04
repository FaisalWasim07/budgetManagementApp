const express = require('express');
const db = require('../db/pool');
const statementService = require('../services/statementService');
const statementFindings = require('../services/statementFindings');
const { h } = require('../util/route');

const router = express.Router();

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

module.exports = router;
