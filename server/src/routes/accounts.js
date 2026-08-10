const express = require('express');
const db = require('../db/pool');
const { h } = require('../util/route');

const router = express.Router();
const VALID_TYPES = ['current', 'savings', 'credit'];

router.get(
  '/',
  h(async (req, res) => {
    const { personId } = req.query;
    const accounts = personId
      ? await db.all('SELECT * FROM accounts WHERE person_id = ? ORDER BY sort_order, id', [
          personId,
        ])
      : await db.all('SELECT * FROM accounts ORDER BY person_id, sort_order, id');
    res.json(accounts);
  })
);

router.post(
  '/',
  h(async (req, res) => {
    const {
      person_id: personId,
      name,
      currency,
      type = 'current',
      opening_balance: openingBalance = 0,
    } = req.body;

    if (!personId || !name || !currency) {
      return res.status(400).json({ error: 'person_id, name and currency are required' });
    }
    if (!VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }
    if (typeof openingBalance !== 'number' || Number.isNaN(openingBalance)) {
      return res.status(400).json({ error: 'opening_balance must be a number' });
    }
    if (!(await db.get('SELECT id FROM persons WHERE id = ?', [personId]))) {
      return res.status(404).json({ error: 'person not found' });
    }

    const { next } = await db.get(
      'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM accounts WHERE person_id = ?',
      [personId]
    );

    const account = await db.get(
      `INSERT INTO accounts (person_id, name, currency, type, opening_balance, sort_order)
       VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
      [personId, name.trim(), currency.trim().toUpperCase(), type, openingBalance, next]
    );

    res.status(201).json(account);
  })
);

router.patch(
  '/:id',
  h(async (req, res) => {
    const existing = await db.get('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
    if (!existing) return res.status(404).json({ error: 'account not found' });

    const { name, currency, type, opening_balance: openingBalance, is_active: isActive } = req.body;
    if (type != null && !VALID_TYPES.includes(type)) {
      return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
    }

    const account = await db.get(
      `UPDATE accounts SET name = ?, currency = ?, type = ?, opening_balance = ?, is_active = ?
       WHERE id = ? RETURNING *`,
      [
        name != null ? name.trim() : existing.name,
        currency != null ? currency.trim().toUpperCase() : existing.currency,
        type != null ? type : existing.type,
        typeof openingBalance === 'number' ? openingBalance : existing.opening_balance,
        isActive != null ? (isActive ? 1 : 0) : existing.is_active,
        req.params.id,
      ]
    );

    res.json(account);
  })
);

// Deleting an account would orphan its ledger rows, so an account that has any
// history is deactivated instead and simply stops appearing.
router.delete(
  '/:id',
  h(async (req, res) => {
    const account = await db.get('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
    if (!account) return res.status(404).json({ error: 'account not found' });

    const [tx, sub] = await Promise.all([
      db.get('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?', [req.params.id]),
      db.get('SELECT COUNT(*) AS count FROM subscriptions WHERE account_id = ?', [req.params.id]),
    ]);

    if (tx.count > 0 || sub.count > 0) {
      await db.run('UPDATE accounts SET is_active = 0 WHERE id = ?', [req.params.id]);
      return res.json({
        deleted: false,
        deactivated: true,
        transactions: tx.count,
        subscriptions: sub.count,
      });
    }

    await db.run('DELETE FROM accounts WHERE id = ?', [req.params.id]);
    res.json({ deleted: true, deactivated: false });
  })
);

module.exports = router;
