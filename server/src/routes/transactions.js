const crypto = require('crypto');
const express = require('express');
const db = require('../db/connection');

const router = express.Router();
const ENTRY_KINDS = ['income', 'expense'];

router.get('/', (req, res) => {
  const { accountId, month, personId } = req.query;
  const where = [];
  const params = [];

  if (accountId) {
    where.push('t.account_id = ?');
    params.push(accountId);
  }
  if (month) {
    where.push('t.month = ?');
    params.push(month);
  }
  if (personId) {
    where.push('a.person_id = ?');
    params.push(personId);
  }

  const sql = `SELECT t.*, a.name AS account_name, a.currency, a.person_id
               FROM transactions t JOIN accounts a ON a.id = t.account_id
               ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
               ORDER BY t.id DESC`;
  res.json(db.prepare(sql).all(...params));
});

// Single-account entries only. Transfers go through POST /transfer so both
// legs are always written together.
router.post('/', (req, res) => {
  const {
    account_id: accountId,
    month,
    kind,
    amount,
    category = null,
    description = null,
    entry_date: entryDate = null,
  } = req.body;

  if (!accountId || !month || !ENTRY_KINDS.includes(kind)) {
    return res
      .status(400)
      .json({ error: `account_id, month and kind (${ENTRY_KINDS.join(' or ')}) are required` });
  }
  if (typeof amount !== 'number' || !(amount > 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }
  if (!db.prepare('SELECT id FROM accounts WHERE id = ?').get(accountId)) {
    return res.status(404).json({ error: 'account not found' });
  }

  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO transactions (account_id, month, kind, amount, category, description, entry_date) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(accountId, month, kind, amount, category, description, entryDate);

  res.status(201).json(db.prepare('SELECT * FROM transactions WHERE id = ?').get(lastInsertRowid));
});

// A transfer is two linked rows. Cross-currency transfers take a separate
// to_amount, since the receiving account is denominated differently.
router.post('/transfer', (req, res) => {
  const {
    from_account_id: fromId,
    to_account_id: toId,
    month,
    amount,
    to_amount: toAmountRaw,
    description = null,
  } = req.body;

  if (!fromId || !toId || !month) {
    return res.status(400).json({ error: 'from_account_id, to_account_id and month are required' });
  }
  if (Number(fromId) === Number(toId)) {
    return res.status(400).json({ error: 'cannot transfer to the same account' });
  }
  if (typeof amount !== 'number' || !(amount > 0)) {
    return res.status(400).json({ error: 'amount must be a positive number' });
  }

  const from = db.prepare('SELECT * FROM accounts WHERE id = ?').get(fromId);
  const to = db.prepare('SELECT * FROM accounts WHERE id = ?').get(toId);
  if (!from || !to) return res.status(404).json({ error: 'account not found' });

  const toAmount = typeof toAmountRaw === 'number' ? toAmountRaw : amount;
  if (from.currency !== to.currency && typeof toAmountRaw !== 'number') {
    return res.status(400).json({
      error: `accounts use different currencies (${from.currency} -> ${to.currency}); send to_amount for the receiving side`,
    });
  }
  if (!(toAmount > 0)) {
    return res.status(400).json({ error: 'to_amount must be a positive number' });
  }

  const transferId = crypto.randomUUID();
  const insert = db.prepare(
    'INSERT INTO transactions (account_id, month, kind, amount, description, transfer_id) VALUES (?, ?, ?, ?, ?, ?)'
  );

  db.exec('BEGIN');
  try {
    insert.run(fromId, month, 'transfer_out', amount, description, transferId);
    insert.run(toId, month, 'transfer_in', toAmount, description, transferId);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  res
    .status(201)
    .json(db.prepare('SELECT * FROM transactions WHERE transfer_id = ?').all(transferId));
});

// Deleting either leg of a transfer removes both, so the books stay balanced.
router.delete('/:id', (req, res) => {
  const tx = db.prepare('SELECT * FROM transactions WHERE id = ?').get(req.params.id);
  if (!tx) return res.status(404).json({ error: 'transaction not found' });

  if (tx.transfer_id) {
    db.prepare('DELETE FROM transactions WHERE transfer_id = ?').run(tx.transfer_id);
  } else {
    db.prepare('DELETE FROM transactions WHERE id = ?').run(req.params.id);
  }
  res.status(204).end();
});

module.exports = router;
