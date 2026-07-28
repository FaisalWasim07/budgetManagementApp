const express = require('express');
const db = require('../db/connection');

const router = express.Router();

router.get('/', (req, res) => {
  const { month } = req.query;
  if (!month) {
    return res.status(400).json({ error: 'month query param is required' });
  }
  const entries = db
    .prepare('SELECT * FROM monthly_entries WHERE month = ? ORDER BY person_id')
    .all(month);
  res.json(entries);
});

router.put('/', (req, res) => {
  const {
    person_id: personId,
    month,
    salary_amount: salaryAmount = 0,
    transfer_to_savings: transferToSavings = 0,
    transfer_to_expense: transferToExpense = 0,
    notes = null,
  } = req.body;

  if (!personId || !month) {
    return res.status(400).json({ error: 'person_id and month are required' });
  }
  if ([salaryAmount, transferToSavings, transferToExpense].some((n) => typeof n !== 'number' || n < 0)) {
    return res.status(400).json({ error: 'amounts must be non-negative numbers' });
  }
  if (transferToSavings + transferToExpense > salaryAmount) {
    return res.status(400).json({ error: 'transfers cannot exceed salary amount' });
  }

  db.prepare(
    `INSERT INTO monthly_entries (person_id, month, salary_amount, transfer_to_savings, transfer_to_expense, notes, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(person_id, month)
     DO UPDATE SET salary_amount = excluded.salary_amount,
                   transfer_to_savings = excluded.transfer_to_savings,
                   transfer_to_expense = excluded.transfer_to_expense,
                   notes = excluded.notes,
                   updated_at = datetime('now')`
  ).run(personId, month, salaryAmount, transferToSavings, transferToExpense, notes);

  const entry = db
    .prepare('SELECT * FROM monthly_entries WHERE person_id = ? AND month = ?')
    .get(personId, month);
  res.json(entry);
});

module.exports = router;
