const express = require('express');
const db = require('../db/pool');
const { h } = require('../util/route');

const router = express.Router();

router.get(
  '/',
  h(async (req, res) => {
    res.json(
      await db.all(
        'SELECT id, name, user_id, created_at FROM persons WHERE household_id = ? ORDER BY id',
        [req.household.id]
      )
    );
  })
);

// Says which person a login is. You may always set your own; an owner may set
// anyone's, which is how a household gets sorted out without talking the other
// person through a settings screen.
//
// Nothing about the money moves — this only decides whose card leads a
// dashboard and which account an entry form starts on.
router.put(
  '/:id/user',
  h(async (req, res) => {
    const target = req.body.user_id == null ? null : Number(req.body.user_id);
    const personId = Number(req.params.id);
    const isOwner = req.household.role === 'owner';

    if (!Number.isInteger(personId) || (target !== null && !Number.isInteger(target))) {
      return res.status(400).json({ error: 'That is not a valid id.' });
    }

    if (target !== null && target !== req.user.id && !isOwner) {
      return res.status(403).json({ error: 'Only an owner can do that for someone else.' });
    }

    const person = await db.get(
      'SELECT id, user_id FROM persons WHERE id = ? AND household_id = ?',
      [personId, req.household.id]
    );
    if (!person) return res.status(404).json({ error: 'No such person.' });

    // Saying which person you are must not quietly stop someone else being
    // theirs. Taking a person who already belongs to another login, or letting
    // go of one that isn't yours, is an owner's job.
    if (!isOwner) {
      const holder = person.user_id;
      if (holder != null && holder !== req.user.id) {
        return res.status(409).json({ error: 'Someone else is already that person.' });
      }
      if (target === null && holder !== req.user.id) {
        return res.status(403).json({ error: 'Only an owner can do that for someone else.' });
      }
    }

    if (target !== null) {
      const member = await db.get(
        'SELECT 1 FROM household_members WHERE household_id = ? AND user_id = ?',
        [req.household.id, target]
      );
      if (!member) return res.status(404).json({ error: 'That login is not in this household.' });
    }

    // One login is one person here, so claiming it takes it off whoever held
    // it — otherwise the unique index rejects the whole thing and the person
    // doing the tidying gets an error instead of the result they asked for.
    await db.tx(async (t) => {
      if (target !== null) {
        await t.run(
          'UPDATE persons SET user_id = NULL WHERE household_id = ? AND user_id = ? AND id <> ?',
          [req.household.id, target, person.id]
        );
      }
      await t.run('UPDATE persons SET user_id = ? WHERE id = ?', [target, person.id]);
    });

    res.json(await db.get('SELECT id, name, user_id FROM persons WHERE id = ?', [person.id]));
  })
);

// Adding a person optionally gives them a first account, because a person with
// no account can't hold any money and is a dead end on the dashboard.
router.post(
  '/',
  h(async (req, res) => {
    const { name, with_account: withAccount = true, currency = 'AED' } = req.body;
    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'name is required' });
    }

    const person = await db.tx(async (t) => {
      const created = await t.get(
        'INSERT INTO persons (household_id, name) VALUES (?, ?) RETURNING *',
        [req.household.id, name.trim()]
      );

      if (withAccount) {
        const { next } = await t.get(
          'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM accounts WHERE household_id = ?',
          [req.household.id]
        );
        await t.run(
          `INSERT INTO accounts (household_id, person_id, name, currency, type, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [
            req.household.id,
            created.id,
            'Main Account',
            String(currency).trim().toUpperCase(),
            'current',
            next,
          ]
        );
      }
      return created;
    });

    res.status(201).json(person);
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
      `UPDATE persons SET name = ? WHERE id = ? AND household_id = ?
       RETURNING id, name, created_at`,
      [name.trim(), req.params.id, req.household.id]
    );
    if (!person) return res.status(404).json({ error: 'person not found' });
    res.json(person);
  })
);

// A person with any accounts is left alone — removing them would orphan money.
router.delete(
  '/:id',
  h(async (req, res) => {
    const person = await db.get('SELECT * FROM persons WHERE id = ? AND household_id = ?', [
      req.params.id,
      req.household.id,
    ]);
    if (!person) return res.status(404).json({ error: 'person not found' });

    const { count } = await db.get('SELECT COUNT(*) AS count FROM accounts WHERE person_id = ?', [
      req.params.id,
    ]);
    if (count > 0) {
      return res.status(400).json({
        error: `${person.name} still has ${count} account(s). Remove those first.`,
      });
    }

    await db.run('DELETE FROM persons WHERE id = ? AND household_id = ?', [
      req.params.id,
      req.household.id,
    ]);
    res.status(204).end();
  })
);

module.exports = router;
