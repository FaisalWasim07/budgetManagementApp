const express = require('express');
const db = require('../db/pool');
const statementService = require('../services/statementService');
const statementFindings = require('../services/statementFindings');
const { h } = require('../util/route');

const router = express.Router();

// A statement can be long, and a very long one costs real money to read. This
// is a ceiling on a mistake — a book pasted into the box — rather than on any
// statement anybody actually holds.
const MAX_TEXT = 400_000;

// What this household already budgets for every month. Read so the scanner can
// say which charges it already knows about and which it does not — the one
// thing here that needs the ledger, and it only ever reads it.
async function subscriptionsFor(householdId) {
  return db.all(
    `SELECT s.name, s.amount, s.direction, s.cycle
       FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id
      WHERE a.household_id = ? AND s.is_active = 1`,
    [householdId]
  );
}

// The categories this household already uses, so the model names things the
// same way the rest of the app does rather than inventing a private vocabulary
// per statement. Read-only, like everything this feature does to the ledger.
async function categoriesFor(householdId) {
  const rows = await db.all(
    `SELECT DISTINCT t.category
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
      WHERE a.household_id = ? AND t.category IS NOT NULL AND t.category <> ''
      ORDER BY t.category`,
    [householdId]
  );
  return rows.map((r) => r.category);
}

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
      const { rows, statement, usage } = await statementService.scan({
        text,
        categories: await categoriesFor(req.household.id),
        currency,
      });

      // Every figure below this line is worked out from the rows, in code. The
      // model counted nothing and totalled nothing — including the check that
      // says whether its reading of the statement adds up to the bank's own
      // closing balance.
      const analysis = statementFindings.analyse(
        rows,
        await subscriptionsFor(req.household.id),
        statement
      );

      res.json({ rows, statement, ...analysis, usage });
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

module.exports = router;
