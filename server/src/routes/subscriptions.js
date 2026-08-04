const express = require('express');
const db = require('../db/connection');
const summaryService = require('../services/summaryService');

const router = express.Router();
const CYCLES = ['monthly', 'yearly'];

// Includes the owning account so the page can show currency and person
// without a second round trip. When ?month= is given, each row also reports
// whether it is charged in that month.
router.get('/', (req, res) => {
  const { month, accountId } = req.query;
  const where = ['1=1'];
  const params = [];
  if (accountId) {
    where.push('s.account_id = ?');
    params.push(accountId);
  }

  const rows = db
    .prepare(
      `SELECT s.*, a.name AS account_name, a.currency, a.person_id, p.name AS person_name
       FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id
       JOIN persons p ON p.id = a.person_id
       WHERE ${where.join(' AND ')}
       ORDER BY s.is_active DESC, s.name`
    )
    .all(...params);

  res.json(
    rows.map((r) => ({
      ...r,
      dueThisMonth: month ? r.is_active === 1 && summaryService.subscriptionDueIn(r, month) : undefined,
    }))
  );
});

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
  if (billingMonth != null && (billingMonth < 1 || billingMonth > 12)) {
    return 'billing_month must be between 1 and 12';
  }
  if (startMonth && endMonth && endMonth < startMonth) {
    return 'end_month cannot be before start_month';
  }
  return null;
}

router.post('/', (req, res) => {
  const error = validate(req.body);
  if (error) return res.status(400).json({ error });

  const {
    account_id: accountId,
    name,
    amount,
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
  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)) {
    return res.status(404).json({ error: 'account not found' });
  }

  const { lastInsertRowid } = db
    .prepare(
      `INSERT INTO subscriptions (account_id, name, amount, cycle, billing_month, start_month, end_month, category, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      accountId,
      name.trim(),
      amount,
      cycle,
      cycle === 'yearly' ? billingMonth || Number(startMonth.split('-')[1]) : null,
      startMonth,
      endMonth,
      category,
      notes
    );

  res.status(201).json(db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'subscription not found' });

  const merged = { ...existing, ...req.body };
  const error = validate(merged, { partial: true });
  if (error) return res.status(400).json({ error });

  db.prepare(
    `UPDATE subscriptions
     SET account_id = ?, name = ?, amount = ?, cycle = ?, billing_month = ?,
         start_month = ?, end_month = ?, category = ?, notes = ?, is_active = ?
     WHERE id = ?`
  ).run(
    merged.account_id,
    String(merged.name).trim(),
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
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM subscriptions WHERE id = ?').get(req.params.id));
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM subscriptions WHERE id = ?').run(req.params.id);
  if (result.changes === 0) return res.status(404).json({ error: 'subscription not found' });
  res.status(204).end();
});

module.exports = router;
