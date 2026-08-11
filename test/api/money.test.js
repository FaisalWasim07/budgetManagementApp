// The money maths: balances, the overdraft guard, cross-currency transfers,
// subscriptions applied on the fly, and deactivation rather than deletion.
// These are the numbers people trust without checking, so they get checked here.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();
const M = '2026-08';

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `money_${u}`, password: 'moneypass123' });
  const household = await me.post('/api/households', { name: 'Money Home', people: ['Faisal'] });
  me.use(household.data.id);

  const main = (await me.get('/api/accounts')).data[0];
  const personId = main.person_id;

  const savings = (
    await me.post('/api/accounts', { person_id: personId, name: 'Savings', currency: 'AED', type: 'savings' })
  ).data;
  const pkr = (
    await me.post('/api/accounts', {
      person_id: personId, name: 'PKR Savings', currency: 'PKR', type: 'savings', opening_balance: 100000,
    })
  ).data;
  const card = (
    await me.post('/api/accounts', { person_id: personId, name: 'Visa', currency: 'AED', type: 'credit' })
  ).data;

  const accounts = async () => {
    const summary = (await me.get(`/api/summary/${M}`)).data;
    return Object.fromEntries(
      summary.persons.flatMap((p) => p.accounts).map((a) => [a.id, a])
    );
  };

  // --- salary in, expense out, transfer across --------------------------
  await me.post('/api/transactions', {
    account_id: main.id, month: M, kind: 'income', amount: 20000, description: 'Salary',
  });
  await me.post('/api/transactions', {
    account_id: main.id, month: M, kind: 'expense', amount: 1500, category: 'Groceries',
  });
  await me.post('/api/transactions/transfer', {
    from_account_id: main.id, to_account_id: savings.id, month: M, amount: 5000,
  });

  let byId = await accounts();
  check('the main balance is opening + income − expense − transfer', byId[main.id].balance === 13500,
    String(byId[main.id].balance));
  check('the transfer arrived in savings', byId[savings.id].balance === 5000, String(byId[savings.id].balance));
  check('an opening balance is respected', byId[pkr.id].balance === 100000, String(byId[pkr.id].balance));

  // --- you can only move money you have ---------------------------------
  const overdraft = await me.post('/api/transactions/transfer', {
    from_account_id: savings.id, to_account_id: main.id, month: M, amount: 999999,
  });
  check('moving money you do not have is refused', overdraft.status === 400, String(overdraft.status));

  const cardSpend = await me.post('/api/transactions/transfer', {
    from_account_id: card.id, to_account_id: main.id, month: M, amount: 3000,
  });
  check('a credit card may go negative, since that is what a card is',
    cardSpend.status === 201, String(cardSpend.status));

  // --- cross-currency needs both sides ----------------------------------
  const missingRate = await me.post('/api/transactions/transfer', {
    from_account_id: main.id, to_account_id: pkr.id, month: M, amount: 100,
  });
  check('a cross-currency transfer without both amounts is refused',
    missingRate.status === 400, String(missingRate.status));

  const crossCurrency = await me.post('/api/transactions/transfer', {
    from_account_id: main.id, to_account_id: pkr.id, month: M, amount: 100, to_amount: 7800,
  });
  check('with both amounts it is accepted', crossCurrency.status === 201, String(crossCurrency.status));

  // --- a transfer is always exactly two rows ----------------------------
  const rows = (await me.get(`/api/transactions?month=${M}`)).data;
  const pairs = {};
  for (const row of rows) {
    if (row.transfer_id) (pairs[row.transfer_id] ??= []).push(row.kind);
  }
  check('every transfer has exactly two legs',
    Object.values(pairs).every((legs) => legs.length === 2) && Object.keys(pairs).length === 3,
    JSON.stringify(Object.values(pairs)));

  // --- subscriptions are applied without being written down -------------
  await me.post('/api/subscriptions', {
    account_id: card.id, name: 'Netflix', amount: 56, cycle: 'monthly',
    start_month: '2026-06', category: 'Entertainment',
  });
  byId = await accounts();
  // −3000 moved off the card, then Netflix for June, July and August.
  check('subscriptions reduce the balance for every month they have run',
    byId[card.id].balance === -3168, String(byId[card.id].balance));

  // --- deleting one leg of a transfer removes both ----------------------
  const aLeg = rows.find((r) => r.transfer_id);
  await me.del(`/api/transactions/${aLeg.id}`);
  const afterDelete = (await me.get(`/api/transactions?month=${M}`)).data;
  const remaining = {};
  for (const row of afterDelete) {
    if (row.transfer_id) (remaining[row.transfer_id] ??= []).push(row.kind);
  }
  check('deleting one side of a transfer removes the other',
    Object.values(remaining).every((legs) => legs.length === 2) && Object.keys(remaining).length === 2,
    JSON.stringify(Object.values(remaining)));

  // --- charts -----------------------------------------------------------
  const trend = (await me.get(`/api/summary/trend?months=12&endMonth=${M}`)).data;
  check('the trend covers twelve months ending on the one asked for',
    trend.length === 12 && trend[11].month === M, `${trend.length} / ${trend[11]?.month}`);

  const categories = (await me.get(`/api/summary/categories/${M}`)).data;
  check('spending is grouped by category, subscriptions included',
    JSON.stringify(categories.map((c) => c.category).sort()) === '["Entertainment","Groceries"]',
    JSON.stringify(categories));

  // --- an account with history is kept ----------------------------------
  const deleted = (await me.del(`/api/accounts/${savings.id}`)).data;
  check('an account with history is deactivated rather than deleted',
    deleted.deleted === false && deleted.deactivated === true, JSON.stringify(deleted));
  check('and its counts come back as numbers, not strings',
    typeof deleted.transactions === 'number', typeof deleted.transactions);

  const { failed } = report('Money maths');
  process.exit(failed ? 1 : 0);
})();
