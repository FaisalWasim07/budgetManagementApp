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
    if (!(await db.get('SELECT id FROM accounts WHERE id = ?', [accountId]))) {
      return res.status(404).json({ error: 'account not found' });
    }

    const row = await db.get(
      `INSERT INTO transactions (account_id, month, kind, amount, category, description, entry_date)
       VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      [accountId, month, kind, amount, category, description, entryDate]
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
      db.get('SELECT * FROM accounts WHERE id = ?', [fromId]),
      db.get('SELECT * FROM accounts WHERE id = ?', [toId]),
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
          `INSERT INTO transactions (account_id, month, kind, amount, description, transfer_id)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
          [accountId, month, kind, value, description, transferId]
        );
      return [
        await insert(fromId, 'transfer_out', amount),
        await insert(toId, 'transfer_in', toAmount),
      ];
    });

    res.status(201).json(rows);
  })
);

// Deleting either leg of a transfer removes both, so the books stay balanced.
router.delete(
  '/:id',
  h(async (req, res) => {
    const tx = await db.get('SELECT * FROM transactions WHERE id = ?', [req.params.id]);
    if (!tx) return res.status(404).json({ error: 'transaction not found' });

    if (tx.transfer_id) {
      await db.run('DELETE FROM transactions WHERE transfer_id = ?', [tx.transfer_id]);
    } else {
      await db.run('DELETE FROM transactions WHERE id = ?', [req.params.id]);
    }
    res.status(204).end();
  })
);

module.exports = router;
