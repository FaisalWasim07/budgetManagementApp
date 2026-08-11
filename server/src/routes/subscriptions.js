const express = require('express');
const db = require('../db/pool');
const summaryService = require('../services/summaryService');
const { h } = require('../util/route');

const router = express.Router();
const CYCLES = ['monthly', 'yearly'];
const DIRECTIONS = ['expense', 'income'];

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

function validate(body, { partial = false } = {}) {
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
    const existing = await db.get(
      `SELECT s.* FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.id = ? AND a.household_id = ?`,
      [req.params.id, req.household.id]
    );
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

    const merged = { ...existing, ...req.body };
    const error = validate(merged, { partial: true });
    if (error) return res.status(400).json({ error });

    const row = await db.get(
      `UPDATE subscriptions
       SET account_id = ?, name = ?, direction = ?, amount = ?, cycle = ?, billing_month = ?,
           start_month = ?, end_month = ?, category = ?, notes = ?, is_active = ?
       WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE household_id = ?)
       RETURNING *`,
      [
        merged.account_id,
        String(merged.name).trim(),
        merged.direction,
        merged.amount,
        merged.cycle,
        merged.cycle === 'yearly'
          ? merged.billing_month || Number(String(merged.start_month).split('-')[1])
          : null,
        merged.start_month,
        merged.end_month || null,
        merged.category || null,
        merged.notes || null,
        merged.is_active ? 1 : 0,
        req.params.id,
        req.household.id,
      ]
    );

    res.json(row);
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
