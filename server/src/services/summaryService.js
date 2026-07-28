const db = require('../db/connection');
const exchangeRateService = require('./exchangeRateService');

const PRIMARY_CURRENCY = 'AED';

function primaryBalance(personId, month) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(salary_amount - transfer_to_savings - transfer_to_expense), 0) AS total
       FROM monthly_entries WHERE person_id = ? AND month <= ?`
    )
    .get(personId, month);
  return row.total;
}

function savingsBalance(personId, month) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(transfer_to_savings), 0) AS total
       FROM monthly_entries WHERE person_id = ? AND month <= ?`
    )
    .get(personId, month);
  return row.total;
}

function expenseAccountBalance(accountId, personId, month) {
  const transfersIn = db
    .prepare(
      `SELECT COALESCE(SUM(transfer_to_expense), 0) AS total
       FROM monthly_entries WHERE person_id = ? AND month <= ?`
    )
    .get(personId, month).total;
  const spent = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM expense_entries WHERE account_id = ? AND month <= ?`
    )
    .get(accountId, month).total;
  return transfersIn - spent;
}

function contributionBalance(accountId, month) {
  const row = db
    .prepare(
      `SELECT COALESCE(SUM(amount), 0) AS total
       FROM multi_currency_contributions WHERE account_id = ? AND month <= ?`
    )
    .get(accountId, month);
  return row.total;
}

function nativeBalanceForAccount(account, month) {
  switch (account.type) {
    case 'primary':
      return primaryBalance(account.person_id, month);
    case 'savings':
      return savingsBalance(account.person_id, month);
    case 'expense':
      return expenseAccountBalance(account.id, account.person_id, month);
    case 'multi_currency':
      return contributionBalance(account.id, month);
    default:
      return 0;
  }
}

async function buildAccountSummary(account, month) {
  const balance = nativeBalanceForAccount(account, month);

  let balanceAED = balance;
  let rateInfo = { rate: 1, fetchedAt: null, stale: false };
  if (account.currency !== PRIMARY_CURRENCY) {
    rateInfo = await exchangeRateService.getRate(account.currency, PRIMARY_CURRENCY);
    balanceAED = rateInfo.rate != null ? balance * rateInfo.rate : null;
  }

  return {
    id: account.id,
    personId: account.person_id,
    type: account.type,
    name: account.name,
    currency: account.currency,
    balance,
    balanceAED,
    rate: rateInfo,
  };
}

async function getSummary(month) {
  const persons = db.prepare('SELECT id, name FROM persons ORDER BY id').all();

  let totalIncome = 0;
  let totalExpenses = 0;
  let netWorthAED = 0;
  let aedComposition = 0;
  let foreignComposition = 0;

  const personSummaries = [];

  for (const person of persons) {
    const accounts = db
      .prepare('SELECT * FROM accounts WHERE person_id = ? AND is_active = 1 ORDER BY id')
      .all(person.id);

    const accountSummaries = [];
    for (const account of accounts) {
      const summary = await buildAccountSummary(account, month);
      accountSummaries.push(summary);
      if (summary.balanceAED != null) {
        netWorthAED += summary.balanceAED;
        if (account.currency === PRIMARY_CURRENCY) {
          aedComposition += summary.balanceAED;
        } else {
          foreignComposition += summary.balanceAED;
        }
      }
    }

    const monthlyEntry = db
      .prepare(
        'SELECT salary_amount, transfer_to_savings, transfer_to_expense, notes FROM monthly_entries WHERE person_id = ? AND month = ?'
      )
      .get(person.id, month) || { salary_amount: 0, transfer_to_savings: 0, transfer_to_expense: 0, notes: null };

    const expenseAccountIds = accounts.filter((a) => a.type === 'expense').map((a) => a.id);
    let expenses = 0;
    if (expenseAccountIds.length) {
      const placeholders = expenseAccountIds.map(() => '?').join(',');
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(amount), 0) AS total FROM expense_entries WHERE month = ? AND account_id IN (${placeholders})`
        )
        .get(month, ...expenseAccountIds);
      expenses = row.total;
    }

    totalIncome += monthlyEntry.salary_amount;
    totalExpenses += expenses;

    personSummaries.push({
      id: person.id,
      name: person.name,
      accounts: accountSummaries,
      monthlyEntry,
      income: monthlyEntry.salary_amount,
      expenses,
    });
  }

  return {
    month,
    persons: personSummaries,
    household: {
      totalIncome,
      totalExpenses,
      netWorthAED,
      currencyComposition: {
        AED: aedComposition,
        foreignAED: foreignComposition,
      },
    },
  };
}

function currentMonthString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month, delta) {
  const [year, mon] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, mon - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(endMonth, count) {
  const months = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    months.push(shiftMonth(endMonth, -i));
  }
  return months;
}

async function getTrend(count = 12, endMonth) {
  const end = endMonth || currentMonthString();
  const months = monthRange(end, count);

  const trend = [];
  for (const month of months) {
    const incomeRow = db
      .prepare('SELECT COALESCE(SUM(salary_amount), 0) AS total FROM monthly_entries WHERE month = ?')
      .get(month);
    const expenseRow = db
      .prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM expense_entries WHERE month = ?')
      .get(month);
    const summary = await getSummary(month);
    trend.push({
      month,
      income: incomeRow.total,
      expenses: expenseRow.total,
      netWorthAED: summary.household.netWorthAED,
    });
  }
  return trend;
}

module.exports = { getSummary, getTrend, PRIMARY_CURRENCY, currentMonthString, shiftMonth };
