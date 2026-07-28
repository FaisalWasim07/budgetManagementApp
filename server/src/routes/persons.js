const express = require('express');
const db = require('../db/connection');

const router = express.Router();

router.get('/', (req, res) => {
  const persons = db.prepare('SELECT id, name, created_at FROM persons ORDER BY id').all();
  res.json(persons);
});

router.patch('/:id', (req, res) => {
  const { name } = req.body;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  const result = db.prepare('UPDATE persons SET name = ? WHERE id = ?').run(name.trim(), req.params.id);
  if (result.changes === 0) {
    return res.status(404).json({ error: 'person not found' });
  }
  const person = db.prepare('SELECT id, name, created_at FROM persons WHERE id = ?').get(req.params.id);
  res.json(person);
});

module.exports = router;
