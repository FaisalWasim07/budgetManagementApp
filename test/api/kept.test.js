// Keeping statements, and what can be asked once more than one is kept.
//
// The arithmetic is tested directly in history.test.js — this one is about the
// storage around it: who may keep, what re-keeping the same month does, that a
// household cannot see another's, and that the rows come back as they went in.
//
// Nothing here calls the model. Keeping a statement is filing rows somebody
// already read, so the whole path is testable without a key or a network.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

const row = (merchant, amount, extra = {}) => ({
  date: '2026-08-04',
  postDate: null,
  raw: merchant.toUpperCase(),
  merchant,
  what: 'a shop',
  amount,
  direction: 'out',
  kind: 'purchase',
  category: 'Shopping',
  confidence: 'high',
  ...extra,
});

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `kept_${u}`, password: 'keptpass1234' });
  const hh = await me.post('/api/households', { name: 'Kept', people: ['Me'] });
  me.use(hh.data.id);
  const main = (await me.get('/api/accounts')).data[0];

  // --- keeping one --------------------------------------------------------
  const july = {
    account_id: main.id,
    statement: { periodStart: '2026-07-01', periodEnd: '2026-07-31', openingBalance: 0, closingBalance: -456 },
    rows: [
      row('Carrefour', 400, { category: 'Groceries' }),
      row('Netflix', 56, { category: 'Subscriptions' }),
    ],
  };
  const keptJuly = await me.post('/api/statements/kept', july);
  check('a statement can be kept', keptJuly.status === 201 && keptJuly.data.rows === 2,
    JSON.stringify(keptJuly.data));

  const listed = await me.get('/api/statements/kept');
  check('and then it is listed', listed.data.statements.length === 1, JSON.stringify(listed.data.statements));
  check('with the period the bank printed', listed.data.statements[0].periodStart === '2026-07-01',
    listed.data.statements[0].periodStart);
  check('and the account it was read against',
    listed.data.statements[0].accountId === main.id, String(listed.data.statements[0].accountId));
  check('a single statement has nothing to compare against yet',
    listed.data.latest === null, JSON.stringify(listed.data.latest));

  // --- reading one back ---------------------------------------------------
  const readBack = await me.get(`/api/statements/kept/${keptJuly.data.id}`);
  check('it reads back with its rows', readBack.data.rows.length === 2, String(readBack.data.rows.length));
  check('the line the bank printed is kept exactly',
    readBack.data.rows[0].raw === 'CARREFOUR', readBack.data.rows[0].raw);
  check('and the rows come back in the order they were on the statement',
    readBack.data.rows.map((r) => r.merchant).join(',') === 'Carrefour,Netflix',
    readBack.data.rows.map((r) => r.merchant).join(','));
  check('with the reconciliation worked out again from the stored rows',
    readBack.data.reconciliation !== undefined, JSON.stringify(readBack.data.reconciliation));

  // --- re-keeping the same period replaces it -----------------------------
  const again = await me.post('/api/statements/kept', {
    ...july,
    rows: [...july.rows, row('Spinneys', 120, { category: 'Groceries' })],
  });
  check('re-keeping the same period is accepted', again.status === 201, String(again.status));
  const afterAgain = await me.get('/api/statements/kept');
  check('and replaces it rather than giving you two of the same month',
    afterAgain.data.statements.length === 1, String(afterAgain.data.statements.length));
  check('with the rows from the newer reading',
    afterAgain.data.statements[0].lines === 3, String(afterAgain.data.statements[0].lines));

  // --- a second month, and the comparison ---------------------------------
  const keptAugust = await me.post('/api/statements/kept', {
    account_id: main.id,
    statement: { periodStart: '2026-08-01', periodEnd: '2026-08-31' },
    rows: [
      row('Carrefour', 520, { category: 'Groceries' }),
      row('Netflix', 62, { category: 'Subscriptions' }),
      row('Emirates', 1800, { category: 'Travel' }),
    ],
  });
  check('a second month is kept alongside the first', keptAugust.status === 201, String(keptAugust.status));

  const two = await me.get('/api/statements/kept');
  check('now there are two', two.data.statements.length === 2, String(two.data.statements.length));
  check('and the trend runs oldest first',
    two.data.trend.map((t) => t.periodStart).join(' ') === '2026-07-01 2026-08-01',
    two.data.trend.map((t) => t.periodStart).join(' '));
  check('the two most recent are compared without being asked',
    two.data.latest && two.data.latest.spent.before === 576 && two.data.latest.spent.after === 2382,
    JSON.stringify(two.data.latest?.spent));
  check('a charge in both months is found as recurring, which one statement could not show',
    two.data.recurring.some((r) => r.merchant === 'Netflix'),
    two.data.recurring.map((r) => r.merchant).join(','));

  // --- two named statements against each other ----------------------------
  const against = await me.get(
    `/api/statements/kept/${afterAgain.data.statements[0].id}/against/${keptAugust.data.id}`
  );
  check('any two kept statements can be compared by name',
    against.status === 200 && against.data.spent.after === 2382, JSON.stringify(against.data.spent));

  // --- categories are stored canonically ----------------------------------
  // The reason the whole comparison can be trusted: a category is a join key
  // across months, so what is stored has to be one of a known set rather than
  // whatever spelling a reading reached for.
  const messy = await me.post('/api/statements/kept', {
    account_id: main.id,
    statement: { periodStart: '2026-06-01', periodEnd: '2026-06-30' },
    rows: [
      row('Spinneys', 100, { category: 'groceries' }),
      row('Costa', 40, { category: 'EATING  OUT' }),
      row('Something', 10, { category: 'Other' }),
    ],
  });
  const messyBack = await me.get(`/api/statements/kept/${messy.data.id}`);
  check('a category stored in the wrong case comes back spelled the one way',
    messyBack.data.rows.map((r) => r.category).join(',') === 'Groceries,Eating out,Uncategorised',
    messyBack.data.rows.map((r) => r.category).join(','));

  // --- a statement with no printed period ---------------------------------
  const noPeriod = await me.post('/api/statements/kept', {
    account_id: main.id,
    statement: { periodStart: null, periodEnd: null },
    rows: [
      row('Early', 10, { date: '2026-05-02' }),
      row('Late', 20, { date: '2026-05-29' }),
    ],
  });
  check('a statement printing no period is filed under the span of its own rows',
    noPeriod.status === 201 && noPeriod.data.periodStart === '2026-05-02' &&
      noPeriod.data.periodEnd === '2026-05-29',
    JSON.stringify(noPeriod.data));

  // --- what is refused ----------------------------------------------------
  const noRows = await me.post('/api/statements/kept', { rows: [] });
  check('keeping nothing is refused', noRows.status === 400, String(noRows.status));
  const tooMany = await me.post('/api/statements/kept', {
    rows: Array.from({ length: 2001 }, () => row('X', 1)),
  });
  check('and so is more than any statement holds', tooMany.status === 413, String(tooMany.status));
  const undated = await me.post('/api/statements/kept', {
    statement: {},
    rows: [row('X', 1, { date: 'not a date' })],
  });
  check('a statement with no usable dates at all is refused rather than filed under nothing',
    undated.status === 400, String(undated.status));

  // --- another household cannot see it ------------------------------------
  const other = client();
  await other.post('/api/auth/signup', { username: `kept2_${u}`, password: 'keptpass1234' });
  const otherHh = await other.post('/api/households', { name: 'Theirs', people: ['Them'] });
  other.use(otherHh.data.id);

  const theirs = await other.get('/api/statements/kept');
  check('another household sees none of it', theirs.data.statements.length === 0,
    String(theirs.data.statements.length));
  const peek = await other.get(`/api/statements/kept/${keptAugust.data.id}`);
  check('and cannot read one by its id', peek.status === 404, String(peek.status));
  const steal = await other.del(`/api/statements/kept/${keptAugust.data.id}`);
  check('nor delete one', steal.status === 404, String(steal.status));

  // --- a viewer may read but not keep -------------------------------------
  //
  // This route sits above blockViewerWrites on purpose, because scanning
  // writes nothing and a view-only member should still be able to read a
  // document. Keeping does write, so it carries its own guard — without it
  // the exemption that makes scanning work would hand viewers the store.
  const invite = await me.post(`/api/households/${hh.data.id}/invites`, { role: 'viewer' });
  const guest = client();
  await guest.post('/api/auth/signup', { username: `keptv_${u}`, password: 'keptpass1234' });
  await guest.post('/api/households/accept', { code: invite.data.code });
  guest.use(hh.data.id);

  const guestReads = await guest.get('/api/statements/kept');
  check('a viewer can read what is kept', guestReads.status === 200 && guestReads.data.statements.length > 0,
    String(guestReads.status));
  const guestScans = await guest.post('/api/statements/scan', { text: '   ' });
  check('and is still not refused for scanning, which writes nothing',
    guestScans.status === 400, String(guestScans.status));
  const guestKeeps = await guest.post('/api/statements/kept', july);
  check('but cannot keep one',
    guestKeeps.status === 403 && guestKeeps.data.code === 'VIEW_ONLY', JSON.stringify(guestKeeps.data));
  const guestForgets = await guest.del(`/api/statements/kept/${keptAugust.data.id}`);
  check('and cannot forget one', guestForgets.status === 403, String(guestForgets.status));

  // --- forgetting ---------------------------------------------------------
  const forgotten = await me.del(`/api/statements/kept/${keptAugust.data.id}`);
  check('a statement can be forgotten', forgotten.status === 204, String(forgotten.status));
  const gone = await me.get(`/api/statements/kept/${keptAugust.data.id}`);
  check('and is then unreadable', gone.status === 404, String(gone.status));
  const twice = await me.del(`/api/statements/kept/${keptAugust.data.id}`);
  check('forgetting it again says so rather than pretending', twice.status === 404, String(twice.status));

  report('Keeping statements');
})();
