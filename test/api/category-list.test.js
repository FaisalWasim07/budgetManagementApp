// The add sheet's category dropdown: every category this household has used,
// split into money out and money in, most used first. Recurring items count,
// and nothing from another household leaks in.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `cat_${u}`, password: 'catpass12345' });
  const hh = await me.post('/api/households', { name: 'Cat Home', people: ['Faisal'] });
  me.use(hh.data.id);
  const main = (await me.get('/api/accounts')).data[0];

  const empty = (await me.get('/api/transactions/categories')).data;
  check('a new household has no categories yet',
    Array.isArray(empty.expense) && empty.expense.length === 0 && empty.income.length === 0, JSON.stringify(empty));

  const add = (body) => me.post('/api/transactions', { account_id: main.id, ...body });
  await add({ month: '2026-09', kind: 'expense', amount: 10, category: 'Fuel' });
  await add({ month: '2026-10', kind: 'expense', amount: 20, category: 'Groceries' });
  await add({ month: '2026-10', kind: 'expense', amount: 30, category: 'Groceries ' });
  await add({ month: '2026-11', kind: 'expense', amount: 40, category: 'Groceries' });
  await add({ month: '2026-11', kind: 'expense', amount: 5, category: '   ' });
  await add({ month: '2026-11', kind: 'income', amount: 9000, category: 'Salary' });
  await me.post('/api/subscriptions', {
    account_id: main.id, name: 'Netflix', amount: 56, cycle: 'monthly', start_month: '2026-06', category: 'Entertainment',
  });

  const used = (await me.get('/api/transactions/categories')).data;
  check('money out is listed most used first (ties to the most recent), with stray spaces folded together',
    JSON.stringify(used.expense) === '["Groceries","Fuel","Entertainment"]', JSON.stringify(used.expense));
  check('a blank category is not offered', !used.expense.includes('') && !used.expense.includes('   '));
  check('money in is its own list', JSON.stringify(used.income) === '["Salary"]', JSON.stringify(used.income));

  const other = client();
  await other.post('/api/auth/signup', { username: `cat2_${u}`, password: 'catpass12345' });
  const theirs = await other.post('/api/households', { name: 'Other Home', people: ['Noor'] });
  other.use(theirs.data.id);
  const otherMain = (await other.get('/api/accounts')).data[0];
  await other.post('/api/transactions', { account_id: otherMain.id, month: '2026-11', kind: 'expense', amount: 1, category: 'Secret' });
  const mine = (await me.get('/api/transactions/categories')).data;
  check('another household’s categories stay theirs', !mine.expense.includes('Secret'), JSON.stringify(mine.expense));

  const { failed } = report('Category list');
  process.exit(failed ? 1 : 0);
})();
