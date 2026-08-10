const express = require('express');
const db = require('../db/pool');
const { h } = require('../util/route');

const router = express.Router();

router.get(
  '/',
  h(async (req, res) => {
    res.json(await db.all('SELECT id, name, created_at FROM persons ORDER BY id'));
  })
);

router.patch(
  '/:id',
  h(async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }
    const person = await db.get(
      'UPDATE persons SET name = ? WHERE id = ? RETURNING id, name, created_at',
      [name.trim(), req.params.id]
    );
    if (!person) return res.status(404).json({ error: 'person not found' });
    res.json(person);
  })
);

module.exports = router;
