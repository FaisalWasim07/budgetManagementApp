// The statement scanner. Everything here happens in the browser — the file is
// never posted anywhere and nothing is written down — so a real browser is the
// only place it can be tested at all.
//
// The fixtures beside this file are the four shapes a bank statement arrives
// in: typed, locked, scanned, and one of each in the same document. See
// fixtures/make-fixtures.py for how they are built.
const path = require('path');
const { chromium } = require('playwright');

const URL = process.env.TEST_APP_URL;
const FIXTURES = path.join(__dirname, 'fixtures');
const PASSWORD = 'bayt2026';

const launchOptions = () =>
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

let failed = 0;
let passed = 0;
const check = (name, ok, detail = '') => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` :: ${detail}` : ''}`);
  ok ? (passed += 1) : (failed += 1);
};

(async () => {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage();
  const bad = [];
  page.on('pageerror', (e) => bad.push(e.message));

  // An account of its own, made through the API the setup form posts to. The
  // suites before this one have already claimed the first run, so a first-run
  // form is not there to fill in — and this suite is about statements, not
  // about signing up.
  await page.goto(URL, { waitUntil: 'networkidle' });
  const stamp = Date.now().toString(36).slice(-5);
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [`scan_${stamp}`, 'scanpass1234']
  );
  await page.goto(URL, { waitUntil: 'networkidle' });

  // A new account has no household, so it is asked to make one before there is
  // a Stats screen to reach.
  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Test Home');
  await page.locator('input.person-name').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('.topbar', { timeout: 15000 });
  await page.click('.side-nav button:has-text("Stats")');
  await page.waitForTimeout(500);

  const open = async (name) => {
    await page.click('button:has-text("Scan a statement")');
    await page.waitForSelector('.modal.scanner', { timeout: 10000 });
    await page.setInputFiles('.modal.scanner input[type="file"]', path.join(FIXTURES, name));
  };
  // A no-op when the dialog is already shut, so a section can close up after
  // itself without the next one having to know whether it did.
  const close = async () => {
    if (!(await page.locator('.modal.scanner').count())) return;
    await page.click('.modal.scanner button[aria-label="Close"]');
    await page.waitForTimeout(300);
  };

  // --- where it lives -----------------------------------------------------
  check('Stats carries the scan action', await page.locator('button:has-text("Scan a statement")').count() === 1);
  check('and it is in the top bar rather than a strip of its own',
    await page.locator('#tool-slot button:has-text("Scan a statement")').count() === 1);

  // --- a typed statement --------------------------------------------------
  await open('statement-plain.pdf');
  await page.waitForSelector('.scan-preview', { timeout: 20000 });
  const plain = await page.locator('.scan-preview').textContent();
  check('a typed statement is read straight away', plain.includes('CARREFOUR MALL OF EMIRATES'));
  check('the cryptic descriptors survive exactly as printed', plain.includes('TAP*DUB4471'));
  // The one that matters: pdf.js hands back positioned fragments, and without
  // rebuilding lines from the coordinates every date lands in one run and every
  // amount in another, nowhere near the row they belong to.
  check('a row keeps its date, description and amounts on one line',
    /03 Aug 2026.*TAP\*DUB4471.*28\.00.*12,402\.00/.test(plain),
    (plain.split('\n').find((l) => l.includes('TAP*DUB4471')) || '').trim());
  check('nothing was asked for that was not needed',
    await page.locator('.modal.scanner input[type="password"]').count() === 0);
  check('and nothing is shown as a picture', await page.locator('.scan-page').count() === 0);

  // --- a locked one -------------------------------------------------------
  await close();
  await open('statement-locked.pdf');
  await page.waitForSelector('.modal.scanner input[type="password"]', { timeout: 20000 });
  check('a locked statement asks rather than failing', true);
  check('and says the password stays here',
    (await page.locator('.modal.scanner .field .muted').last().textContent()).includes('not sent anywhere'));
  check('with nothing shown before it opens', await page.locator('.scan-preview').count() === 0);

  await page.fill('.modal.scanner input[type="password"]', 'not-the-one');
  await page.click('.modal.scanner button:has-text("Open it")');
  // Waited for rather than slept through. Opening a PDF to find out the
  // password is wrong takes as long as the machine takes, and a fixed pause
  // long enough on a quiet one is a coin toss on a busy one.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.modal.scanner .field .muted')].some((el) =>
        el.textContent.includes('did not open it')
      ),
    null,
    { timeout: 25000 }
  );
  check('a wrong password is refused, and can be corrected in place', true);
  check('and still shows nothing', await page.locator('.scan-preview').count() === 0);

  await page.fill('.modal.scanner input[type="password"]', PASSWORD);
  await page.click('.modal.scanner button:has-text("Open it")');
  await page.waitForSelector('.scan-preview', { timeout: 20000 });
  const unlocked = await page.locator('.scan-preview').textContent();
  check('the right password opens it', unlocked.includes('CARREFOUR MALL OF EMIRATES'));
  // pdf.js detaches the buffer it is handed, so a retry that reuses the same
  // array reads as an empty file — which looks exactly like a corrupt PDF.
  check('and the retry read the whole file, not an emptied buffer',
    unlocked.includes('OPENING BALANCE') && unlocked.includes('CLOSING BALANCE'));

  // --- a scanned one ------------------------------------------------------
  await close();
  await open('statement-scanned.pdf');
  await page.waitForSelector('.scan-page img', { timeout: 30000 });
  check('a scanned statement shows the page instead of dead-ending',
    await page.locator('.scan-page img').count() === 1);
  check('and says why, once', (await page.locator('.warn-banner').textContent()).includes('scanned'));
  check('with no text preview, because there is no text',
    await page.locator('.scan-preview').count() === 0);
  check('the summary counts it as a scanned page',
    (await page.locator('.scan-summary').textContent()).includes('1 scanned page'));
  const box = await page.locator('.scan-page img').boundingBox();
  check('and the page is really drawn, not a blank element',
    box && box.width > 200 && box.height > 200,
    box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box');

  // --- one of each in the same file ---------------------------------------
  await close();
  await open('statement-mixed.pdf');
  await page.waitForSelector('.scan-page img', { timeout: 30000 });
  check('a mixed statement keeps the text it does have',
    (await page.locator('.scan-preview').textContent()).includes('Transactions overleaf'));
  check('and pictures only the page that had none',
    await page.locator('.scan-page img').count() === 1);
  check('naming which page it was',
    (await page.locator('.scan-page figcaption').textContent()).includes('Page 2'));
  check('and saying some rather than all',
    (await page.locator('.warn-banner').textContent()).includes('Some pages'));

  // --- reading it, which is the only part that leaves the machine ---------
  await close();
  await open('statement-plain.pdf');
  await page.waitForSelector('.scan-preview', { timeout: 20000 });
  const readIt = page.locator('.modal.scanner button:has-text("Read the transactions")');
  check('a statement that has text offers to have it read', await readIt.count() === 1);

  // --- choosing what reads it ----------------------------------------------
  // The list comes from the server, so this also checks the route answers: an
  // empty picker here means /statements/models did not.
  await page.waitForSelector('.scan-model select', { timeout: 10000 });
  const models = page.locator('.scan-model select').first();
  check('there is a choice of what to read it with',
    (await models.locator('option').count()) >= 2,
    String(await models.locator('option').count()));
  check('and each one says what it costs you in plain words',
    (await page.locator('.scan-model .muted').first().textContent()).length > 10,
    await page.locator('.scan-model .muted').first().textContent());

  // Effort is a capability, not a preference: Haiku refuses the field outright,
  // so offering the control beside it would be offering a way to break the scan.
  check('a model that takes an effort offers one',
    (await page.locator('.scan-model select').count()) === 2,
    String(await page.locator('.scan-model select').count()));
  await models.selectOption('claude-haiku-4-5');
  await page
    .waitForFunction(() => document.querySelectorAll('.scan-model select').length === 1, null, {
      timeout: 5000,
    })
    .catch(() => {});
  check('and one that does not, does not',
    (await page.locator('.scan-model select').count()) === 1,
    String(await page.locator('.scan-model select').count()));

  // Whoever scans statements scans them the same way every month.
  await close();
  await open('statement-plain.pdf');
  await page.waitForSelector('.scan-model select', { timeout: 20000 });
  check('the choice is still there next time',
    (await page.locator('.scan-model select').first().inputValue()) === 'claude-haiku-4-5',
    await page.locator('.scan-model select').first().inputValue());
  await page.locator('.scan-model select').first().selectOption('claude-opus-5');
  await page.waitForFunction(
    () => document.querySelectorAll('.scan-model select').length === 2,
    null,
    { timeout: 5000 }
  );
  await page.locator('.scan-model select').nth(1).selectOption('medium');

  // The suites run without a key, so this is what a deployment that has not set
  // one answers. It should name the cause on screen rather than fail as nothing.
  await readIt.click();
  await page.waitForSelector('.modal.scanner .error-text', { timeout: 20000 });
  check('with no key set, the screen says which key is missing',
    (await page.locator('.modal.scanner .error-text').textContent()).includes('ANTHROPIC_API_KEY'),
    await page.locator('.modal.scanner .error-text').textContent());
  // The text is what step one exists to show, and it is what makes the rows
  // checkable afterwards. It was briefly made conditional on having scanned,
  // which hid it exactly when it was most wanted.
  check('and the statement text is still on screen',
    (await page.locator('.scan-preview').textContent()).includes('CARREFOUR'));

  // --- an older iPhone -----------------------------------------------------
  // pdf.js reads text by iterating a ReadableStream with `for await`, which
  // Safari could not do until 17.4. Taking the async iterator away is exactly
  // what an older iPhone looks like, and without the polyfill the read dies
  // with "undefined is not a function" the moment a PDF is picked.
  const old = await browser.newContext();
  const oldPage = await old.newPage();
  const oldBad = [];
  oldPage.on('pageerror', (e) => oldBad.push(e.message));
  await oldPage.addInitScript(() => {
    delete ReadableStream.prototype[Symbol.asyncIterator];
  });
  await oldPage.goto(URL, { waitUntil: 'networkidle' });
  await oldPage.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [`old_${stamp}`, 'oldpass123456']
  );
  await oldPage.goto(URL, { waitUntil: 'networkidle' });
  await oldPage.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await oldPage.fill('input[placeholder="Our household"]', 'Old Phone');
  await oldPage.locator('input.person-name').nth(0).fill('Faisal');
  await oldPage.click('button:has-text("Create household")');
  await oldPage.waitForSelector('.topbar', { timeout: 15000 });
  await oldPage.click('.side-nav button:has-text("Stats")');
  await oldPage.waitForTimeout(500);
  await oldPage.click('button:has-text("Scan a statement")');
  await oldPage.waitForSelector('.modal.scanner', { timeout: 10000 });
  await oldPage.setInputFiles('.modal.scanner input[type="file"]',
    path.join(FIXTURES, 'statement-plain.pdf'));
  await oldPage.waitForSelector('.scan-preview', { timeout: 25000 });
  check('a browser without ReadableStream async iteration still reads a statement',
    (await oldPage.locator('.scan-preview').textContent()).includes('CARREFOUR'));
  check('and does so without an error of its own', oldBad.length === 0, oldBad.join(' | '));
  await old.close();

  // --- the report the scan produces ---------------------------------------
  // The model call is stubbed. What is being checked is the screen: this view
  // only ever appears after a successful scan, so without a stub nothing has
  // ever rendered it, and a mistake in it would first be seen by whoever
  // scanned their statement.
  const stub = (over = {}) => ({
    rows: [
      { date: '2026-08-03', raw: 'TAP*DUB4471 AE', merchant: 'Tap Coffee', what: 'a coffee shop',
        amount: 28, direction: 'out', kind: 'purchase', category: 'Eating out', confidence: 'high' },
      { date: '2026-08-04', raw: 'CARREFOUR MALL', merchant: 'Carrefour', what: 'a supermarket',
        amount: 412.75, direction: 'out', kind: 'purchase', category: 'Groceries', confidence: 'high' },
      { date: '2026-08-11', raw: 'ABU DHABI SERVICE', merchant: 'Abu Dhabi Service', what: 'unclear',
        amount: 1702.96, direction: 'out', kind: 'purchase', category: 'Government', confidence: 'low' },
      { date: '2026-08-01', raw: 'TRANSFER PAYMENT RECEIVED', merchant: 'Card payment', what: 'paying the card',
        amount: 10117.51, direction: 'in', kind: 'payment', category: 'Payment', confidence: 'high' },
    ],
    overview: {
      lines: 4, spent: 2143.71, credited: 10117.51,
      credits: { payments: 10117.51, refunds: 0, cashback: 0, income: 0 },
      from: '2026-08-01', to: '2026-08-11',
    },
    reconciliation: { status: 'ok', closing: 9496.06 },
    categories: [
      { category: 'Government', total: 1702.96, count: 1, average: 1702.96, share: 79.4 },
      { category: 'Groceries', total: 412.75, count: 1, average: 412.75, share: 19.3 },
      { category: 'Eating out', total: 28, count: 1, average: 28, share: 1.3 },
    ],
    findings: {
      duplicates: [{ date: '2026-08-03', merchant: 'Tap Coffee', amount: 28, times: 2, total: 56 }],
      repeats: [{ merchant: 'Spotify', amount: 39, times: 2, total: 78, listed: false, listedAs: null }],
      missingSubscriptions: [{ name: 'Gym', amount: 250 }],
      outliers: [{ date: '2026-08-11', merchant: 'Abu Dhabi Service', category: 'Government',
        amount: 1702.96, typical: 100 }],
      frequent: [{ merchant: 'Tap Coffee', times: 7, total: 196, average: 28 }],
    },
    ...over,
  });

  // Reading and working out are two requests now, so both are answered here.
  // Splitting them is the point: the model writes rows a slice at a time, and
  // the arithmetic runs once over all of them.
  const showReport = async (body) => {
    await close();
    await page.route('**/api/statements/scan', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          rows: body.rows,
          statement: body.statement ?? null,
          // The route prices each slice, because the prices live with it. The
          // browser only ever adds the slices up.
          model: 'claude-opus-5',
          usage: { input: 12000, output: 3000, cacheRead: 9000, cacheWrite: 0 },
          cost: 0.0885,
        }),
      })
    );
    await page.route('**/api/statements/analyse', (r) =>
      r.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          overview: body.overview,
          reconciliation: body.reconciliation,
          categories: body.categories,
          findings: body.findings,
        }),
      })
    );
    await open('statement-plain.pdf');
    await page.waitForSelector('.scan-preview', { timeout: 20000 });
    await page.click('.modal.scanner button:has-text("Read the transactions")');
    await page.waitForSelector('.scan-report', { timeout: 20000 });
  };

  // The app hides every figure each time it opens, because the ledger simply
  // sits there. A scan is the opposite: a file was just chosen and asked to be
  // read. Masking it in that moment is friction with nothing behind it, so the
  // dialog opts out — checked here with the app-wide setting still on, which is
  // the state anybody scanning is in by default.
  await showReport(stub());
  check('the app is still hiding figures everywhere else',
    (await page.locator('button[aria-label="Show amounts"]').count()) === 1);
  check('but a statement you just asked to have read is not masked',
    (await page.locator('.scan-head').textContent()).includes('2,143.71'),
    await page.locator('.scan-head').textContent());
  check('the report says what was spent',
    (await page.locator('.scan-head').textContent()).includes('2,143.71'),
    await page.locator('.scan-head').textContent());
  check('and that the reading adds up',
    (await page.locator('.scan-head .reconciled').count()) === 1);
  // The bug the real statement found: a card payment is not money received.
  check('paying the card off is described as that, not as income',
    (await page.locator('.scan-credits').textContent()).includes('paid off the card'),
    await page.locator('.scan-credits').textContent());

  check('every category is drawn with a bar', (await page.locator('.scan-cat .scan-bar').count()) === 3);
  check('largest first', (await page.locator('.scan-cat b').first().textContent()) === 'Government');
  check('with its share', (await page.locator('.scan-cat').first().textContent()).includes('79.4%'));

  const findingHeads = await page.locator('.scan-findings h3').allTextContents();
  check('all five kinds of finding are shown when all five are found',
    findingHeads.length === 5, JSON.stringify(findingHeads));
  check('an unlisted repeat is named as such',
    findingHeads.some((h) => h.includes('not in your subscriptions')), JSON.stringify(findingHeads));
  check('a duplicate is flagged rather than asserted',
    (await page.locator('.scan-findings').textContent()).includes('Worth a look'));

  // The one part of this app that spends money when a button is pressed.
  // Finding that out from a bill at the end of the month is no way to learn it,
  // so it is on screen the moment the reading finishes.
  const cost = await page.locator('.scan-cost').textContent();
  check('what the reading cost is shown in money, not only in tokens',
    cost.includes('$'), cost);
  check('and it names what actually read the statement', cost.includes('Opus 5'), cost);
  check('with the tokens kept, because they are what explains the money',
    cost.includes('tokens in'), cost);
  check('including what was read back from cache rather than paid for twice',
    cost.includes('from cache'), cost);
  check('and it still says nothing was saved', cost.includes('Nothing has been saved'), cost);

  check('the rows are behind a fold rather than filling the dialog',
    (await page.locator('.scan-rows-toggle summary').textContent()).includes('4'));
  await page.click('.scan-rows-toggle summary');
  check('and open to the line as the bank printed it',
    (await page.locator('.scan-rows .raw').first().textContent()).includes('TAP*DUB4471'));
  check('with a low-confidence line marked',
    (await page.locator('.scan-rows tr.unsure').count()) === 1);

  // --- a reading that does not add up --------------------------------------
  await showReport(stub({
    reconciliation: { status: 'mismatch', expected: 8969.26, closing: 9496.06, delta: -526.8,
      countedTwice: null },
  }));
  const banner = await page.locator('.modal.scanner .warn-banner').textContent();
  check('a reading that does not add up says so before anything else',
    banner.includes('does not add up'), banner.slice(0, 60));
  check('and names the gap', banner.includes('526.8'), banner.slice(0, 200));
  check('and says not to take the figures as fact', banner.includes('not as fact'));
  check('while still showing them', (await page.locator('.scan-cat').count()) === 3);
  await close();
  check('and closing it leaves the rest of the app hidden as it was',
    (await page.locator('button[aria-label="Show amounts"]').count()) === 1);

  await page.unroute('**/api/statements/scan');
  await page.unroute('**/api/statements/analyse');

  // --- a long statement, read in slices ------------------------------------
  // The case that timed out. Ninety transactions asked for in one request means
  // ninety rows written out before anything reaches the browser, which takes
  // minutes and loses the lot. Each request is stubbed here; what is checked is
  // that the work is split at all, and that the rows come back in the order
  // they were printed rather than the order the slices happened to finish in.
  await close();
  let calls = 0;
  const seen = [];
  const asked = [];
  await page.route('**/api/statements/scan', async (route) => {
    calls += 1;
    const body = JSON.parse(route.request().postData());
    asked.push({ model: body.model, effort: body.effort });
    // Answer with whatever merchant numbers this slice actually contains, so
    // assembling them wrongly shows up as wrong order rather than as nothing.
    const found = [...body.text.matchAll(/MERCHANT NUMBER (\d{3})/g)].map((m) => m[1]);
    seen.push(found.length);
    // Slices deliberately finish out of order: the later ones answer first.
    await new Promise((r) => setTimeout(r, found.includes('001') ? 260 : 40));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: found.map((n) => ({
          date: '2026-08-01', raw: `MERCHANT NUMBER ${n}`, merchant: `Merchant ${n}`,
          what: 'a shop', amount: Number(n), direction: 'out', kind: 'purchase',
          category: 'Shopping', confidence: 'high',
        })),
        statement: null,
      }),
    });
  });
  await page.route('**/api/statements/analyse', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        overview: { lines: 90, spent: 1, credited: 0,
          credits: { payments: 0, refunds: 0, cashback: 0, income: 0 }, from: null, to: null },
        reconciliation: { status: 'unchecked' },
        categories: [{ category: 'Shopping', total: 1, count: 90, average: 1, share: 100 }],
        findings: {},
      }),
    })
  );

  await open('statement-long.pdf');
  await page.waitForSelector('.scan-preview', { timeout: 25000 });
  await page.click('.modal.scanner button:has-text("Read the transactions")');
  await page.waitForSelector('.scan-report', { timeout: 40000 });

  check('a long statement is read in more than one request', calls > 1, `${calls} requests`);
  // The picker is only worth having if what it picks is what gets sent — on
  // every slice, not just the first.
  check('what was picked is what every slice is read with',
    asked.every((a) => a.model === 'claude-opus-5' && a.effort === 'medium'),
    JSON.stringify(asked[0]));
  check('and no single request carries the whole thing',
    Math.max(...seen) <= 60, `largest slice: ${Math.max(...seen)} lines`);
  await page.click('.scan-rows-toggle summary');
  const firstRow = await page.locator('.scan-rows .raw').first().textContent();
  const lastRow = await page.locator('.scan-rows .raw').last().textContent();
  check('the rows are assembled in the order they were printed, not the order they returned',
    firstRow.includes('001') && lastRow.includes('090'), `${firstRow} … ${lastRow}`);
  check('and every one of them survived the split',
    (await page.locator('.scan-rows tbody tr').count()) === 90,
    String(await page.locator('.scan-rows tbody tr').count()));

  await page.unroute('**/api/statements/scan');
  await page.unroute('**/api/statements/analyse');

  // --- a slice that dies on the way ----------------------------------------
  // The host stops waiting at sixty seconds and kills the request, which
  // reaches the browser as no reply at all — Safari calls it "Load failed".
  // One of those used to reject the whole reading: seventeen slices that had
  // already come back, and already been charged for, were dropped because the
  // eighteenth never did.
  await close();
  let attempts = 0;
  const slices = new Set();
  let lostRows = 0;
  await page.route('**/api/statements/scan', async (route) => {
    attempts += 1;
    const body = JSON.parse(route.request().postData());
    const found = [...body.text.matchAll(/MERCHANT NUMBER (\d{3})/g)].map((m) => m[1]);
    slices.add(found[0]);
    // The slice carrying 060 is killed every time it is asked for, so it fails
    // its retry too and is genuinely lost. Every other slice answers.
    if (found.includes('060')) {
      lostRows = found.length;
      return route.abort('failed');
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: found.map((n) => ({
          date: '2026-08-01', raw: `MERCHANT NUMBER ${n}`, merchant: `Merchant ${n}`,
          what: 'a shop', amount: Number(n), direction: 'out', kind: 'purchase',
          category: 'Shopping', confidence: 'high',
        })),
        statement: { openingBalance: 0, closingBalance: -4095, periodStart: null, periodEnd: null },
        model: 'claude-opus-5',
        usage: { input: 4000, output: 900, cacheRead: 3000, cacheWrite: 0 },
        cost: 0.01,
      }),
    });
  });
  await page.route('**/api/statements/analyse', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        overview: { lines: 60, spent: 1830, credited: 0,
          credits: { payments: 0, refunds: 0, cashback: 0, income: 0 },
          from: '2026-08-01', to: '2026-08-01' },
        // The rows that did arrive cannot add up to the bank's own closing
        // balance, because some of them were never read.
        reconciliation: { status: 'mismatch', expected: -1830, closing: -4095, delta: 2265,
          countedTwice: null },
        categories: [{ category: 'Shopping', total: 1830, count: 60, average: 30, share: 100 }],
        findings: {},
      }),
    })
  );

  await open('statement-long.pdf');
  await page.waitForSelector('.scan-preview', { timeout: 25000 });
  await page.click('.modal.scanner button:has-text("Read the transactions")');
  await page.waitForSelector('.scan-report', { timeout: 40000 });

  check('one slice dying no longer throws away the whole reading',
    (await page.locator('.scan-rows-toggle summary').count()) === 1,
    await page.locator('.modal.scanner .error-text').textContent().catch(() => 'no report'));
  const partial = await page.locator('.modal.scanner .warn-banner').first().textContent();
  check('and the report says so before anything else',
    partial.includes('could not be read'), partial.slice(0, 80));
  check('naming how much of the statement is missing',
    /\d+ parts? of this statement/.test(partial), partial.slice(0, 80));
  check('and what to do about it', partial.includes('lower effort'), partial.slice(0, 200));

  // A gap it has already explained is not a second, different accusation. The
  // rows that are missing are missing because they were never read, which the
  // banner above already says.
  const banners = await page.locator('.modal.scanner .warn-banner').allTextContents();
  check('an incomplete reading is not also called a misreading',
    !banners.some((b) => b.includes('does not add up')), JSON.stringify(banners.map((b) => b.slice(0, 40))));

  await page.click('.scan-rows-toggle summary');
  const kept = await page.locator('.scan-rows tbody tr').count();
  check('every line that did come back is kept', kept === 90 - lostRows,
    `${kept} kept, ${lostRows} lost, of 90`);
  check('and nothing was invented to fill the gap', kept > 0 && kept < 90, String(kept));
  // Once, then once more. A connection that drops twice will not work on the
  // third attempt, and every attempt is a reading somebody pays for.
  check('the slice that died was asked for twice — not once, and not forever',
    attempts === slices.size + 1, `${attempts} requests for ${slices.size} slices`);

  // --- asking again for only what is missing -------------------------------
  // Re-reading the whole statement to recover one slice means paying for all of
  // it a second time, which on a real statement is most of a dollar to fetch
  // thirty lines.
  const before = attempts;
  await page.unroute('**/api/statements/scan');
  await page.route('**/api/statements/scan', async (route) => {
    attempts += 1;
    const body = JSON.parse(route.request().postData());
    const found = [...body.text.matchAll(/MERCHANT NUMBER (\d{3})/g)].map((m) => m[1]);
    // This time it answers.
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: found.map((n) => ({
          date: '2026-08-01', raw: `MERCHANT NUMBER ${n}`, merchant: `Merchant ${n}`,
          what: 'a shop', amount: Number(n), direction: 'out', kind: 'purchase',
          category: 'Shopping', confidence: 'high',
        })),
        statement: null,
        model: 'claude-opus-5',
        usage: { input: 4000, output: 900, cacheRead: 3000, cacheWrite: 0 },
        cost: 0.01,
      }),
    });
  });

  const readMissing = page.locator('.warn-banner button.link');
  check('the report offers to fetch what it could not read', (await readMissing.count()) === 1);
  await readMissing.click();
  await page.waitForFunction(
    () => !document.querySelector('.modal.scanner .warn-banner button.link'),
    null,
    { timeout: 20000 }
  );
  check('and asks only for the part that was missing, not for the statement again',
    attempts - before === 1, `${attempts - before} requests`);
  // Opened rather than clicked: the fold kept its state across the re-render,
  // so a click here would close it again.
  await page.evaluate(() => document.querySelector('.scan-rows-toggle')?.setAttribute('open', ''));
  const whole = await page.locator('.scan-rows tbody tr').count();
  check('which completes the reading', whole === 90, String(whole));
  check('and the warning about missing parts goes with it',
    !(await page.locator('.modal.scanner').textContent()).includes('could not be read'));
  const firstAfter = await page.locator('.scan-rows .raw').first().textContent();
  const lastAfter = await page.locator('.scan-rows .raw').last().textContent();
  check('with the recovered part put back where it was printed, not on the end',
    firstAfter.includes('001') && lastAfter.includes('090'), `${firstAfter} … ${lastAfter}`);

  await page.unroute('**/api/statements/scan');
  await page.unroute('**/api/statements/analyse');

  check('no page errors throughout', bad.length === 0, bad.join(' | '));

  await browser.close();
  console.log(`\nStatement scanner (browser)\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
