const express = require('express');
const db = require('../db/connection');

const router = express.Router();

router.get('/', (req, res) => {
  const { accountId, month } = req.query;
  if (!accountId || !month) {
    return res.status(400).json({ error: 'accountId and month query params are required' });
  }
  const entries = db
    .prepare('SELECT * FROM expense_entries WHERE account_id = ? AND month = ? ORDER BY id DESC')
    .all(accountId, month);
  res.json(entries);
});

router.post('/', (req, res) => {
  const { account_id: accountId, month, amount, description = null, entry_date: entryDate = null } = req.body;
  if (!accountId || !month || typeof amount !== 'number' || amount <= 0) {
    return res.status(400).json({ error: 'account_id, month, and a positive amount are required' });
  }
  const { lastInsertRowid } = db
    .prepare(
      'INSERT INTO expense_entries (account_id, month, amount, description, entry_date) VALUES (?, ?, ?, ?, ?)'
    )
    .run(accountId, month, amount, description, entryDate);
  const entry = db.prepare('SELECT * FROM expense_entries WHERE id = ?').get(lastInsertRowid);
  res.status(201).json(entry);
});

router.delete('/:id', (req, res) => {
  const result = db.prepare('DELETE FROM expense_entries WHERE id = ?').run(req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'entry not found' });
  }
  res.status(204).end();
});

module.exports = router;
