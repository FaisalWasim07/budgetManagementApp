const express = require('express');
const db = require('../db/connection');

const router = express.Router();
const VALID_TYPES = ['primary', 'savings', 'expense', 'multi_currency'];

router.get('/', (req, res) => {
  const { personId } = req.query;
  const accounts = personId
    ? db.prepare('SELECT * FROM accounts WHERE person_id = ? ORDER BY id').all(personId)
    : db.prepare('SELECT * FROM accounts ORDER BY person_id, id').all();
  res.json(accounts);
});

router.post('/', (req, res) => {
  const { person_id: personId, type, name, currency } = req.body;
  if (!personId || !VALID_TYPES.includes(type) || !name || !currency) {
    return res.status(400).json({ error: 'person_id, type, name, and currency are required' });
  }
  const person = db.prepare('SELECT id FROM persons WHERE id = ?').get(personId);
  if (!person) {
    return res.status(404).json({ error: 'person not found' });
  }
  const { lastInsertRowid } = db
    .prepare('INSERT INTO accounts (person_id, type, name, currency) VALUES (?, ?, ?, ?)')
    .run(personId, type, name, currency.toUpperCase());
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(lastInsertRowid);
  res.status(201).json(account);
});

router.patch('/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  if (!existing) {
    return res.status(404).json({ error: 'account not found' });
  }
  const name = req.body.name != null ? req.body.name : existing.name;
  const isActive = req.body.is_active != null ? (req.body.is_active ? 1 : 0) : existing.is_active;
  db.prepare('UPDATE accounts SET name = ?, is_active = ? WHERE id = ?').run(name, isActive, req.params.id);
  const account = db.prepare('SELECT * FROM accounts WHERE id = ?').get(req.params.id);
  res.json(account);
});

module.exports = router;
