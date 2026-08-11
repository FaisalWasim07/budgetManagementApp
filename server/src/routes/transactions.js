const crypto = require('crypto');
const express = require('express');
const db = require('../db/pool');
const summaryService = require('../services/summaryService');
const { h } = require('../util/route');

const router = express.Router();
const ENTRY_KINDS = ['income', 'expense'];

router.get(
  '/',
  h(async (req, res) => {
    const { accountId, month, personId } = req.query;
    // The household filter is not optional and is applied first, so no
    // combination of query parameters can widen the result past it.
    const where = ['a.household_id = ?'];
    const params = [req.household.id];

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

    const sql = `SELECT t.*, a.name AS account_name, a.currency, a.person_id,
                        u.username AS created_by_username
                 FROM transactions t
                 JOIN accounts a ON a.id = t.account_id
                 LEFT JOIN users u ON u.id = t.created_by
                 WHERE ${where.join(' AND ')}
                 ORDER BY t.id DESC`;
    res.json(await db.all(sql, params));
  })
);

// Single-account entries only. Transfers go through POST /transfer so both
// legs are always written together.
router.post(
  '/',
  h(async (req, res) => {
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
    if (
      !(await db.get('SELECT id FROM accounts WHERE id = ? AND household_id = ?', [
        accountId,
        req.household.id,
      ]))
    ) {
      return res.status(404).json({ error: 'account not found' });
    }

    const row = await db.get(
      `INSERT INTO transactions (account_id, month, kind, amount, category, description, entry_date, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [accountId, month, kind, amount, category, description, entryDate, req.user.id]
    );

    res.status(201).json(row);
  })
);

// A transfer is two linked rows. Cross-currency transfers take a separate
// to_amount, since the receiving account is denominated differently.
router.post(
  '/transfer',
  h(async (req, res) => {
    const {
      from_account_id: fromId,
      to_account_id: toId,
      month,
      amount,
      to_amount: toAmountRaw,
      description = null,
    } = req.body;

    if (!fromId || !toId || !month) {
      return res
        .status(400)
        .json({ error: 'from_account_id, to_account_id and month are required' });
    }
    if (Number(fromId) === Number(toId)) {
      return res.status(400).json({ error: 'cannot transfer to the same account' });
    }
    if (typeof amount !== 'number' || !(amount > 0)) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }

    const [from, to] = await Promise.all([
      db.get('SELECT * FROM accounts WHERE id = ? AND household_id = ?', [fromId, req.household.id]),
      db.get('SELECT * FROM accounts WHERE id = ? AND household_id = ?', [toId, req.household.id]),
    ]);
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

    // You can only move money you actually have. A credit card is exempt: going
    // negative there is borrowing, which is what a card is for.
    if (from.type !== 'credit') {
      const available = await summaryService.accountBalance(from, month);
      if (amount > available) {
        return res.status(400).json({
          error: `${from.name} only has ${available.toFixed(2)} ${from.currency} available in this month.`,
          available,
          currency: from.currency,
        });
      }
    }

    const transferId = crypto.randomUUID();
    const rows = await db.tx(async (t) => {
      const insert = (accountId, kind, value) =>
        t.get(
          `INSERT INTO transactions (account_id, month, kind, amount, description, transfer_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
          [accountId, month, kind, value, description, transferId, req.user.id]
        );
      return [
        await insert(fromId, 'transfer_out', amount),
        await insert(toId, 'transfer_in', toAmount),
      ];
    });

    res.status(201).json(rows);
  })
);

// Editing an entry. A transfer is edited as one thing — both legs move
// together, with their own amounts so a cross-currency pair stays truthful —
// because updating one side alone would leave the books not balancing.
//
// What can't change: an ordinary entry cannot become a transfer, or the other
// way round. That is a delete and a re-entry, and pretending otherwise is how
// you end up with a half-formed transfer pointing at nothing.
router.patch(
  '/:id',
  h(async (req, res) => {
    const existing = await db.get(
      `SELECT t.* FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ? AND a.household_id = ?`,
      [req.params.id, req.household.id]
    );
    if (!existing) return res.status(404).json({ error: 'transaction not found' });

    const {
      amount,
      to_amount: toAmount,
      month,
      kind,
      category,
      description,
      entry_date: entryDate,
    } = req.body;

    if (amount != null && (typeof amount !== 'number' || !(amount > 0))) {
      return res.status(400).json({ error: 'amount must be a positive number' });
    }
    if (kind != null && !ENTRY_KINDS.includes(kind)) {
      return res.status(400).json({ error: `kind must be ${ENTRY_KINDS.join(' or ')}` });
    }
    if (kind != null && existing.transfer_id) {
      return res.status(400).json({
        error: 'A transfer cannot become an income or expense entry. Delete it and add a new one.',
      });
    }

    const nextMonth = month ?? existing.month;

    // --- a transfer: both legs, one transaction --------------------------
    if (existing.transfer_id) {
      const legs = await db.all(
        `SELECT t.*, a.type AS account_type, a.name AS account_name, a.currency, a.opening_balance,
                a.household_id
         FROM transactions t JOIN accounts a ON a.id = t.account_id
         WHERE t.transfer_id = ? AND a.household_id = ?`,
        [existing.transfer_id, req.household.id]
      );
      const out = legs.find((l) => l.kind === 'transfer_out');
      const into = legs.find((l) => l.kind === 'transfer_in');
      if (!out || !into) {
        return res.status(409).json({ error: 'This transfer is missing one of its two sides.' });
      }
      if (toAmount != null && (typeof toAmount !== 'number' || !(toAmount > 0))) {
        return res.status(400).json({ error: 'to_amount must be a positive number' });
      }

      const nextOut = amount ?? out.amount;
      const nextIn = toAmount ?? (amount != null && out.amount === into.amount ? amount : into.amount);

      // Raising the amount can overdraw the source just as creating it could,
      // so the same guard applies. The existing leg is excluded from the
      // balance first, or the money would be counted against itself.
      if (out.account_type !== 'credit') {
        const source = { id: out.account_id, opening_balance: out.opening_balance, household_id: req.household.id };
        const available = (await summaryService.accountBalance(source, nextMonth)) + out.amount;
        if (nextOut > available) {
          return res.status(400).json({
            error: `${out.account_name} only has ${available.toFixed(2)} ${out.currency} available in this month.`,
            available,
            currency: out.currency,
          });
        }
      }

      const updated = await db.tx(async (t) => {
        const write = (leg, value) =>
          t.get(
            `UPDATE transactions SET amount = ?, month = ?, description = ?, entry_date = ?
             WHERE id = ? RETURNING *`,
            [
              value,
              nextMonth,
              description !== undefined ? description : leg.description,
              entryDate !== undefined ? entryDate : leg.entry_date,
              leg.id,
            ]
          );
        return [await write(out, nextOut), await write(into, nextIn)];
      });

      return res.json(updated);
    }

    // --- an ordinary entry -----------------------------------------------
    const row = await db.get(
      `UPDATE transactions
       SET amount = ?, month = ?, kind = ?, category = ?, description = ?, entry_date = ?
       WHERE id = ? AND account_id IN (SELECT id FROM accounts WHERE household_id = ?)
       RETURNING *`,
      [
        amount ?? existing.amount,
        nextMonth,
        kind ?? existing.kind,
        category !== undefined ? category : existing.category,
        description !== undefined ? description : existing.description,
        entryDate !== undefined ? entryDate : existing.entry_date,
        req.params.id,
        req.household.id,
      ]
    );

    res.json(row);
  })
);

// Deleting either leg of a transfer removes both, so the books stay balanced.
router.delete(
  '/:id',
  h(async (req, res) => {
    const tx = await db.get(
      `SELECT t.* FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.id = ? AND a.household_id = ?`,
      [req.params.id, req.household.id]
    );
    if (!tx) return res.status(404).json({ error: 'transaction not found' });

    // Both legs of a transfer are in the same household by construction, but
    // the delete is still bounded by it rather than trusting that.
    if (tx.transfer_id) {
      await db.run(
        `DELETE FROM transactions WHERE transfer_id = ? AND account_id IN
           (SELECT id FROM accounts WHERE household_id = ?)`,
        [tx.transfer_id, req.household.id]
      );
    } else {
      await db.run(
        `DELETE FROM transactions WHERE id = ? AND account_id IN
           (SELECT id FROM accounts WHERE household_id = ?)`,
        [req.params.id, req.household.id]
      );
    }
    res.status(204).end();
  })
);

module.exports = router;
