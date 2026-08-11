// One household must not be able to see or touch another's money. That is the
// property this whole file exists to defend: it is enforced by middleware plus
// several dozen correctly-scoped queries, and a single careless WHERE clause
// would undo it silently.
const { client, results, unique } = require('../support/client');

const { check, report } = results();
const u = unique();

(async () => {
  // --- two unrelated people, each with their own household ---------------
  const alice = client();
  const bob = client();

  const a = await alice.post('/api/auth/signup', {
    username: `alice_${u}`,
    password: 'alicepass123',
  });
  const b = await bob.post('/api/auth/signup', {
    username: `bob_${u}`,
    password: 'bobpass12345',
  });
  check('a second person can register', a.status === 201 && b.status === 201, `${a.status}/${b.status}`);

  // Alice has no household yet: the app must say so, not fail obscurely.
  const noHousehold = await alice.get('/api/summary/2026-08');
  check('no household yet is reported as such', noHousehold.data?.code === 'NO_HOUSEHOLD', JSON.stringify(noHousehold.data));

  const ah = await alice.post('/api/households', { name: 'Alice Home', people: ['Alice', 'Partner'] });
  const bh = await bob.post('/api/households', { name: 'Bob Home', people: ['Bob'] });
  alice.use(ah.data.id);
  bob.use(bh.data.id);
  check('creating a household seeds its people and accounts', ah.status === 201 && bh.status === 201);

  const aAccounts = (await alice.get('/api/accounts')).data;
  const bAccounts = (await bob.get('/api/accounts')).data;
  check('each household starts with an account per person', aAccounts.length === 2 && bAccounts.length === 1,
    `${aAccounts.length}/${bAccounts.length}`);

  // --- money in Alice's household ---------------------------------------
  await alice.post('/api/transactions', {
    account_id: aAccounts[0].id, month: '2026-08', kind: 'income', amount: 12345, description: 'Salary',
  });

  const aSummary = (await alice.get('/api/summary/2026-08')).data;
  const bSummary = (await bob.get('/api/summary/2026-08')).data;
  check('Alice sees her own income', aSummary.household.income === 12345, String(aSummary.household.income));
  check("Bob sees nothing of Alice's income", bSummary.household.income === 0, String(bSummary.household.income));
  check('Bob sees only his own people', bSummary.persons.length === 1 && bSummary.persons[0].name === 'Bob');

  // --- the important part: Bob reaching for Alice's rows -----------------
  const aAccountId = aAccounts[0].id;

  bob.use(ah.data.id); // claim Alice's household by id
  const stolen = await bob.get('/api/summary/2026-08');
  check("claiming another household's id is refused", stolen.status === 404, String(stolen.status));
  bob.use(bh.data.id);

  const readAcross = await bob.get(`/api/transactions?accountId=${aAccountId}`);
  check("filtering by another household's account returns nothing",
    readAcross.status === 200 && readAcross.data.length === 0, JSON.stringify(readAcross.data).slice(0, 80));

  const writeAcross = await bob.post('/api/transactions', {
    account_id: aAccountId, month: '2026-08', kind: 'expense', amount: 999,
  });
  check("writing into another household's account is refused", writeAcross.status === 404, String(writeAcross.status));

  const patchAcross = await bob.patch(`/api/accounts/${aAccountId}`, { name: 'Hacked' });
  check("editing another household's account is refused", patchAcross.status === 404, String(patchAcross.status));

  const deleteAcross = await bob.del(`/api/accounts/${aAccountId}`);
  check("deleting another household's account is refused", deleteAcross.status === 404, String(deleteAcross.status));

  const transferAcross = await bob.post('/api/transactions/transfer', {
    from_account_id: bAccounts[0].id, to_account_id: aAccountId, month: '2026-08', amount: 1,
  });
  check('transferring into another household is refused', transferAcross.status === 404, String(transferAcross.status));

  const subAcross = await bob.post('/api/subscriptions', {
    account_id: aAccountId, name: 'Sneaky', amount: 10, cycle: 'monthly', start_month: '2026-08',
  });
  check("subscribing another household's account is refused", subAcross.status === 404, String(subAcross.status));

  // Alice's account is untouched by all of that.
  const aAfter = (await alice.get('/api/accounts')).data.find((x) => x.id === aAccountId);
  check('Alice’s account survived every attempt', aAfter && aAfter.name === aAccounts[0].name && aAfter.is_active === 1);

  // --- settings belong to a household, not to the app --------------------
  await alice.put('/api/settings', { primary_currency: 'GBP' });
  const aliceSettings = (await alice.get('/api/settings')).data;
  const bobSettings = (await bob.get('/api/settings')).data;
  check('a household can choose its own primary currency',
    aliceSettings.primary_currency === 'GBP', aliceSettings.primary_currency);
  check("and it does not change anyone else's",
    bobSettings.primary_currency === 'AED', bobSettings.primary_currency);

  await alice.put('/api/settings', { manualRates: { PKR: 0.0131 } });
  check('a manual rate is private to the household',
    Object.keys((await bob.get('/api/settings')).data.manualRates).length === 0,
    JSON.stringify((await bob.get('/api/settings')).data.manualRates));

  await alice.put('/api/settings', { primary_currency: 'AED' });

  // --- invites and roles -------------------------------------------------
  const invite = await alice.post(`/api/households/${ah.data.id}/invites`, { role: 'viewer' });
  check('an owner can create an invite', invite.status === 201 && Boolean(invite.data.code), String(invite.status));

  const bobNotOwner = await bob.post(`/api/households/${ah.data.id}/invites`, { role: 'owner' });
  check('a non-member cannot create invites for that household', bobNotOwner.status === 404, String(bobNotOwner.status));

  const accepted = await bob.post('/api/households/accept', { code: invite.data.code });
  check('the invite is accepted', accepted.status === 200 && accepted.data.role === 'viewer', JSON.stringify(accepted.data));

  const reused = await bob.post('/api/households/accept', { code: invite.data.code });
  check('an invite cannot be used twice', reused.status === 400, String(reused.status));

  bob.use(ah.data.id);
  const bobReads = await bob.get('/api/summary/2026-08');
  check('a viewer can now read the household', bobReads.status === 200 && bobReads.data.household.income === 12345);

  const bobWrites = await bob.post('/api/transactions', {
    account_id: aAccountId, month: '2026-08', kind: 'expense', amount: 50,
  });
  check('a viewer cannot write', bobWrites.status === 403 && bobWrites.data.code === 'VIEW_ONLY',
    `${bobWrites.status} ${JSON.stringify(bobWrites.data)}`);

  const bobDeletes = await bob.del(`/api/accounts/${aAccountId}`);
  check('a viewer cannot delete', bobDeletes.status === 403, String(bobDeletes.status));

  // A viewer joining still gets to exist as a person, if the owner adds them.
  bob.use(bh.data.id);

  // --- owner protections -------------------------------------------------
  alice.use(ah.data.id);
  const demoteSelf = await alice.patch(`/api/households/${ah.data.id}/members/${a.data.user.id}`, { role: 'viewer' });
  check('the last owner cannot demote themselves', demoteSelf.status === 400, String(demoteSelf.status));

  const promoted = await alice.patch(`/api/households/${ah.data.id}/members/${b.data.user.id}`, { role: 'editor' });
  check('an owner can change a member’s role', promoted.status === 200 && promoted.data.role === 'editor');

  bob.use(ah.data.id);
  const bobNowWrites = await bob.post('/api/transactions', {
    account_id: aAccountId, month: '2026-08', kind: 'expense', amount: 50,
  });
  check('promoted to editor, the same person can write', bobNowWrites.status === 201, String(bobNowWrites.status));

  const author = (await bob.get('/api/transactions?month=2026-08')).data.find((t) => t.amount === 50);
  check('the entry records who added it', author?.created_by_username === `bob_${u}`, String(author?.created_by_username));
  check('the entry records when it was added', Boolean(author?.created_at));

  // --- adding someone directly, the husband-and-wife case -----------------
  const partner = client();
  alice.use(ah.data.id);
  const added = await alice.post(`/api/households/${ah.data.id}/members`, {
    username: `partner_${u}`, password: 'partnerpass1', role: 'editor',
  });
  check('an owner can add someone with a login in one step', added.status === 201, JSON.stringify(added.data));

  const withPartner = (await alice.get('/api/summary/2026-08')).data;
  const partnerPerson = withPartner.persons.find((p) => p.name === `partner_${u}`);
  check('the added person appears with their own account',
    Boolean(partnerPerson) && partnerPerson.accounts.length === 1,
    JSON.stringify(withPartner.persons.map((p) => p.name)));

  const partnerLogin = await partner.post('/api/auth/login', {
    username: `partner_${u}`, password: 'partnerpass1',
  });
  check('they can sign in with the login that was made for them', partnerLogin.status === 200);
  const partnerHouseholds = (await partner.get('/api/households')).data;
  check('and they land straight in the household',
    partnerHouseholds.length === 1 && partnerHouseholds[0].id === ah.data.id,
    JSON.stringify(partnerHouseholds));
  partner.use(ah.data.id);
  const partnerWrites = await partner.post('/api/transactions', {
    account_id: aAccountId, month: '2026-08', kind: 'expense', amount: 12,
  });
  check('and can record money right away', partnerWrites.status === 201, String(partnerWrites.status));

  const dup = await alice.post(`/api/households/${ah.data.id}/members`, {
    username: `partner_${u}`, password: 'x',
  });
  check('adding the same person twice is refused', dup.status === 409, String(dup.status));

  // --- leaving ------------------------------------------------------------
  const left = await bob.del(`/api/households/${ah.data.id}/members/${b.data.user.id}`);
  check('a member can leave a household', left.status === 204, String(left.status));
  bob.use(ah.data.id);
  const afterLeaving = await bob.get('/api/summary/2026-08');
  check('after leaving, the household is gone from view', afterLeaving.status === 404, String(afterLeaving.status));

  const { failed } = report('Household isolation');
  process.exit(failed ? 1 : 0);
})();
