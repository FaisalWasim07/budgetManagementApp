const express = require('express');
const db = require('../db/pool');
const summaryService = require('../services/summaryService');
const { shiftMonth } = require('../services/summaryService');
const recurringService = require('../services/recurringService');
const { h } = require('../util/route');

const router = express.Router();
const CYCLES = ['monthly', 'yearly'];
const DIRECTIONS = ['expense', 'income'];
const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

// Every change to a recurring item happens *from* a month — usually the one the
// page is showing. It decides which months keep the old figure and which get
// the new one, so it is never inferred from the server clock when the client
// has said which month it means.
const effectiveMonth = (body) =>
  MONTH.test(String(body?.from_month)) ? body.from_month : summaryService.currentMonth();

const findInHousehold = (id, householdId) =>
  db.get(
    `SELECT s.* FROM subscriptions s
     JOIN accounts a ON a.id = s.account_id
     WHERE s.id = ? AND a.household_id = ?`,
    [id, householdId]
  );

// Includes the owning account so the page can show currency and person
// without a second round trip. When ?month= is given, each row also reports
// whether it is charged in that month.
router.get(
  '/',
  h(async (req, res) => {
    const { month, accountId } = req.query;
    // Bounded by the household before any optional filter is considered.
    const where = ['a.household_id = ?'];
    const params = [req.household.id];
    if (accountId) {
      where.push('s.account_id = ?');
      params.push(accountId);
    }

    const rows = await db.all(
      `SELECT s.*, a.name AS account_name, a.currency, a.person_id, p.name AS person_name
       FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id
       JOIN persons p ON p.id = a.person_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.is_active DESC, s.name`,
      params
    );

    res.json(
      rows.map((r) => ({
        ...r,
        dueThisMonth: month
          ? r.is_active === 1 && summaryService.subscriptionDueIn(r, month)
          : undefined,
      }))
    );
  })
);

function validate(body, { partial = false, wasEndMonth = null } = {}) {
  const {
    account_id: accountId,
    name,
    amount,
    cycle = 'monthly',
    start_month: startMonth,
    billing_month: billingMonth,
    end_month: endMonth,
  } = body;

  if (!partial && (!accountId || !name || !startMonth)) {
    return 'account_id, name, amount and start_month are required';
  }
  if (amount != null && (typeof amount !== 'number' || !(amount > 0))) {
    return 'amount must be a positive number';
  }
  if (cycle != null && !CYCLES.includes(cycle)) {
    return `cycle must be one of ${CYCLES.join(', ')}`;
  }
  if (body.direction != null && !DIRECTIONS.includes(body.direction)) {
    return `direction must be one of ${DIRECTIONS.join(', ')}`;
  }
  if (billingMonth != null && (billingMonth < 1 || billingMonth > 12)) {
    return 'billing_month must be between 1 and 12';
  }
  if (startMonth && endMonth && endMonth < startMonth) {
    return 'end_month cannot be before start_month';
  }
  // The floor is last month, not this one. An item ending last month is one
  // that no longer runs from now on — exactly what stopping does — and every
  // month it charged is left alone. Anything earlier takes charges back out
  // of months already recorded, which would restate what April cost.
  //
  // An item that already ended keeps the date it ended on: this is about
  // setting a new one, not about being unable to rename something you
  // stopped in March.
  if (endMonth && endMonth !== wasEndMonth && endMonth < shiftMonth(summaryService.currentMonth(), -1)) {
    return 'end_month cannot be before last month — earlier months are already recorded';
  }
  return null;
}

router.post(
  '/',
  h(async (req, res) => {
    const error = validate(req.body);
    if (error) return res.status(400).json({ error });

    const {
      account_id: accountId,
      name,
      amount,
      direction = 'expense',
      cycle = 'monthly',
      billing_month: billingMonth = null,
      start_month: startMonth,
      end_month: endMonth = null,
      category = null,
      notes = null,
    } = req.body;

    if (typeof amount !== 'number' || !(amount > 0)) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (
      !(await db.get('SELECT id FROM accounts WHERE id = ? AND household_id = ?', [
        accountId,
        req.household.id,
      ]))
    ) {
      return res.status(404).json({ error: 'account not found' });
    }

    const row = await db.get(
      `INSERT INTO subscriptions (account_id, name, direction, amount, cycle, billing_month, start_month, end_month, category, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [
        accountId,
        name.trim(),
        direction,
        amount,
        cycle,
        cycle === 'yearly' ? billingMonth || Number(startMonth.split('-')[1]) : null,
        startMonth,
        endMonth,
        category,
        notes,
      ]
    );

    res.status(201).json(row);
  })
);

router.patch(
  '/:id',
  h(async (req, res) => {
    const existing = await findInHousehold(req.params.id, req.household.id);
    if (!existing) return res.status(404).json({ error: 'subscription not found' });

    // Moving a subscription to another account must not move it out of the
    // household, so the destination is checked too.
    if (
      req.body.account_id != null &&
      !(await db.get('SELECT id FROM accounts WHERE id = ? AND household_id = ?', [
        req.body.account_id,
        req.household.id,
      ]))
    ) {
      return res.status(404).json({ error: 'account not found' });
    }

    const { from_month: _ignored, ...patch } = req.body;
    const error = validate({ ...existing, ...patch }, {
      partial: true,
      wasEndMonth: existing.end_month,
    });
    if (error) return res.status(400).json({ error });

    // A change to what an item costs starts a new period rather than restating
    // the months already behind it. recurringService owns that rule.
    const result = await recurringService.change(existing, patch, effectiveMonth(req.body));
    res.json({ ...result.item, split: result.split, endedId: result.endedId });
  })
);

// Stops an item from `from_month` on, keeping every month it did run. Deleting
// is the other thing entirely: that erases it from the record, for when it
// should never have been there.
router.post(
  '/:id/stop',
  h(async (req, res) => {
    const existing = await findInHousehold(req.params.id, req.household.id);
    if (!existing) return res.status(404).json({ error: 'subscription not found' });

    const result = await recurringService.stop(existing, effectiveMonth(req.body));
    if (result.removed) return res.status(204).end();
    res.json(result.item);
  })
);

router.post(
  '/:id/resume',
  h(async (req, res) => {
    const existing = await findInHousehold(req.params.id, req.household.id);
    if (!existing) return res.status(404).json({ error: 'subscription not found' });

    const result = await recurringService.resume(existing, effectiveMonth(req.body));
    res.json({ ...result.item, restarted: result.restarted });
  })
);

router.delete(
  '/:id',
  h(async (req, res) => {
    const result = await db.run(
      `DELETE FROM subscriptions WHERE id = ? AND account_id IN
         (SELECT id FROM accounts WHERE household_id = ?)`,
      [req.params.id, req.household.id]
    );
    if (result.rowCount === 0) return res.status(404).json({ error: 'subscription not found' });
    res.status(204).end();
  })
);

module.exports = router;
