// The statement scanner's server half.
//
// The model call itself is not exercised here: it costs money, needs a key, and
// would make the suite depend on a network service to say whether the app is
// broken. What is worth pinning down is everything around it — who may ask, what
// is refused before a request is ever made, and that the route is honest when
// there is no key rather than failing as something else.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

(async () => {
  const me = client();
  await me.post('/api/auth/signup', { username: `stmt_${u}`, password: 'stmtpass1234' });
  const hh = await me.post('/api/households', { name: 'Statements', people: ['Me'] });
  me.use(hh.data.id);
  const main = (await me.get('/api/accounts')).data[0];

  // --- what is refused without ever reaching the model --------------------
  const empty = await me.post('/api/statements/scan', { text: '   ' });
  check('an empty statement is refused', empty.status === 400, String(empty.status));

  const missing = await me.post('/api/statements/scan', {});
  check('so is one with no text at all', missing.status === 400, String(missing.status));

  const huge = await me.post('/api/statements/scan', { text: 'x'.repeat(400_001) });
  check('and one longer than any real statement', huge.status === 413, String(huge.status));

  // --- no household, no scan ----------------------------------------------
  const stranger = client();
  await stranger.post('/api/auth/signup', { username: `str_${u}`, password: 'strpass12345' });
  const noHousehold = await stranger.post('/api/statements/scan', { text: 'anything' });
  check('somebody with no household is told to make one, not handed a scan',
    noHousehold.status === 409 && noHousehold.data.code === 'NO_HOUSEHOLD',
    `${noHousehold.status} ${JSON.stringify(noHousehold.data)}`);

  // --- a viewer may read a statement --------------------------------------
  // Deliberate, and the reason the route is mounted above blockViewerWrites:
  // scanning is a POST that writes nothing anywhere. View-only access to a
  // household is no reason to refuse somebody a look at their own statement.
  const invite = await me.post(`/api/households/${hh.data.id}/invites`, { role: 'viewer' });
  const viewer = client();
  await viewer.post('/api/auth/signup', { username: `vw_${u}`, password: 'viewpass1234' });
  await viewer.post('/api/households/accept', { code: invite.data.code });
  viewer.use(hh.data.id);

  const viewerWrite = await viewer.post('/api/transactions', {
    account_id: main.id, month: '2026-08', kind: 'expense', amount: 10,
  });
  check('a viewer still cannot write money', viewerWrite.status === 403, String(viewerWrite.status));

  const viewerScan = await viewer.post('/api/statements/scan', { text: 'a statement' });
  check('but is not refused a scan for being a viewer',
    viewerScan.status !== 403, `${viewerScan.status} ${JSON.stringify(viewerScan.data)}`);

  // --- with no key, it says so ---------------------------------------------
  // The suite runs without ANTHROPIC_API_KEY, so this is the answer a fresh
  // deployment gives before anyone has set one. It should name the cause rather
  // than surface as a generic failure.
  if (!process.env.ANTHROPIC_API_KEY) {
    const noKey = await me.post('/api/statements/scan', { text: 'a statement to read' });
    check('with no key set, the route says exactly that',
      noKey.status === 503 && noKey.data.code === 'NO_API_KEY',
      `${noKey.status} ${JSON.stringify(noKey.data)}`);
    check('and says what to do about it',
      String(noKey.data.error).includes('ANTHROPIC_API_KEY'), String(noKey.data.error));
  }

  // --- working out, which needs no model ----------------------------------
  // Split from reading so a long statement can be read a slice at a time
  // without the arithmetic seeing a third of it and calling that a finding.
  const analysed = await me.post('/api/statements/analyse', {
    rows: [
      { date: '2026-08-03', merchant: 'Tap Coffee', amount: 28, direction: 'out',
        kind: 'purchase', category: 'Eating out' },
      { date: '2026-08-04', merchant: 'Carrefour', amount: 72, direction: 'out',
        kind: 'purchase', category: 'Groceries' },
    ],
    statement: { openingBalance: 100, closingBalance: 0, periodStart: null, periodEnd: null },
  });
  check('rows are worked through without a model anywhere near it',
    analysed.status === 200, `${analysed.status} ${JSON.stringify(analysed.data).slice(0, 90)}`);
  check('and the totals are right', analysed.data.overview.spent === 100, String(analysed.data.overview.spent));
  check('with the reading checked against the closing balance',
    analysed.data.reconciliation.status === 'ok', JSON.stringify(analysed.data.reconciliation));
  check('read as a current account, where spending lowers what is there',
    analysed.data.reconciliation.reads === 'account', analysed.data.reconciliation.reads);

  const noRows = await me.post('/api/statements/analyse', {});
  check('nothing to work through is refused', noRows.status === 400, String(noRows.status));

  // Amounts arrive from a browser, which is to say from anywhere.
  const nonsense = await me.post('/api/statements/analyse', {
    rows: [{ date: 'x', merchant: 'y', amount: 'not a number', direction: 'sideways' }],
  });
  check('and a row that is not one is dropped rather than trusted',
    nonsense.status === 200 && nonsense.data.overview.lines === 0,
    JSON.stringify(nonsense.data.overview));

  const { failed } = report('Statement scanning');
  process.exit(failed ? 1 : 0);
})();
