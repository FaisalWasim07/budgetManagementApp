// Editing entries and transfers, and recurring money in both directions.
// A transfer is two rows that must always agree; editing is where they would
// most easily stop agreeing.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();
const M = '2026-08';

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `edit_${u}`, password: 'editpass1234' });
  const hh = await me.post('/api/households', { name: 'Edit Home', people: ['Me'] });
  me.use(hh.data.id);

  const accounts = (await me.get('/api/accounts')).data;
  const main = accounts[0];
  const savings = (
    await me.post('/api/accounts', {
      person_id: main.person_id, name: 'Savings', currency: 'AED', type: 'savings',
    })
  ).data;
  const pkr = (
    await me.post('/api/accounts', {
      person_id: main.person_id, name: 'PKR', currency: 'PKR', type: 'savings',
    })
  ).data;

  const balance = async (id) => {
    const s = (await me.get(`/api/summary/${M}`)).data;
    return s.persons.flatMap((p) => p.accounts).find((a) => a.id === id)?.balance;
  };

  // --- editing an ordinary entry ----------------------------------------
  const income = (
    await me.post('/api/transactions', {
      account_id: main.id, month: M, kind: 'income', amount: 5000, description: 'Salary',
    })
  ).data;
  check('balance reflects the entry', (await balance(main.id)) === 5000, String(await balance(main.id)));

  const fixed = await me.patch(`/api/transactions/${income.id}`, { amount: 5500 });
  check('an entry can be edited', fixed.status === 200 && fixed.data.amount === 5500, JSON.stringify(fixed.data));
  check('the balance follows the edit', (await balance(main.id)) === 5500, String(await balance(main.id)));

  const recategorised = await me.patch(`/api/transactions/${income.id}`, {
    kind: 'expense', category: 'Oops',
  });
  check('income can be corrected to expense', recategorised.data.kind === 'expense');
  check('the balance flips accordingly', (await balance(main.id)) === -5500, String(await balance(main.id)));
  await me.patch(`/api/transactions/${income.id}`, { kind: 'income', category: null });

  const bad1 = await me.patch(`/api/transactions/${income.id}`, { amount: -5 });
  check('a negative amount is refused', bad1.status === 400, String(bad1.status));

  // --- editing a transfer ------------------------------------------------
  const transfer = (
    await me.post('/api/transactions/transfer', {
      from_account_id: main.id, to_account_id: savings.id, month: M, amount: 1000,
    })
  ).data;
  const outLeg = transfer.find((t) => t.kind === 'transfer_out');
  check('transfer moved the money', (await balance(savings.id)) === 1000);

  const edited = await me.patch(`/api/transactions/${outLeg.id}`, { amount: 1500 });
  check('a transfer can be edited', edited.status === 200, JSON.stringify(edited.data).slice(0, 80));
  check('both legs moved together',
    (await balance(main.id)) === 4000 && (await balance(savings.id)) === 1500,
    `${await balance(main.id)} / ${await balance(savings.id)}`);

  const legs = (await me.get(`/api/transactions?month=${M}`)).data.filter(
    (t) => t.transfer_id === outLeg.transfer_id
  );
  check('the pair is still exactly two rows', legs.length === 2, String(legs.length));
  check('both legs carry the new amount', legs.every((l) => l.amount === 1500));

  // Editing the receiving side of a cross-currency transfer independently.
  const cross = (
    await me.post('/api/transactions/transfer', {
      from_account_id: main.id, to_account_id: pkr.id, month: M, amount: 100, to_amount: 7800,
    })
  ).data;
  const crossOut = cross.find((t) => t.kind === 'transfer_out');
  await me.patch(`/api/transactions/${crossOut.id}`, { amount: 120, to_amount: 9400 });
  const crossLegs = (await me.get(`/api/transactions?month=${M}`)).data.filter(
    (t) => t.transfer_id === crossOut.transfer_id
  );
  check('the two sides of a cross-currency transfer keep their own amounts',
    crossLegs.find((l) => l.kind === 'transfer_out').amount === 120 &&
      crossLegs.find((l) => l.kind === 'transfer_in').amount === 9400,
    JSON.stringify(crossLegs.map((l) => l.amount)));

  // --- the overdraft guard applies to edits too --------------------------
  const overdraw = await me.patch(`/api/transactions/${outLeg.id}`, { amount: 999999 });
  check('an edit cannot overdraw the source', overdraw.status === 400, String(overdraw.status));
  check('and the transfer is unchanged', (await balance(savings.id)) === 1500, String(await balance(savings.id)));

  const becomeEntry = await me.patch(`/api/transactions/${outLeg.id}`, { kind: 'expense' });
  check('a transfer cannot be turned into a plain entry', becomeEntry.status === 400, String(becomeEntry.status));

  // --- recurring money, both directions ----------------------------------
  const salary = await me.post('/api/subscriptions', {
    account_id: main.id, name: 'Salary', direction: 'income', amount: 20000,
    cycle: 'monthly', start_month: '2026-07',
  });
  check('recurring income can be created', salary.status === 201 && salary.data.direction === 'income',
    JSON.stringify(salary.data).slice(0, 80));

  const netflix = await me.post('/api/subscriptions', {
    account_id: main.id, name: 'Netflix', amount: 56, cycle: 'monthly', start_month: '2026-07',
  });
  check('a subscription still defaults to going out', netflix.data.direction === 'expense');

  // Jul + Aug = 2 salaries in, 2 Netflix out, on top of the 4,000 already there.
  const expected = 4000 - 120 + 20000 * 2 - 56 * 2;
  check('recurring income and spending both hit the balance',
    Math.abs((await balance(main.id)) - expected) < 0.001,
    `${await balance(main.id)} vs ${expected}`);

  const summary = (await me.get(`/api/summary/${M}`)).data;
  check('the month’s income includes the recurring salary',
    summary.household.income === 5500 + 20000, String(summary.household.income));
  check('subscriptions total counts only what goes out',
    summary.household.subscriptions === 56, String(summary.household.subscriptions));

  const categories = (await me.get(`/api/summary/categories/${M}`)).data;
  check('recurring income is absent from the spending breakdown',
    !categories.some((c) => c.category === 'Salary'),
    JSON.stringify(categories));

  // Ending it stops it, without touching history.
  await me.patch(`/api/subscriptions/${salary.data.id}`, { end_month: '2026-07' });
  const afterEnd = (await me.get(`/api/summary/${M}`)).data;
  check('ending recurring income removes it from later months',
    afterEnd.household.income === 5500, String(afterEnd.household.income));

  const { failed } = report('Editing and recurring money');
  process.exit(failed ? 1 : 0);
})();
