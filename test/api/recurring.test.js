// Recurring money, and the one rule that makes it trustworthy: changing what
// something costs must never change what it cost. A subscription's amount is
// applied on the fly to every month in its range, so editing it in place would
// quietly restate last March because Netflix put its price up in August. These
// checks are the difference between a record and a guess.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

// Three consecutive months, well clear of today so nothing here depends on
// when the suite is run.
const JUN = '2026-06';
const JUL = '2026-07';
const AUG = '2026-08';
const SEP = '2026-09';

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `recur_${u}`, password: 'recurpass123' });
  const household = await me.post('/api/households', { name: 'Recurring Home', people: ['Faisal'] });
  me.use(household.data.id);

  const main = (await me.get('/api/accounts')).data[0];

  const spendIn = async (month) => {
    const summary = (await me.get(`/api/summary/${month}`)).data;
    return Math.round(summary.household.subscriptions);
  };
  const balanceIn = async (month) => {
    const summary = (await me.get(`/api/summary/${month}`)).data;
    return Math.round(summary.persons[0].accounts.find((a) => a.id === main.id).balance);
  };
  const list = async () => (await me.get('/api/subscriptions')).data;

  // --- a subscription is charged every month from its start ---------------
  const netflix = (
    await me.post('/api/subscriptions', {
      account_id: main.id,
      name: 'Netflix',
      amount: 56,
      cycle: 'monthly',
      start_month: JUN,
      category: 'Entertainment',
    })
  ).data;

  check('it is charged in the month it starts', (await spendIn(JUN)) === 56);
  check('and in every month after', (await spendIn(AUG)) === 56);
  check('and not before it started', (await spendIn('2026-05')) === 0);

  // --- a price rise splits the item rather than rewriting it --------------
  const raised = await me.patch(`/api/subscriptions/${netflix.id}`, { amount: 62, from_month: AUG });

  check('the price change reports that it split the item', raised.data.split === true, JSON.stringify(raised.data.split));
  check('June keeps the price June actually paid', (await spendIn(JUN)) === 56, String(await spendIn(JUN)));
  check('so does July', (await spendIn(JUL)) === 56, String(await spendIn(JUL)));
  check('August charges the new price', (await spendIn(AUG)) === 62, String(await spendIn(AUG)));
  check('and so does September', (await spendIn(SEP)) === 62, String(await spendIn(SEP)));
  check('neither month is charged twice', (await spendIn(AUG)) !== 118);

  const afterRaise = await list();
  check('there are now two periods', afterRaise.length === 2, String(afterRaise.length));
  const oldPeriod = afterRaise.find((s) => s.amount === 56);
  const newPeriod = afterRaise.find((s) => s.amount === 62);
  check('the old period is closed at the end of July', oldPeriod.end_month === JUL, oldPeriod.end_month);
  check('the new one starts in August', newPeriod.start_month === AUG, newPeriod.start_month);
  check('the new one has no end', newPeriod.end_month === null);

  // The balance is the real proof: it is opening minus every charge ever
  // made, so it can only be right if each month used its own price.
  check(
    'the running balance uses each month’s own price',
    (await balanceIn(SEP)) === -(56 * 2 + 62 * 2),
    String(await balanceIn(SEP))
  );

  // --- renaming is not a price change ------------------------------------
  const renamed = await me.patch(`/api/subscriptions/${newPeriod.id}`, {
    name: 'Netflix Premium',
    category: 'Streaming',
    from_month: SEP,
  });
  check('renaming does not split the item', renamed.data.split === false);
  check('the rename applies to the item it was made on', renamed.data.name === 'Netflix Premium');
  check('and creates no third period', (await list()).length === 2);

  // --- a correction in the same month it started just edits ---------------
  const gym = (
    await me.post('/api/subscriptions', {
      account_id: main.id, name: 'Gym', amount: 300, cycle: 'monthly', start_month: AUG,
    })
  ).data;
  const fixed = await me.patch(`/api/subscriptions/${gym.id}`, { amount: 250, from_month: AUG });
  check('fixing a typo the month it was added does not split it', fixed.data.split === false);
  check('there is still one gym', (await list()).filter((s) => s.name === 'Gym').length === 1);
  check('and it costs the corrected amount', (await spendIn(AUG)) === 62 + 250, String(await spendIn(AUG)));

  // --- stopping keeps the months it ran ----------------------------------
  const stopped = await me.post(`/api/subscriptions/${gym.id}/stop`, { from_month: SEP });
  check('stopping ends it at the previous month', stopped.data.end_month === AUG, stopped.data.end_month);
  check('August still has the gym', (await spendIn(AUG)) === 62 + 250, String(await spendIn(AUG)));
  check('September does not', (await spendIn(SEP)) === 62, String(await spendIn(SEP)));

  // The old way of doing this — is_active = 0 — took it out of every month at
  // once. That is the regression this check exists to catch.
  check('stopping did not erase the history', (await spendIn(AUG)) !== 62);

  // --- restarting after a gap does not backfill the gap -------------------
  const restarted = await me.post(`/api/subscriptions/${gym.id}/resume`, { from_month: '2026-11' });
  check('restarting after a gap starts a new period', restarted.data.restarted === true);
  check('the gap stays empty', (await spendIn(SEP)) === 62, String(await spendIn(SEP)));
  check('October too', (await spendIn('2026-10')) === 62, String(await spendIn('2026-10')));
  check('and it runs again from November', (await spendIn('2026-11')) === 62 + 250, String(await spendIn('2026-11')));

  // --- restarting the month after stopping is an undo ---------------------
  const monthly = (
    await me.post('/api/subscriptions', {
      account_id: main.id, name: 'Spotify', amount: 20, cycle: 'monthly', start_month: JUN,
    })
  ).data;
  await me.post(`/api/subscriptions/${monthly.id}/stop`, { from_month: AUG });
  const undone = await me.post(`/api/subscriptions/${monthly.id}/resume`, { from_month: AUG });
  check('restarting the month you stopped is an undo, not a new period', undone.data.restarted === false);
  check('it leaves one item, not two', (await list()).filter((s) => s.name === 'Spotify').length === 1);
  check('and its end date is cleared', undone.data.end_month === null);

  // --- stopping something that never ran removes it -----------------------
  const mistake = (
    await me.post('/api/subscriptions', {
      account_id: main.id, name: 'Typo', amount: 99, cycle: 'monthly', start_month: SEP,
    })
  ).data;
  const removed = await me.post(`/api/subscriptions/${mistake.id}/stop`, { from_month: SEP });
  check('stopping something before it ever ran removes it', removed.status === 204, String(removed.status));
  check('and it is gone from the list', (await list()).every((s) => s.name !== 'Typo'));

  // --- yearly items are only charged in their billing month ---------------
  const insurance = (
    await me.post('/api/subscriptions', {
      account_id: main.id, name: 'Insurance', amount: 1200, cycle: 'yearly',
      billing_month: 3, start_month: JUN,
    })
  ).data;
  check('a yearly item skips months that are not its own', (await spendIn(SEP)) === 62 + 20);
  check('and lands in its billing month', (await spendIn('2027-03')) === 62 + 20 + 250 + 1200,
    String(await spendIn('2027-03')));

  const rerated = await me.patch(`/api/subscriptions/${insurance.id}`, { amount: 1500, from_month: '2027-06' });
  check('a yearly item charged before splits too', rerated.data.split === true);
  check('the year already billed keeps its price', (await spendIn('2027-03')) === 62 + 20 + 250 + 1200,
    String(await spendIn('2027-03')));
  check('the next one uses the new price', (await spendIn('2028-03')) === 62 + 20 + 250 + 1500,
    String(await spendIn('2028-03')));

  // --- deleting is the other thing entirely ------------------------------
  await me.del(`/api/subscriptions/${monthly.id}`);
  check('deleting removes it from every month it ever charged', (await spendIn(JUL)) === 56,
    String(await spendIn(JUL)));

  // --- an end month you set yourself -------------------------------------
  // Stop ends something from today. An end month says "this was always going
  // to finish in June" — school fees, a fixed-term policy — without having to
  // remember to come back and press Stop when June arrives.
  //
  // These months are relative to today on purpose: the rule they check is
  // about the past, so a hardcoded month would test something different every
  // year.
  const shift = (month, by) => {
    const [y, m] = month.split('-').map(Number);
    const at = y * 12 + (m - 1) + by;
    return `${Math.floor(at / 12)}-${String((at % 12) + 1).padStart(2, '0')}`;
  };
  const thisMonth = new Date().toISOString().slice(0, 7);
  const lastYear = shift(thisMonth, 11);

  const fees = await me.post('/api/subscriptions', {
    account_id: main.id,
    name: 'School fees',
    amount: 500,
    cycle: 'monthly',
    start_month: thisMonth,
    end_month: lastYear,
  });
  check('an end month can be set when creating an item', fees.status === 201, String(fees.status));
  check('and it is stored', fees.data.end_month === lastYear, String(fees.data.end_month));

  const listAt = async (month) =>
    (await me.get(`/api/subscriptions?month=${month}`)).data.find((i) => i.id === fees.data.id);

  check('it charges in its final month', (await listAt(lastYear))?.dueThisMonth === true);
  check('and not the month after', (await listAt(shift(lastYear, 1)))?.dueThisMonth === false);

  const spendFinal = await spendIn(lastYear);
  const spendAfter = await spendIn(shift(lastYear, 1));
  check('the final month counts it', spendFinal >= 500, String(spendFinal));
  check('the month after does not', spendAfter === spendFinal - 500,
    `${spendAfter} vs ${spendFinal}`);

  // An end month already gone would take charges back out of months that are
  // already recorded — which is exactly what stopping exists to avoid.
  const longRunning = await me.post('/api/subscriptions', {
    account_id: main.id,
    name: 'Old policy',
    amount: 30,
    cycle: 'monthly',
    start_month: shift(thisMonth, -8),
  });
  const backdated = await me.patch(`/api/subscriptions/${longRunning.data.id}`, {
    end_month: shift(thisMonth, -4),
    from_month: thisMonth,
  });
  check('an end month before last month is refused', backdated.status === 400, String(backdated.status));
  check('and says why',
    String(backdated.data.error).includes('already recorded'), String(backdated.data.error));

  const createPast = await me.post('/api/subscriptions', {
    account_id: main.id,
    name: 'Already over',
    amount: 10,
    cycle: 'monthly',
    start_month: shift(thisMonth, -6),
    end_month: shift(thisMonth, -4),
  });
  check('creating one that already ended is refused too', createPast.status === 400,
    String(createPast.status));

  // Something you stopped months ago keeps the date it stopped on; renaming it
  // must not trip the same rule.
  const old = await me.post('/api/subscriptions', {
    account_id: main.id,
    name: 'Old gym',
    amount: 40,
    cycle: 'monthly',
    start_month: shift(thisMonth, -6),
  });
  await me.post(`/api/subscriptions/${old.data.id}/stop`, { from_month: shift(thisMonth, -2) });
  const relabelled = await me.patch(`/api/subscriptions/${old.data.id}`, {
    name: 'Old gym, cancelled',
    from_month: thisMonth,
  });
  check('an item that ended in the past can still be renamed', relabelled.status === 200,
    String(relabelled.status));

  const cleared = await me.patch(`/api/subscriptions/${fees.data.id}`, {
    end_month: null,
    from_month: thisMonth,
  });
  check('clearing the end month makes it open-ended again', cleared.status === 200,
    String(cleared.status));
  check('and it charges past where it used to end',
    (await listAt(shift(lastYear, 1)))?.dueThisMonth === true);

  await me.del(`/api/subscriptions/${fees.data.id}`);
  await me.del(`/api/subscriptions/${old.data.id}`);
  await me.del(`/api/subscriptions/${longRunning.data.id}`);

  // --- and none of it escapes the household ------------------------------
  const other = client();
  await other.post('/api/auth/signup', { username: `outsider_${u}`, password: 'outsider123' });
  const theirs = await other.post('/api/households', { name: 'Theirs', people: ['Someone'] });
  other.use(theirs.data.id);
  check('an outsider cannot change your recurring money',
    (await other.patch(`/api/subscriptions/${netflix.id}`, { amount: 1, from_month: AUG })).status === 404);
  check('an outsider cannot stop it either',
    (await other.post(`/api/subscriptions/${netflix.id}/stop`, { from_month: AUG })).status === 404);
  check('nor restart it',
    (await other.post(`/api/subscriptions/${netflix.id}/resume`, { from_month: AUG })).status === 404);

  const { failed } = report('Recurring money');
  process.exit(failed ? 1 : 0);
})();
