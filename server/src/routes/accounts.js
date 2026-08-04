const express = require('express');
const db = require('../db/connection');

const router = express.Router();
const VALID_TYPES = ['current', 'savings', 'credit'];

router.get('/', (req, res) => {
  const { personId } = req.query;
  const accounts = personId
    ? db
        .prepare('SELECT * FROM accounts WHERE person_id = ? ORDER BY sort_order, id')
        .all(personId)
    : db.prepare('SELECT * FROM accounts ORDER BY person_id, sort_order, id').all();
  res.json(accounts);
});

router.post('/', (req, res) => {
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
  if (!db.prepare('SELECT id FROM persons WHERE id = ?').get(personId)) {
    return res.status(404).json({ error: 'person not found' });
  }

  const nextOrder =
    db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM accounts WHERE person_id = ?').get(
      personId
    ).next;

  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO accounts (person_id, name, currency, type, opening_balance, sort_order) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(personId, name.trim(), currency.trim().toUpperCase(), type, openingBalance, nextOrder);

  res.status(201).json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(lastInsertRowid));
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'account not found' });

  const { name, currency, type, opening_balance: openingBalance, is_active: isActive } = req.body;
  if (type != null && !VALID_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${VALID_TYPES.join(', ')}` });
  }

  db.prepare(
    'UPDATE accounts SET name = ?, currency = ?, type = ?, opening_balance = ?, is_active = ? WHERE id = ?'
  ).run(
    name != null ? name.trim() : existing.name,
    currency != null ? currency.trim().toUpperCase() : existing.currency,
    type != null ? type : existing.type,
    typeof openingBalance === 'number' ? openingBalance : existing.opening_balance,
    isActive != null ? (isActive ? 1 : 0) : existing.is_active,
    req.params.id
  );

  res.json(db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id));
});

// Deleting an account would orphan its ledger rows, so an account that has any
// history is deactivated instead and simply stops appearing.
router.delete('/:id', (req, res) => {
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!account) return res.status(404).json({ error: 'account not found' });

  const txCount = db
    .prepare('SELECT COUNT(*) AS count FROM transactions WHERE account_id = ?')
    .get(req.params.id).count;
  const subCount = db
    .prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE account_id = ?')
    .get(req.params.id).count;

  if (txCount > 0 || subCount > 0) {
    db.prepare('UPDATE accounts SET is_active = 0 WHERE id = ?').run(req.params.id);
    return res.json({ deleted: false, deactivated: true, transactions: txCount, subscriptions: subCount });
  }

  db.prepare('DELETE FROM accounts WHERE id = ?').run(req.params.id);
  res.json({ deleted: true, deactivated: false });
});

module.exports = router;
