// What each figure on Home's month card is made of.
//
// The one rule that matters: every breakdown adds up to the figure it sits
// under. A list that lands a few dirhams off its own headline says one of the
// two numbers is wrong and not which, which is worse than no list at all. So
// the totals are checked against the household figures to the fils, and the
// rest checks that each list holds what it claims to and nothing else.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();
const M = '2026-09';
const close = (a, b) => Math.abs(a - b) < 0.005;
const sum = (rows) => rows.reduce((total, row) => total + row.amount, 0);

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `flow_${u}`, password: 'flowpass1234' });
  const hh = await me.post('/api/households', { name: 'Flow Home', people: ['Faisal', 'Noor'] });
  me.use(hh.data.id);

  const accounts = (await me.get('/api/accounts')).data;
  const main = accounts[0];
  const noorId = (await me.get(`/api/summary/${M}`)).data.persons.find((p) => p.name === 'Noor').id;
  const make = async (body) => (await me.post('/api/accounts', body)).data;
  const savings = await make({ person_id: main.person_id, name: 'Rainy day', currency: 'AED', type: 'savings' });
  const noorCurrent = await make({ person_id: noorId, name: 'Noor current', currency: 'AED', type: 'current' });
  // A second currency, so the totals are checked across a conversion. Whether
  // a rate is available here or not, the rule is the same: the breakdown
  // converts or skips exactly what the household figure converts or skips.
  const rupees = await make({ person_id: noorId, name: 'HBL', currency: 'PKR', type: 'current' });
  const closing = await make({ person_id: main.person_id, name: 'Old card', currency: 'AED', type: 'current' });

  const add = (body) => me.post('/api/transactions', { month: M, ...body });
  await add({ account_id: main.id, kind: 'income', amount: 500, category: 'Freelance' });
  await add({ account_id: main.id, kind: 'income', amount: 75 });
  await add({ account_id: main.id, kind: 'expense', amount: 300, category: 'Groceries' });
  await add({ account_id: main.id, kind: 'expense', amount: 200, category: 'Groceries' });
  await add({ account_id: main.id, kind: 'expense', amount: 40 });
  await add({ account_id: noorCurrent.id, kind: 'expense', amount: 150, category: 'Fuel' });
  await add({ account_id: rupees.id, kind: 'expense', amount: 5000, category: 'Shopping' });
  await add({ account_id: closing.id, kind: 'expense', amount: 999, category: 'Gone' });
  await me.post('/api/transactions/transfer', {
    from_account_id: main.id, to_account_id: savings.id, month: M, amount: 3000,
  });

  const recurring = (body) => me.post('/api/subscriptions', { cycle: 'monthly', start_month: M, ...body });
  await recurring({ account_id: main.id, name: 'Salary', direction: 'income', amount: 24000 });
  await recurring({ account_id: main.id, name: 'Netflix', amount: 56, category: 'Entertainment' });
  await recurring({ account_id: noorCurrent.id, name: 'Gym', amount: 200 });
  // Yearly and billed in March, so not this month's.
  await recurring({ account_id: main.id, name: 'Insurance', amount: 1200, cycle: 'yearly', billing_month: 3 });

  // Closed, with a September entry still on it. It is out of every total, so
  // it has to be out of every breakdown.
  await me.del(`/api/accounts/${closing.id}`);

  const summary = (await me.get(`/api/summary/${M}`)).data;
  const { flow, household } = summary;
  check('the summary carries a breakdown', Boolean(flow && flow.cameIn && flow.spent && flow.recurring),
    JSON.stringify(Object.keys(flow ?? {})));

  // --- each list adds up to its figure ------------------------------------
  check('what came in adds up to the figure on the card', close(sum(flow.cameIn), household.income),
    `${sum(flow.cameIn)} vs ${household.income}`);
  check('what was spent adds up to the figure on the card', close(sum(flow.spent), household.expenses),
    `${sum(flow.spent)} vs ${household.expenses}`);
  check('the recurring items add up to the subscriptions figure', close(sum(flow.recurring), household.subscriptions),
    `${sum(flow.recurring)} vs ${household.subscriptions}`);

  // --- spent is spending and nothing else ---------------------------------
  const groceries = flow.spent.find((row) => row.label === 'Groceries');
  check('entries in one category are one row', groceries?.amount === 500, JSON.stringify(groceries));
  check('which says how many entries it is made of', groceries?.count === 2, JSON.stringify(groceries));
  check('an entry with no category is still counted, as Uncategorised',
    flow.spent.some((row) => row.label === 'Uncategorised' && row.amount === 40),
    JSON.stringify(flow.spent));
  check('recurring items are not folded into spending, because they are their own figure',
    !flow.spent.some((row) => row.label === 'Entertainment' || row.label === 'Netflix'),
    JSON.stringify(flow.spent.map((r) => r.label)));
  check('a closed account is in neither the total nor the list',
    !flow.spent.some((row) => row.label === 'Gone'), JSON.stringify(flow.spent.map((r) => r.label)));
  check('biggest first', flow.spent.every((row, i) => i === 0 || flow.spent[i - 1].amount >= row.amount),
    flow.spent.map((r) => r.amount).join(','));

  // --- recurring ----------------------------------------------------------
  const netflix = flow.recurring.find((row) => row.label === 'Netflix');
  check('each recurring item is listed with the account it leaves', netflix?.account === main.name,
    JSON.stringify(netflix));
  check('and its amount in that account’s own currency',
    netflix?.original === 56 && netflix?.currency === 'AED', JSON.stringify(netflix));
  check('an item not due this month is left out',
    !flow.recurring.some((row) => row.label === 'Insurance'), flow.recurring.map((r) => r.label).join(','));
  check('recurring income is not listed as something going out',
    !flow.recurring.some((row) => row.label === 'Salary'), flow.recurring.map((r) => r.label).join(','));

  // --- came in ------------------------------------------------------------
  const salary = flow.cameIn.find((row) => row.label === 'Salary');
  check('recurring income is in what came in, marked as recurring',
    salary?.recurring === true && salary.amount === 24000, JSON.stringify(salary));
  check('income with no category is still counted',
    flow.cameIn.some((row) => row.label === 'Other income' && row.amount === 75), JSON.stringify(flow.cameIn));
  check('transfers are not income, even into an account that receives them',
    close(sum(flow.cameIn), 24000 + 500 + 75), String(sum(flow.cameIn)));

  report('Month card breakdown');
})();
