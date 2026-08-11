const db = require('../db/pool');
const exchangeRateService = require('./exchangeRateService');
const settingsService = require('./settingsService');

// --- month helpers -------------------------------------------------------
// 'YYYY-MM' is turned into a single integer so range maths stays trivial.

function monthIndex(month) {
  const [y, m] = month.split('-').map(Number);
  return y * 12 + (m - 1);
}

function monthFromIndex(index) {
  const y = Math.floor(index / 12);
  const m = (index % 12) + 1;
  return `${y}-${String(m).padStart(2, '0')}`;
}

function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function shiftMonth(month, delta) {
  return monthFromIndex(monthIndex(month) + delta);
}

// --- subscriptions -------------------------------------------------------
// Subscriptions are applied on the fly rather than written into the ledger,
// so editing or ending one corrects every month at once.

function billingMonthOf(sub) {
  return sub.billing_month || Number(sub.start_month.split('-')[1]);
}

function subscriptionDueIn(sub, month) {
  const i = monthIndex(month);
  if (i < monthIndex(sub.start_month)) return false;
  if (sub.end_month && i > monthIndex(sub.end_month)) return false;
  if (sub.cycle === 'yearly') return (i % 12) + 1 === billingMonthOf(sub);
  return true;
}

// How many times the subscription has been charged from its start through `month`.
function subscriptionChargesThrough(sub, month) {
  const start = monthIndex(sub.start_month);
  let end = monthIndex(month);
  if (sub.end_month) end = Math.min(end, monthIndex(sub.end_month));
  if (end < start) return 0;

  if (sub.cycle !== 'yearly') return end - start + 1;

  const billing = billingMonthOf(sub);
  let count = 0;
  for (let i = start; i <= end; i += 1) {
    if ((i % 12) + 1 === billing) count += 1;
  }
  return count;
}

// Recurring items sum in two directions. Kept as one helper so a balance and a
// month's activity can never disagree about which way a given item points.
function recurringTotals(items, month, { cumulative }) {
  let out = 0;
  let inn = 0;
  for (const item of items) {
    const times = cumulative
      ? subscriptionChargesThrough(item, month)
      : subscriptionDueIn(item, month)
        ? 1
        : 0;
    if (times === 0) continue;
    if (item.direction === 'income') inn += item.amount * times;
    else out += item.amount * times;
  }
  return { out, in: inn };
}

// --- the ledger snapshot -------------------------------------------------

// Balances used to be computed with a query per account, and activity with
// another — inside loops, and in getTrend inside a second loop over twelve
// months. Against a local file that was free. Against a database across the
// network it was dozens of round trips for one dashboard, which is the whole
// difference between the app feeling instant and feeling broken.
//
// So the ledger is read in two queries, pre-aggregated by the database, and
// every balance below is arithmetic over that snapshot. A household's ledger
// is thousands of rows at the very most, and it collapses to one row per
// account/month/kind before it crosses the wire.
async function loadLedger(householdId) {
  const [rows, subscriptions] = await Promise.all([
    db.all(
      `SELECT t.account_id, t.month, t.kind, COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.household_id = ?
       GROUP BY t.account_id, t.month, t.kind`,
      [householdId]
    ),
    db.all(
      `SELECT s.* FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id
       WHERE a.household_id = ? AND s.is_active = 1`,
      [householdId]
    ),
  ]);

  // account_id -> month -> kind -> total
  const byAccount = new Map();
  for (const row of rows) {
    let months = byAccount.get(row.account_id);
    if (!months) byAccount.set(row.account_id, (months = new Map()));
    let kinds = months.get(row.month);
    if (!kinds) months.set(row.month, (kinds = {}));
    kinds[row.kind] = row.total;
  }

  const subsByAccount = new Map();
  for (const sub of subscriptions) {
    const list = subsByAccount.get(sub.account_id);
    if (list) list.push(sub);
    else subsByAccount.set(sub.account_id, [sub]);
  }

  return new Ledger(byAccount, subsByAccount);
}

class Ledger {
  constructor(byAccount, subsByAccount) {
    this.byAccount = byAccount;
    this.subsByAccount = subsByAccount;
  }

  subscriptionsFor(accountId) {
    return this.subsByAccount.get(accountId) || [];
  }

  // Cumulative balance: opening + credits - debits - subscription charges to date.
  balance(account, month) {
    const months = this.byAccount.get(account.id);
    let credits = 0;
    let debits = 0;

    if (months) {
      for (const [m, kinds] of months) {
        if (m > month) continue;
        credits += (kinds.income || 0) + (kinds.transfer_in || 0);
        debits += (kinds.expense || 0) + (kinds.transfer_out || 0);
      }
    }

    const recurring = recurringTotals(this.subscriptionsFor(account.id), month, {
      cumulative: true,
    });
    return account.opening_balance + credits + recurring.in - debits - recurring.out;
  }

  activity(account, month) {
    const kinds = this.byAccount.get(account.id)?.get(month) || {};
    const recurring = recurringTotals(this.subscriptionsFor(account.id), month, {
      cumulative: false,
    });

    return {
      // Recurring income is folded into income: from the dashboard's point of
      // view salary is salary, whether it was typed in or arrives every month.
      income: (kinds.income || 0) + recurring.in,
      recurringIncome: recurring.in,
      expense: kinds.expense || 0,
      transferIn: kinds.transfer_in || 0,
      transferOut: kinds.transfer_out || 0,
      subscriptions: recurring.out,
    };
  }
}

// Balance of one account, for callers that need it on its own — the overdraft
// check on a transfer. Reads only that account's rows.
async function accountBalance(account, month) {
  const [row, subs] = await Promise.all([
    db.get(
      `SELECT
         COALESCE(SUM(CASE WHEN t.kind IN ('income','transfer_in')   THEN t.amount ELSE 0 END), 0) AS credits,
         COALESCE(SUM(CASE WHEN t.kind IN ('expense','transfer_out') THEN t.amount ELSE 0 END), 0) AS debits
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE t.account_id = ? AND t.month <= ? AND a.household_id = ?`,
      [account.id, month, account.household_id]
    ),
    db.all(
      `SELECT s.* FROM subscriptions s
       JOIN accounts a ON a.id = s.account_id
       WHERE s.account_id = ? AND s.is_active = 1 AND a.household_id = ?`,
      [account.id, account.household_id]
    ),
  ]);

  const recurring = recurringTotals(subs, month, { cumulative: true });
  return account.opening_balance + row.credits + recurring.in - row.debits - recurring.out;
}

// --- summary -------------------------------------------------------------

function convert(amount, rateInfo) {
  if (amount == null) return null;
  if (!rateInfo || rateInfo.rate == null) return null;
  return amount * rateInfo.rate;
}

async function getSummary(householdId, month) {
  const [primary, persons, allAccounts, ledger] = await Promise.all([
    settingsService.primaryCurrency(householdId),
    db.all('SELECT id, name FROM persons WHERE household_id = ? ORDER BY id', [householdId]),
    db.all(
      'SELECT * FROM accounts WHERE household_id = ? AND is_active = 1 ORDER BY person_id, sort_order, id',
      [householdId]
    ),
    loadLedger(householdId),
  ]);

  const rates = await exchangeRateService.getRateMap(
    allAccounts.map((a) => a.currency),
    primary,
    { householdId }
  );

  const household = {
    netWorth: 0,
    savings: 0,
    debt: 0,
    income: 0,
    expenses: 0,
    subscriptions: 0,
    unconvertedCurrencies: [],
  };
  const byCurrency = {};

  const personSummaries = persons.map((person) => {
    const accounts = allAccounts.filter((a) => a.person_id === person.id);

    const accountSummaries = accounts.map((account) => {
      const balance = ledger.balance(account, month);
      const activity = ledger.activity(account, month);
      const rate = rates[account.currency];
      const balancePrimary = convert(balance, rate);

      if (balancePrimary == null) {
        if (!household.unconvertedCurrencies.includes(account.currency)) {
          household.unconvertedCurrencies.push(account.currency);
        }
      } else {
        household.netWorth += balancePrimary;
        if (account.type === 'savings') household.savings += balancePrimary;
        // A card's negative balance is money owed; report it as a positive debt.
        if (account.type === 'credit' && balancePrimary < 0) household.debt += -balancePrimary;
        byCurrency[account.currency] = (byCurrency[account.currency] || 0) + balancePrimary;
      }

      household.income += convert(activity.income, rate) || 0;
      household.expenses += convert(activity.expense, rate) || 0;
      household.subscriptions += convert(activity.subscriptions, rate) || 0;

      return {
        id: account.id,
        personId: account.person_id,
        name: account.name,
        currency: account.currency,
        type: account.type,
        openingBalance: account.opening_balance,
        balance,
        balancePrimary,
        rate,
        activity,
      };
    });

    const sumPrimary = (key) =>
      accountSummaries.reduce((s, a) => s + (convert(a.activity[key], a.rate) || 0), 0);

    return {
      id: person.id,
      name: person.name,
      accounts: accountSummaries,
      income: sumPrimary('income'),
      expenses: sumPrimary('expense'),
      subscriptions: sumPrimary('subscriptions'),
      netWorth: accountSummaries.reduce((s, a) => s + (a.balancePrimary || 0), 0),
    };
  });

  return {
    month,
    primaryCurrency: primary,
    persons: personSummaries,
    household: {
      ...household,
      leftover: household.income - household.expenses - household.subscriptions,
      byCurrency,
    },
    rates,
  };
}

async function getTrend(householdId, count = 12, endMonth) {
  const end = endMonth || currentMonth();
  const [primary, accounts, ledger] = await Promise.all([
    settingsService.primaryCurrency(householdId),
    db.all('SELECT * FROM accounts WHERE household_id = ? AND is_active = 1', [householdId]),
    loadLedger(householdId),
  ]);
  const rates = await exchangeRateService.getRateMap(
    accounts.map((a) => a.currency),
    primary,
    { householdId }
  );

  const trend = [];
  for (let i = count - 1; i >= 0; i -= 1) {
    const month = shiftMonth(end, -i);
    let income = 0;
    let expenses = 0;
    let subscriptions = 0;
    let netWorth = 0;

    for (const account of accounts) {
      const rate = rates[account.currency];
      const activity = ledger.activity(account, month);
      income += convert(activity.income, rate) || 0;
      expenses += convert(activity.expense, rate) || 0;
      subscriptions += convert(activity.subscriptions, rate) || 0;
      netWorth += convert(ledger.balance(account, month), rate) || 0;
    }

    trend.push({ month, income, expenses, subscriptions, netWorth });
  }
  return trend;
}

// Spend grouped by category for a month, in the primary currency.
async function getCategoryBreakdown(householdId, month) {
  const [primary, accounts, ledger, rows] = await Promise.all([
    settingsService.primaryCurrency(householdId),
    db.all('SELECT * FROM accounts WHERE household_id = ? AND is_active = 1', [householdId]),
    loadLedger(householdId),
    db.all(
      `SELECT t.account_id, t.category, COALESCE(SUM(t.amount), 0) AS total
       FROM transactions t
       JOIN accounts a ON a.id = t.account_id
       WHERE a.household_id = ? AND t.month = ? AND t.kind = 'expense'
       GROUP BY t.account_id, t.category`,
      [householdId, month]
    ),
  ]);

  const rates = await exchangeRateService.getRateMap(
    accounts.map((a) => a.currency),
    primary,
    { householdId }
  );
  const byAccount = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const totals = {};

  for (const row of rows) {
    const account = byAccount[row.account_id];
    if (!account) continue;
    const value = convert(row.total, rates[account.currency]);
    if (value == null) continue;
    const key = row.category || 'Uncategorised';
    totals[key] = (totals[key] || 0) + value;
  }

  for (const account of accounts) {
    for (const sub of ledger.subscriptionsFor(account.id)) {
      if (sub.direction === 'income') continue; // this chart is where money went
      if (!subscriptionDueIn(sub, month)) continue;
      const value = convert(sub.amount, rates[account.currency]);
      if (value == null) continue;
      const key = sub.category || 'Subscriptions';
      totals[key] = (totals[key] || 0) + value;
    }
  }

  return Object.entries(totals)
    .map(([category, amount]) => ({ category, amount }))
    .sort((a, b) => b.amount - a.amount);
}

module.exports = {
  getSummary,
  getTrend,
  getCategoryBreakdown,
  accountBalance,
  currentMonth,
  shiftMonth,
  subscriptionDueIn,
  subscriptionChargesThrough,
};
