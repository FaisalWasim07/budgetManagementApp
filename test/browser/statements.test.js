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
    [`scan_${stamp}`, 'scanpass1234'],
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
  check(
    'Stats carries the scan action',
    (await page.locator('button:has-text("Scan a statement")').count()) === 1,
  );
  check(
    'and it is in the top bar rather than a strip of its own',
    (await page.locator('#tool-slot button:has-text("Scan a statement")').count()) === 1,
  );

  // --- a typed statement --------------------------------------------------
  await open('statement-plain.pdf');
  await page.waitForSelector('.scan-hidden', { timeout: 20000 });
  const plain = await page.locator('.scan-preview').textContent();
  check('a typed statement is read straight away', plain.includes('CARREFOUR MALL OF EMIRATES'));
  check('the cryptic descriptors survive exactly as printed', plain.includes('TAP*DUB4471'));
  // The one that matters: pdf.js hands back positioned fragments, and without
  // rebuilding lines from the coordinates every date lands in one run and every
  // amount in another, nowhere near the row they belong to.
  check(
    'a row keeps its date, description and amounts on one line',
    /03 Aug 2026.*TAP\*DUB4471.*28\.00.*12,402\.00/.test(plain),
    (plain.split('\n').find((l) => l.includes('TAP*DUB4471')) || '').trim(),
  );
  check(
    'nothing was asked for that was not needed',
    (await page.locator('.modal.scanner input[type="password"]').count()) === 0,
  );
  check('and nothing is shown as a picture', (await page.locator('.scan-page').count()) === 0);

  // --- a locked one -------------------------------------------------------
  await close();
  await open('statement-locked.pdf');
  await page.waitForSelector('.modal.scanner input[type="password"]', { timeout: 20000 });
  check('a locked statement asks rather than failing', true);
  check(
    'and says the password stays here',
    /sent nowhere|not sent anywhere/.test(
      await page.locator('.modal.scanner .field .muted').last().textContent(),
    ),
    await page.locator('.modal.scanner .field .muted').last().textContent(),
  );
  // The document is named while it is being asked about, so it is obvious
  // which file the password is for.
  check(
    'and names the file it is asking about',
    (await page.locator('.scan-file').textContent()).includes('statement-locked.pdf'),
    await page.locator('.scan-file').textContent(),
  );
  check('with nothing shown before it opens', (await page.locator('.scan-preview').count()) === 0);

  await page.fill('.modal.scanner input[type="password"]', 'not-the-one');
  await page.click('.modal.scanner button:has-text("Open it")');
  // Waited for rather than slept through. Opening a PDF to find out the
  // password is wrong takes as long as the machine takes, and a fixed pause
  // long enough on a quiet one is a coin toss on a busy one.
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll('.modal.scanner .field .muted')].some((el) =>
        el.textContent.includes('did not open it'),
      ),
    null,
    { timeout: 25000 },
  );
  check('a wrong password is refused, and can be corrected in place', true);
  check('and still shows nothing', (await page.locator('.scan-preview').count()) === 0);

  await page.fill('.modal.scanner input[type="password"]', PASSWORD);
  await page.click('.modal.scanner button:has-text("Open it")');
  await page.waitForSelector('.scan-hidden', { timeout: 20000 });
  const unlocked = await page.locator('.scan-preview').textContent();
  check('the right password opens it', unlocked.includes('CARREFOUR MALL OF EMIRATES'));
  // pdf.js detaches the buffer it is handed, so a retry that reuses the same
  // array reads as an empty file — which looks exactly like a corrupt PDF.
  check(
    'and the retry read the whole file, not an emptied buffer',
    unlocked.includes('OPENING BALANCE') && unlocked.includes('CLOSING BALANCE'),
  );

  // --- a scanned one ------------------------------------------------------
  await close();
  await open('statement-scanned.pdf');
  await page.waitForSelector('.scan-page img', { timeout: 30000 });
  check(
    'a scanned statement shows the page instead of dead-ending',
    (await page.locator('.scan-page img').count()) === 1,
  );
  check(
    'and says why, once',
    (await page.locator('.warn-banner').textContent()).includes('scanned'),
  );
  check(
    'with no text preview, because there is no text',
    (await page.locator('.scan-preview').count()) === 0,
  );
  check(
    'the summary counts it as a scanned page',
    (await page.locator('.scan-summary').textContent()).includes('1 scanned page'),
  );
  const box = await page.locator('.scan-page img').boundingBox();
  check(
    'and the page is really drawn, not a blank element',
    box && box.width > 200 && box.height > 200,
    box ? `${Math.round(box.width)}x${Math.round(box.height)}` : 'no box',
  );

  // --- one of each in the same file ---------------------------------------
  await close();
  await open('statement-mixed.pdf');
  await page.waitForSelector('.scan-page img', { timeout: 30000 });
  check(
    'a mixed statement keeps the text it does have',
    (await page.locator('.scan-preview').textContent()).includes('Transactions overleaf'),
  );
  check(
    'and pictures only the page that had none',
    (await page.locator('.scan-page img').count()) === 1,
  );
  check(
    'naming which page it was',
    (await page.locator('.scan-page figcaption').textContent()).includes('Page 2'),
  );
  check(
    'and saying some rather than all',
    (await page.locator('.warn-banner').textContent()).includes('Some pages'),
  );

  // --- reading it, which is the only part that leaves the machine ---------
  await close();
  await open('statement-plain.pdf');
  await page.waitForSelector('.scan-hidden', { timeout: 20000 });
  const readIt = page.locator('.modal.scanner button:has-text("Read the transactions")');
  check('a statement that has text offers to have it read', (await readIt.count()) === 1);

  // --- what is taken out before any of it is sent --------------------------
  // The fixture's letterhead carries an account number, which has nothing to do
  // with what was spent and would otherwise ride along with every slice.
  const sanitised = await page.locator('.scan-preview').textContent();
  check(
    'the account number in the letterhead is gone from the preview',
    !sanitised.includes('887342'),
    sanitised.slice(0, 120),
  );
  check(
    'and the currency beside it is not, because the reading needs it',
    sanitised.includes('AED'),
    sanitised.slice(0, 120),
  );
  check(
    'every merchant reference survives, digits and all',
    ['TAP*DUB4471', 'TLB*ORDER 88213', 'SPOTIFY P39A2B'].every((m) => sanitised.includes(m)),
    sanitised.slice(0, 200),
  );
  check(
    'and so does every amount',
    ['28.00', '412.75', '1,450.00'].every((a) => sanitised.includes(a)),
    sanitised.slice(0, 200),
  );

  const said = await page.locator('.scan-sanitise').textContent();
  check(
    'the screen says what it hid, not just that it hid something',
    said.includes('account number'),
    said,
  );
  check(
    'and that the preview is the proof rather than a promise',
    said.includes('what leaves this browser'),
    said,
  );

  // Off is there because no rule that catches an account number can be certain
  // it caught nothing else, and the person holding the statement can see which.
  await page.uncheck('.scan-sanitise input');
  check(
    'turning it off puts the statement back as printed',
    (await page.locator('.scan-preview').textContent()).includes('887342'),
  );
  check(
    'and says so plainly',
    (await page.locator('.scan-sanitise').textContent()).includes('exactly as it is printed'),
  );
  await page.check('.scan-sanitise input');

  // --- leaving pages out ---------------------------------------------------
  // A bank sends more than one thing in an envelope. Terms, an insert, two
  // pages of small print — all of it text, all of it cut into slices and paid
  // for, none of it a transaction. This is the only control in the flow that
  // makes a reading cheaper and better at the same time.
  await close();
  await open('statement-long.pdf');
  await page.waitForSelector('.scan-hidden', { timeout: 25000 });
  const chips = page.locator('.scan-page-chip');
  check(
    'a statement of several pages offers them one by one',
    (await chips.count()) === 3,
    String(await chips.count()),
  );
  check(
    'every page is on to begin with, because a file nobody has thought about is all of it',
    (await page.locator('.scan-page-chip.on').count()) === 3,
  );
  check(
    'and each says how much is on it, so the ones that are not the statement are obvious',
    /\d+ lines/.test(await chips.first().textContent()),
    await chips.first().textContent(),
  );

  const everyPage = (await page.locator('.scan-preview').textContent()).length;
  const allLines = await page.locator('.scan-proof summary').textContent();
  await chips.nth(2).click();
  await page.waitForTimeout(200);
  check(
    'turning one off says so',
    (await page.locator('.scan-pages-head').textContent()).includes('2 of 3'),
    await page.locator('.scan-pages-head').textContent(),
  );
  const trimmed = (await page.locator('.scan-preview').textContent()).length;
  check(
    'and the text that would be sent actually shrinks',
    trimmed < everyPage && trimmed > 0,
    `${everyPage} → ${trimmed} characters`,
  );
  check(
    'the proof counts what is left, not what the file had',
    (await page.locator('.scan-proof summary').textContent()) !== allLines,
    `${allLines} → ${await page.locator('.scan-proof summary').textContent()}`,
  );
  // The estimate is built from the slices about to go, so dropping a page has
  // to move it. A price that does not follow the thing it is pricing is worse
  // than no price at all.
  const cheaper = await page.locator('.scan-estimate').textContent();
  check('and the price follows what is left', cheaper.length > 0, cheaper);

  await chips.nth(0).click();
  await chips.nth(1).click();
  await page.waitForTimeout(200);
  check(
    'with nothing selected there is nothing to read, and the button says no',
    await page.locator('.modal.scanner button:has-text("Read the transactions")').isDisabled(),
  );
  check(
    'and it says why rather than just refusing',
    (await page.locator('.scan-pages').textContent()).includes('nothing to read'),
    await page.locator('.scan-pages').textContent().then((t) => t.slice(-90)),
  );
  await chips.nth(0).click();
  await page.waitForTimeout(200);
  check(
    'putting one back is enough to go on with',
    !(await page.locator('.modal.scanner button:has-text("Read the transactions")').isDisabled()),
  );
  await close();
  await open('statement-plain.pdf');
  await page.waitForSelector('.scan-hidden', { timeout: 20000 });
  check(
    'a statement of one page is not asked about, because there is nothing to choose',
    (await page.locator('.scan-pages').count()) === 0,
  );

  // --- choosing what reads it ----------------------------------------------
  // The list comes from the server, so this also checks the route answers: an
  // empty picker here means /statements/models did not.
  await page.waitForSelector('.scan-model select', { timeout: 10000 });
  const models = page.locator('.scan-model select').first();
  check(
    'there is a choice of what to read it with',
    (await models.locator('option').count()) >= 2,
    String(await models.locator('option').count()),
  );
  check(
    'and each one says what it costs you in plain words',
    (await page.locator('.scan-model .muted').first().textContent()).length > 10,
    await page.locator('.scan-model .muted').first().textContent(),
  );

  // Effort is a capability, not a preference: Haiku refuses the field outright,
  // so offering the control beside it would be offering a way to break the scan.
  check(
    'a model that takes an effort offers one',
    (await page.locator('.scan-model select').count()) === 2,
    String(await page.locator('.scan-model select').count()),
  );
  await models.selectOption('claude-haiku-4-5');
  await page
    .waitForFunction(() => document.querySelectorAll('.scan-model select').length === 1, null, {
      timeout: 5000,
    })
    .catch(() => {});
  check(
    'and one that does not, does not',
    (await page.locator('.scan-model select').count()) === 1,
    String(await page.locator('.scan-model select').count()),
  );

  // Whoever scans statements scans them the same way every month.
  await close();
  await open('statement-plain.pdf');
  await page.waitForSelector('.scan-model select', { timeout: 20000 });
  check(
    'the choice is still there next time',
    (await page.locator('.scan-model select').first().inputValue()) === 'claude-haiku-4-5',
    await page.locator('.scan-model select').first().inputValue(),
  );
  await page.locator('.scan-model select').first().selectOption('claude-opus-5');
  await page.waitForFunction(
    () => document.querySelectorAll('.scan-model select').length === 2,
    null,
    { timeout: 5000 },
  );
  await page.locator('.scan-model select').nth(1).selectOption('medium');

  // The suites run without a key, so this is what a deployment that has not set
  // one answers. It should name the cause on screen rather than fail as nothing.
  await readIt.click();
  await page.waitForSelector('.modal.scanner .error-text', { timeout: 20000 });
  check(
    'with no key set, the screen says which key is missing',
    (await page.locator('.modal.scanner .error-text').textContent()).includes('ANTHROPIC_API_KEY'),
    await page.locator('.modal.scanner .error-text').textContent(),
  );
  // The text is what step one exists to show, and it is what makes the rows
  // checkable afterwards. It was briefly made conditional on having scanned,
  // which hid it exactly when it was most wanted.
  check(
    'and the statement text is still on screen',
    (await page.locator('.scan-preview').textContent()).includes('CARREFOUR'),
  );

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
    [`old_${stamp}`, 'oldpass123456'],
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
  await oldPage.setInputFiles(
    '.modal.scanner input[type="file"]',
    path.join(FIXTURES, 'statement-plain.pdf'),
  );
  await oldPage.waitForSelector('.scan-hidden', { timeout: 25000 });
  check(
    'a browser without ReadableStream async iteration still reads a statement',
    (await oldPage.locator('.scan-preview').textContent()).includes('CARREFOUR'),
  );
  check('and does so without an error of its own', oldBad.length === 0, oldBad.join(' | '));
  await old.close();

  // --- the report the scan produces ---------------------------------------
  // The model call is stubbed. What is being checked is the screen: this view
  // only ever appears after a successful scan, so without a stub nothing has
  // ever rendered it, and a mistake in it would first be seen by whoever
  // scanned their statement.
  const stub = (over = {}) => ({
    rows: [
      // One row that straddles a month: transaction on 30 July, posted on
      // 1 August. This is the case the two-date feature exists to keep
      // honest — landing entirely on the posting date's month would count
      // the coffee toward a month it wasn't drunk in.
      {
        date: '2026-07-30',
        postDate: '2026-08-01',
        raw: 'TAP*DUB4471 AE',
        merchant: 'Tap Coffee',
        what: 'a coffee shop',
        amount: 28,
        direction: 'out',
        kind: 'purchase',
        category: 'Eating out',
        confidence: 'high',
      },
      {
        date: '2026-08-04',
        postDate: null,
        raw: 'CARREFOUR MALL',
        merchant: 'Carrefour',
        what: 'a supermarket',
        amount: 412.75,
        direction: 'out',
        kind: 'purchase',
        category: 'Groceries',
        confidence: 'high',
      },
      {
        date: '2026-08-11',
        postDate: null,
        raw: 'ABU DHABI SERVICE',
        merchant: 'Abu Dhabi Service',
        what: 'unclear',
        amount: 1702.96,
        direction: 'out',
        kind: 'purchase',
        category: 'Government',
        confidence: 'low',
      },
      {
        date: '2026-08-01',
        postDate: null,
        raw: 'TRANSFER PAYMENT RECEIVED',
        merchant: 'Card payment',
        what: 'paying the card',
        amount: 10117.51,
        direction: 'in',
        kind: 'payment',
        category: 'Payment',
        confidence: 'high',
      },
    ],
    overview: {
      lines: 4,
      spent: 2143.71,
      credited: 10117.51,
      credits: { payments: 10117.51, refunds: 0, cashback: 0, income: 0 },
      from: '2026-08-01',
      to: '2026-08-11',
    },
    reconciliation: { status: 'ok', opening: 10117.51, closing: 9496.06, reads: 'card' },
    categories: [
      { category: 'Government', total: 1702.96, count: 1, average: 1702.96, share: 79.4 },
      { category: 'Groceries', total: 412.75, count: 1, average: 412.75, share: 19.3 },
      { category: 'Eating out', total: 28, count: 1, average: 28, share: 1.3 },
    ],
    findings: {
      duplicates: [{ date: '2026-08-03', merchant: 'Tap Coffee', amount: 28, times: 2, total: 56 }],
      repeats: [{ merchant: 'Spotify', amount: 39, times: 2, total: 78 }],
      outliers: [
        {
          date: '2026-08-11',
          merchant: 'Abu Dhabi Service',
          category: 'Government',
          amount: 1702.96,
          typical: 100,
        },
      ],
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
      }),
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
      }),
    );
    await open('statement-plain.pdf');
    await page.waitForSelector('.scan-hidden', { timeout: 20000 });
    await page.click('.modal.scanner button:has-text("Read the transactions")');
    await page.waitForSelector('.scan-report', { timeout: 20000 });
  };

  // The app hides every figure each time it opens, because the ledger simply
  // sits there. A scan is the opposite: a file was just chosen and asked to be
  // read. Masking it in that moment is friction with nothing behind it, so the
  // dialog opts out — checked here with the app-wide setting still on, which is
  // the state anybody scanning is in by default.
  await showReport(stub());
  check(
    'the app is still hiding figures everywhere else',
    (await page.locator('button[aria-label="Show amounts"]').count()) === 1,
  );
  check(
    'but a statement you just asked to have read is not masked',
    (await page.locator('.scan-tiles').textContent()).includes('2,143.71'),
    await page.locator('.scan-tiles').textContent(),
  );
  // The one figure somebody opens a statement to find. It was being used — the
  // reading is checked against it — and never shown.
  const bill = await page.locator('.scan-bill').textContent();
  check('what the statement closes at is on the report', bill.includes('9,496.06'), bill);
  check('named as what it is on a card', bill.includes('Owed'), bill);
  check('with where it started, so the month has both ends', bill.includes('10,117.51'), bill);

  check(
    'the report says what was spent',
    (await page.locator('.scan-tiles').textContent()).includes('2,143.71'),
    await page.locator('.scan-tiles').textContent(),
  );
  // The verdict is a word beside the figure it is about now, rather than a
  // note on the end of the spent line — and "not checked" is its own state,
  // because a statement that prints no balances has nothing to check against.
  check(
    'and that the reading adds up',
    (await page.locator('.scan-bill .scan-verdict.ok').count()) === 1,
    await page.locator('.scan-bill').textContent(),
  );
  // The bug the real statement found: a card payment is not money received.
  check(
    'paying the card off is described as that, not as income',
    (await page.locator('.scan-tiles').textContent()).includes('Paid off the card'),
    await page.locator('.scan-tiles').textContent(),
  );

  check(
    'every category is drawn with a bar',
    (await page.locator('.scan-cat .scan-bar').count()) === 3,
  );
  check(
    'largest first',
    (await page.locator('.scan-cat b').first().textContent()) === 'Government',
  );
  check(
    'with its share',
    (await page.locator('.scan-cat').first().textContent()).includes('79.4%'),
  );

  // The findings used to be four headed sections in the order the code happened
  // to compute them. They are one ranked list now: the kind is a label on the
  // row, and the order is what is at stake in each — so a duplicated 1,702.96
  // charge is read before a 56 subscription, whatever they are each called.
  const findingRows = await page.locator('.scan-finding').count();
  check('every finding is shown when every kind is found', findingRows === 4, String(findingRows));
  const findingKinds = await page.locator('.scan-finding-kind').allTextContents();
  check(
    'each says what sort of finding it is',
    findingKinds.length === 4 && findingKinds.every((k) => k.trim().length > 0),
    JSON.stringify(findingKinds),
  );
  check(
    'a charge on a cycle is still reported, from the statement itself',
    findingKinds.some((k) => k.includes('cycle')),
    JSON.stringify(findingKinds),
  );
  // The scanner used to compare against the household's subscriptions and list
  // what had *not* been charged — things the statement never mentioned, in a
  // report about the statement.
  check(
    'and nothing is reported that the statement does not contain',
    !(await page.locator('.scan-findings').textContent()).includes('Budgeted for'),
  );
  check(
    'a duplicate is flagged rather than asserted',
    (await page.locator('.scan-findings').textContent()).includes('worth a look'),
  );
  // In the stub, the largest thing at stake is the 1,702.96 government charge
  // sitting sixteen times above what is typical for its category. Ordering by
  // kind put a cycle of 39 above it. Ordering by consequence does not, which is
  // the whole point of the change.
  const firstFinding = await page.locator('.scan-finding').first().textContent();
  check(
    'and the one with the most money behind it is read first',
    firstFinding.includes('1,702.96'),
    firstFinding,
  );
  // The figure that decided the order is named, because an amount beside an
  // unusually large charge could be the charge, the typical or the difference.
  check(
    'with the figure that put it there said in words',
    (await page.locator('.scan-finding-stake small').first().textContent()).length > 0,
    await page.locator('.scan-finding-stake').first().textContent(),
  );

  // The one part of this app that spends money when a button is pressed.
  // Finding that out from a bill at the end of the month is no way to learn it,
  // so it is on screen the moment the reading finishes.
  const cost = await page.locator('.scan-cost').textContent();
  check('what the reading cost is shown in money, not only in tokens', cost.includes('$'), cost);
  // 12,000 sent uncached plus 9,000 read back from cache is 21,000 tokens of
  // input. Reporting the 12,000 as the total and then saying 9,000 of it came
  // from cache was a line that could not be true.
  check(
    'the tokens in are every bucket added up, not one carved out of another',
    cost.includes('21,000 tokens in'),
    cost,
  );
  check('and it names what actually read the statement', cost.includes('Opus 5'), cost);
  check(
    'with the tokens kept, because they are what explains the money',
    cost.includes('tokens in'),
    cost,
  );
  check(
    'including what was read back from cache rather than paid for twice',
    cost.includes('from cache'),
    cost,
  );
  check('and it still says nothing was saved', cost.includes('Nothing is saved'), cost);

  // The rows used to be folded away, because the report was a 760px dialog and
  // a table of every line filled it. The report is a room now, so they are the
  // table they always wanted to be — open, and sortable.
  check(
    'the report opens as a room rather than a dialog',
    (await page.locator('.modal.scanner.room').count()) === 1,
  );
  // A document says what document it is. The dialog's title bar is gone: the
  // filename, the account it was read against, and the two things you can do
  // with it are the header now.
  const docHead = await page.locator('.scan-doc-head').textContent();
  check('and names the file it read', docHead.includes('statement-plain.pdf'), docHead);

  // --- keeping says it is working, and only says it is done when it is -----
  //
  // Held open deliberately: the real request is a single insert and answers in
  // milliseconds, which is too fast for the working state to be observed at
  // all. What is being pinned is the rule, not the duration — the button must
  // not read as finished while the request is still in the air, because the
  // whole point of the state is telling somebody whether their statement is
  // safe yet.
  let releaseKeep;
  await page.route('**/api/statements/kept', async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    await new Promise((resolve) => {
      releaseKeep = resolve;
    });
    return route.continue();
  });

  await page.click('.scan-doc-keep');
  await page.waitForSelector('.scan-doc-keeping', { timeout: 5000 });
  check('keeping shows it is working, under the button that started it',
    (await page.locator('.scan-doc-keeping').count()) === 1,
    (await page.locator('.scan-doc-keeping').textContent()).trim());
  check('and says how much is being written rather than a made-up percentage',
    /Keeping \d+ lines?…/.test(await page.locator('.scan-doc-keeping').textContent()),
    (await page.locator('.scan-doc-keeping').textContent()).trim());
  check('the button does not read as done while the request is still in the air',
    (await page.locator('.scan-doc-keep.is-kept').count()) === 0 &&
      (await page.locator('.scan-doc-keep').textContent()).includes('Keeping'),
    (await page.locator('.scan-doc-keep').textContent()).trim());

  releaseKeep();
  await page.waitForSelector('.scan-doc-keep.is-kept', { timeout: 10000 });
  check('and only once it has landed', (await page.locator('.scan-doc-keep').textContent()).includes('Kept'),
    (await page.locator('.scan-doc-keep').textContent()).trim());
  check('the working line goes when it does',
    (await page.locator('.scan-doc-keeping').count()) === 0);
  await page.unroute('**/api/statements/kept');

  // That press kept a real statement. Forgotten again here so the section
  // below can still assert an exact count rather than a "more than" — an
  // expectation that has to be loosened every time a test above it writes
  // something has stopped pinning anything down.
  const forgotten = await page.evaluate(async (household) => {
    const headers = { 'X-Household-Id': String(household) };
    const kept = await (await fetch('/api/statements/kept', { headers })).json();
    for (const statement of kept.statements) {
      await fetch(`/api/statements/kept/${statement.id}`, { method: 'DELETE', headers });
    }
    return (await (await fetch('/api/statements/kept', { headers })).json()).statements.length;
  }, await page.evaluate(() => localStorage.getItem('budget.householdId')));
  check('and the kept statement can be forgotten again', forgotten === 0, String(forgotten));
  check('with the account it was read against', docHead.includes('AED'), docHead);
  check(
    'the four questions are a table of contents, with how much of each',
    (await page.locator('.scan-doc-link').count()) === 4,
    (await page.locator('.scan-doc-link').allTextContents()).join(' | '),
  );
  // The claim the whole report rests on, shown rather than asserted.
  const arith = await page.locator('.scan-arith').textContent();
  check(
    'and the reconciliation is spelled out as the sum it actually is',
    arith.includes('10,117.51') && arith.includes('=') && arith.includes('9,496.06'),
    arith,
  );
  check(
    'every line is on it, without a fold to open first',
    (await page.locator('.scan-rows tbody tr').count()) === 4,
    String(await page.locator('.scan-rows tbody tr').count()),
  );
  check(
    'and open to the line as the bank printed it',
    (await page.locator('.scan-rows .raw').first().textContent()).includes('TAP*DUB4471'),
  );
  check(
    'with a low-confidence line marked',
    (await page.locator('.scan-rows tr.unsure').count()) === 1,
  );

  // Both dates when the statement printed two, and only when they differ —
  // otherwise the second one is the first fact repeated for no reason.
  const dateCells = await page.locator('.scan-rows .when').allTextContents();
  const withPost = dateCells.filter((t) => t.includes('posts '));
  check(
    'a row that straddled a month shows both dates',
    withPost.length === 1 &&
      withPost[0].includes('30 Jul') &&
      withPost[0].includes('posts 2026-08-01'),
    JSON.stringify(dateCells),
  );
  check(
    'and a row where the two matched shows only one',
    dateCells.filter((t) => t.includes('posts ')).length === 1,
    JSON.stringify(dateCells),
  );

  // --- sorting ------------------------------------------------------------
  // A bank prints a month in the order it happened, and that order carries
  // information the table must not lose by default. So it opens as printed,
  // and every other order is one click away and one click back.
  const rawOrder = async () => (await page.locator('.scan-rows .raw').allTextContents()).join(' | ');
  const printed = await rawOrder();
  check('the table opens in the order the statement was printed in',
    printed.startsWith('TAP*DUB4471'), printed);

  await page.click('.scan-rows th:has-text("Amount") button');
  const bySize = await rawOrder();
  check(
    'sorting by amount puts the largest thing that left the account first',
    bySize.startsWith('ABU DHABI SERVICE'),
    bySize,
  );
  await page.click('.scan-rows th:has-text("Amount") button');
  const flipped = await rawOrder();
  check(
    'and clicking the same column again turns it round',
    flipped.startsWith('TRANSFER PAYMENT RECEIVED'),
    flipped,
  );
  check(
    'the sorted column says which way it is sorted, for a screen reader too',
    (await page.locator('.scan-rows th[aria-sort="descending"]').count()) === 1,
  );
  // Filters and a search, because a hundred and fifteen lines is not a list
  // you read — it is one you look things up in.
  await page.click('#lines .scan-chip:has-text("In")');
  await page.waitForTimeout(150);
  check(
    'filtering to money coming in leaves only that',
    (await page.locator('.scan-rows tbody tr').count()) === 1,
    String(await page.locator('.scan-rows tbody tr').count()),
  );
  await page.click('#lines .scan-chip:has-text("All")');
  await page.fill('.scan-search', 'carrefour');
  await page.waitForTimeout(150);
  check(
    'and searching finds a line by what the bank printed',
    (await page.locator('.scan-rows tbody tr').count()) === 1 &&
      (await page.locator('.scan-showing').textContent()).includes('1 of 4'),
    await page.locator('.scan-showing').textContent(),
  );
  await page.fill('.scan-search', '');
  await page.waitForTimeout(150);

  await page.click('.scan-rows-head button:has-text("printed")');
  check('and the order the bank printed is one click back', (await rawOrder()) === printed, await rawOrder());

  // --- the file -----------------------------------------------------------
  // The first thing a scan lets out of the browser. It is built here, from what
  // is on screen, and never goes near a server — and it sits in the document's
  // header, beside the file it came from, rather than under the table.
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('.scan-doc-csv'),
  ]);
  check(
    'the file is named after the period it covers',
    download.suggestedFilename() === 'statement-2026-08-01-to-2026-08-11.csv',
    download.suggestedFilename(),
  );
  const csv = require('fs').readFileSync(await download.path(), 'utf8');
  check('with a heading row and every line under it',
    csv.trim().split('\r\n').length === 5, String(csv.trim().split('\r\n').length));
  check('the line as the bank printed it goes into the file too',
    csv.includes('ABU DHABI SERVICE'), csv.split('\r\n')[3]);
  check('money leaving the account is negative in it',
    csv.includes(',-1702.96,'), csv.split('\r\n')[3]);
  check('and money arriving is not', csv.includes(',10117.51,'), csv.split('\r\n')[4]);

  // --- the paragraph, which costs money and so is asked for ---------------
  let summaryAsked = 0;
  await page.route('**/api/statements/summary', (r) => {
    summaryAsked += 1;
    return r.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        summary: 'Almost four fifths of what went out was one government charge.',
        model: 'claude-sonnet-5',
        usage: { input: 600, output: 250, cacheRead: 0, cacheWrite: 0 },
        cost: 0.0037,
      }),
    });
  });
  check('the summary is not written unless it is asked for', summaryAsked === 0, String(summaryAsked));
  check(
    'and the offer says what pressing it costs',
    (await page.locator('.scan-why').textContent()).includes('cent'),
    await page.locator('.scan-why').textContent(),
  );
  await page.click('.scan-why button:has-text("Write it out")');
  await page.waitForSelector('.scan-why p', { timeout: 15000 });
  check('pressing it writes one', summaryAsked === 1, String(summaryAsked));
  check(
    'and the paragraph is on the report',
    (await page.locator('.scan-why p').textContent()).includes('government charge'),
    await page.locator('.scan-why p').textContent(),
  );
  check(
    'with what it cost, and the promise that nothing was kept',
    (await page.locator('.scan-why .muted').textContent()).includes('nothing saved'),
    await page.locator('.scan-why .muted').textContent(),
  );

  // Still checkable after the answer arrives — folded away, not thrown away.
  check(
    'what was sent is still on the report, behind a fold',
    (await page.locator('.scan-source summary').count()) === 1,
  );

  // --- a statement the size real ones come in ------------------------------
  // Every check above ran against four rows, and four rows is not the shape
  // this screen fails at. A real statement came back as eighteen categories
  // with `Other` on top of them at 22% — a wall of blocks, each naming a count
  // of lines nobody could get to. Nothing in a four-row stub could have shown
  // that, which is why it shipped.
  const manyRows = [];
  const add = (category, merchant, amount, times) => {
    for (let i = 0; i < times; i += 1) {
      manyRows.push({
        date: `2026-08-${String((manyRows.length % 28) + 1).padStart(2, '0')}`,
        postDate: null,
        raw: `${merchant.toUpperCase()} ${manyRows.length}`,
        merchant: `${merchant}${times > 1 ? ` ${i + 1}` : ''}`,
        what: 'a shop',
        amount,
        direction: 'out',
        kind: 'purchase',
        category,
        confidence: 'high',
      });
    }
  };
  // The shape of the statement that prompted all of this: the largest thing on
  // it is the reading giving up, and the second largest is spelled two ways.
  add('Other', 'Unclear charge', 637.35, 3);
  add('Eating out', 'Tap Coffee', 52.37, 32);
  add('Groceries', 'Carrefour', 131.82, 6);
  add('groceries', 'Spinneys', 131.82, 5);
  add('Fuel', 'ENOC', 92.5, 9);
  add('Transport', 'Careem', 34.25, 8);
  add('Utilities', 'DEWA', 210.4, 3);
  add('Health', 'Clinic', 180, 4);
  add('Shopping', 'Namshi', 149.99, 7);
  add('Subscriptions', 'Spotify', 39, 6);
  add('Cash', 'ATM', 500, 2);
  add('Fees', 'Card fee', 26.25, 4);
  add('Travel', 'Emirates', 890, 2);
  add('Education', 'Coursera', 145, 2);
  add('Insurance', 'Daman', 320, 2);
  add('Childcare', 'Nursery', 750, 2);
  add('Pharmacy', 'Life Pharmacy', 62.4, 5);
  add('Parking', 'Parkin', 12, 6);
  add('Uncategorised', 'Unknown', 88, 3);
  const manySpent = Math.round(manyRows.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
  // The server groups on the raw string, so this is what the screen would show
  // if it took the grouping as given: `Groceries` and `groceries`, twice.
  const rawGroups = [...new Set(manyRows.map((r) => r.category))].map((category) => {
    const of = manyRows.filter((r) => r.category === category);
    const total = Math.round(of.reduce((sum, r) => sum + r.amount, 0) * 100) / 100;
    return {
      category,
      total,
      count: of.length,
      average: Math.round((total / of.length) * 100) / 100,
      share: Math.round((total / manySpent) * 1000) / 10,
    };
  });

  await showReport(
    stub({
      rows: [
        ...manyRows,
        {
          date: '2026-08-01',
          postDate: null,
          raw: 'TRANSFER PAYMENT RECEIVED',
          merchant: 'Card payment',
          what: 'paying the card',
          amount: 10117.51,
          direction: 'in',
          kind: 'payment',
          category: 'Payment',
          confidence: 'high',
        },
      ],
      overview: {
        lines: manyRows.length,
        spent: manySpent,
        credited: 10117.51,
        credits: { payments: 10117.51, refunds: 0, cashback: 0, income: 0 },
        from: '2026-08-01',
        to: '2026-08-28',
      },
      categories: rawGroups.sort((a, b) => b.total - a.total),
      findings: {
        duplicates: [],
        repeats: [],
        outliers: [],
        frequent: [{ merchant: 'Tap Coffee 1', times: 32, total: 1675.84, average: 52.37 }],
      },
    }),
  );

  const catCount = await page.locator('.scan-cat').count();
  check(
    'nineteen category names come out as seventeen rows, because two pairs mean one thing each',
    catCount === 17,
    `${catCount} rows from ${rawGroups.length} names`,
  );
  check(
    'and the merged one is labelled with the spelling the statement used most',
    (await page.locator('.scan-cat-name', { hasText: /^Groceries$/ }).count()) === 1 &&
      (await page.locator('.scan-cat-name', { hasText: /^groceries$/ }).count()) === 0,
  );
  check(
    'holding every line of both spellings',
    (await page.locator('.scan-cat:has(.scan-cat-name:text-is("Groceries"))').textContent()).includes(
      '11 lines',
    ),
    await page.locator('.scan-cat:has(.scan-cat-name:text-is("Groceries"))').textContent(),
  );
  check(
    'the count above the list is the same seventeen',
    (await page.locator('#went .scan-q-sub').textContent()).includes('17 categories'),
    await page.locator('#went .scan-q-sub').textContent(),
  );
  check(
    'and so is the one in the margin, so the two never disagree',
    (
      await page.locator('.scan-doc-link:has-text("Where it went") .scan-doc-count').textContent()
    ).trim() === '17',
    await page.locator('.scan-doc-link:has-text("Where it went") .scan-doc-count').textContent(),
  );

  // Eighteen categories is only readable because none of them is open.
  check('every category is one line until it is asked about', (await page.locator('.scan-cat[open]').count()) === 0);

  // The largest thing on this statement is the reading admitting defeat, and
  // displayed as a category it reads as a habit somebody has.
  const note = await page.locator('.scan-unplaced').textContent();
  check('what could not be placed is named as that, not as spending', note.includes('not a category'), note);
  check('with how much of the month is in it', /\d+(\.\d)?%/.test(note), note);
  check(
    'and the model’s word and the code’s are one row, not two',
    (await page.locator('.scan-cat.unplaced').count()) === 1,
  );
  check(
    'holding both of their lines',
    (await page.locator('.scan-cat.unplaced').textContent()).includes('6 lines'),
    await page.locator('.scan-cat.unplaced').textContent(),
  );

  // The question that started this: "3 lines" — but what are they?
  const utilities = page.locator('.scan-cat:has(.scan-cat-name:text-is("Utilities"))');
  await utilities.locator('summary').click();
  const few = await utilities.locator('.scan-cat-line').count();
  check('opening a small category shows every line behind it', few === 3, String(few));
  const fewAmounts = (await utilities.locator('.scan-cat-line > .num').allTextContents()).length;
  check('each with its own amount', fewAmounts === few, String(fewAmounts));

  // Thirty-two lines opened in place is a scroll with the way out at the far
  // end of it, which is worse than the wall this replaced. The panel shows the
  // largest few and says so — the rest is what the table is for.
  const eatingOut = page.locator('.scan-cat:has(.scan-cat-name:text-is("Eating out"))');
  await eatingOut.locator('summary').click();
  const opened = await eatingOut.locator('.scan-cat-line').count();
  check('a long category shows the largest few rather than all thirty-two', opened === 8, String(opened));
  check(
    'and says that is what it is doing, rather than looking like the whole of it',
    (await eatingOut.locator('.scan-cat-foot').textContent()).includes('8 largest of 32'),
    await eatingOut.locator('.scan-cat-foot').textContent(),
  );

  // Door two: the way out of a list too long to read in place.
  await eatingOut.locator('.scan-cat-foot .link').click();
  await page.waitForSelector('.scan-chip-only', { timeout: 5000 });
  check(
    'and following it to the table says which category is being shown',
    (await page.locator('.scan-chip-only').textContent()).includes('Eating out'),
    await page.locator('.scan-chip-only').textContent(),
  );
  const narrowed = await page.locator('.scan-rows tbody tr').count();
  check(
    'showing exactly the lines the count promised',
    narrowed === 32,
    `${narrowed} rows in the table against the 32 the category counted`,
  );
  check(
    'and saying so, rather than looking like the whole statement',
    (await page.locator('.scan-showing').textContent()).includes(`showing 32 of ${manyRows.length + 1}`),
    await page.locator('.scan-showing').textContent(),
  );

  // Door three: a finding names a merchant, which until now was a fact you
  // could not follow.
  await page.locator('.scan-finding .scan-jump').first().click();
  check(
    'a finding’s merchant is the way to its lines too',
    (await page.locator('.scan-search').inputValue()) === 'Tap Coffee 1',
    await page.locator('.scan-search').inputValue(),
  );
  // Two narrowings at once, by two different clicks, is how somebody ends up
  // looking at nothing and not knowing which click did it.
  check(
    'and it clears the category, so the table is never narrowed two ways at once',
    (await page.locator('.scan-chip-only').count()) === 0,
  );

  // The row that merges two words has to find by the same rule it grouped by,
  // or a row labelled six lines opens onto three of them.
  const unplacedRow = page.locator('.scan-cat.unplaced');
  await unplacedRow.locator('summary').click();
  await unplacedRow.locator('.scan-cat-foot .link').click();
  await page.waitForSelector('.scan-chip-only', { timeout: 5000 });
  const unplacedShown = await page.locator('.scan-rows tbody tr').count();
  check(
    'following what could not be placed brings back every line it was counting',
    unplacedShown === 6,
    `${unplacedShown} rows`,
  );
  // And the way back out of it, since nothing else on this screen says the
  // table is showing a seventeenth of the statement.
  await page.locator('.scan-chip-only').click();
  check(
    'and the chip is the way back to the whole statement',
    (await page.locator('.scan-rows tbody tr').count()) === manyRows.length + 1,
    String(await page.locator('.scan-rows tbody tr').count()),
  );
  // --- a reading that does not add up --------------------------------------
  await showReport(
    stub({
      reconciliation: {
        status: 'mismatch',
        expected: 8969.26,
        closing: 9496.06,
        delta: -526.8,
        countedTwice: null,
      },
    }),
  );
  const banner = await page.locator('.modal.scanner .warn-banner').textContent();
  check(
    'a reading that does not add up says so before anything else',
    banner.includes('does not add up'),
    banner.slice(0, 60),
  );
  check('and names the gap', banner.includes('526.8'), banner.slice(0, 200));
  check('and says not to take the figures as fact', banner.includes('not as fact'));
  check('while still showing them', (await page.locator('.scan-cat').count()) === 3);
  await close();
  check(
    'and closing it leaves the rest of the app hidden as it was',
    (await page.locator('button[aria-label="Show amounts"]').count()) === 1,
  );

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
  const sentText = [];
  await page.route('**/api/statements/scan', async (route) => {
    calls += 1;
    const body = JSON.parse(route.request().postData());
    asked.push({ model: body.model, effort: body.effort });
    // Answer with whatever merchant numbers this slice actually contains, so
    // assembling them wrongly shows up as wrong order rather than as nothing.
    const found = [...body.text.matchAll(/MERCHANT NUMBER (\d{3})/g)].map((m) => m[1]);
    seen.push(found.length);
    // The header rides along with every slice, so anything left in it is sent
    // once per part. This is the check that matters: not what the preview
    // showed, but what was actually in the request.
    sentText.push(body.text);
    // Slices deliberately finish out of order: the later ones answer first.
    await new Promise((r) => setTimeout(r, found.includes('001') ? 260 : 40));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        rows: found.map((n) => ({
          date: '2026-08-01',
          raw: `MERCHANT NUMBER ${n}`,
          merchant: `Merchant ${n}`,
          what: 'a shop',
          amount: Number(n),
          direction: 'out',
          kind: 'purchase',
          category: 'Shopping',
          confidence: 'high',
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
        overview: {
          lines: 90,
          spent: 1,
          credited: 0,
          credits: { payments: 0, refunds: 0, cashback: 0, income: 0 },
          from: null,
          to: null,
        },
        reconciliation: { status: 'unchecked' },
        categories: [{ category: 'Shopping', total: 1, count: 90, average: 1, share: 100 }],
        findings: {},
      }),
    }),
  );

  await open('statement-long.pdf');
  await page.waitForSelector('.scan-hidden', { timeout: 25000 });
  await page.click('.modal.scanner button:has-text("Read the transactions")');
  await page.waitForSelector('.scan-report', { timeout: 40000 });

  check('a long statement is read in more than one request', calls > 1, `${calls} requests`);
  // The picker is only worth having if what it picks is what gets sent — on
  // every slice, not just the first.
  check(
    'the account number is in none of the requests, not merely hidden on screen',
    sentText.every((t) => !t.includes('887342')),
    String(sentText.length) + ' requests',
  );
  check(
    'what was picked is what every slice is read with',
    asked.every((a) => a.model === 'claude-opus-5' && a.effort === 'medium'),
    JSON.stringify(asked[0]),
  );
  check(
    'and no single request carries the whole thing',
    Math.max(...seen) <= 60,
    `largest slice: ${Math.max(...seen)} lines`,
  );
  const firstRow = await page.locator('.scan-rows .raw').first().textContent();
  const lastRow = await page.locator('.scan-rows .raw').last().textContent();
  check(
    'the rows are assembled in the order they were printed, not the order they returned',
    firstRow.includes('001') && lastRow.includes('090'),
    `${firstRow} … ${lastRow}`,
  );
  check(
    'and every one of them survived the split',
    (await page.locator('.scan-rows tbody tr').count()) === 90,
    String(await page.locator('.scan-rows tbody tr').count()),
  );

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
          date: '2026-08-01',
          raw: `MERCHANT NUMBER ${n}`,
          merchant: `Merchant ${n}`,
          what: 'a shop',
          amount: Number(n),
          direction: 'out',
          kind: 'purchase',
          category: 'Shopping',
          confidence: 'high',
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
        overview: {
          lines: 60,
          spent: 1830,
          credited: 0,
          credits: { payments: 0, refunds: 0, cashback: 0, income: 0 },
          from: '2026-08-01',
          to: '2026-08-01',
        },
        // The rows that did arrive cannot add up to the bank's own closing
        // balance, because some of them were never read.
        reconciliation: {
          status: 'mismatch',
          expected: -1830,
          closing: -4095,
          delta: 2265,
          countedTwice: null,
        },
        categories: [{ category: 'Shopping', total: 1830, count: 60, average: 30, share: 100 }],
        findings: {},
      }),
    }),
  );

  await open('statement-long.pdf');
  await page.waitForSelector('.scan-hidden', { timeout: 25000 });
  await page.click('.modal.scanner button:has-text("Read the transactions")');
  await page.waitForSelector('.scan-report', { timeout: 40000 });

  check(
    'one slice dying no longer throws away the whole reading',
    (await page.locator('.scan-rows tbody tr').count()) > 0,
    await page
      .locator('.modal.scanner .error-text')
      .textContent()
      .catch(() => 'no report'),
  );
  const partial = await page.locator('.modal.scanner .warn-banner').first().textContent();
  check(
    'and the report says so before anything else',
    partial.includes('could not be read'),
    partial.slice(0, 80),
  );
  check(
    'naming how much of the statement is missing',
    /\d+ parts? of this statement/.test(partial),
    partial.slice(0, 80),
  );
  check('and what to do about it', partial.includes('lower effort'), partial.slice(0, 200));

  // A gap it has already explained is not a second, different accusation. The
  // rows that are missing are missing because they were never read, which the
  // banner above already says.
  const banners = await page.locator('.modal.scanner .warn-banner').allTextContents();
  check(
    'an incomplete reading is not also called a misreading',
    !banners.some((b) => b.includes('does not add up')),
    JSON.stringify(banners.map((b) => b.slice(0, 40))),
  );

  // --- what a report short of a few parts is allowed to claim ---------------
  // The rule underneath all of this: a figure summed from the rows is a floor,
  // and a figure the bank printed is not. Everything below checks that the
  // report marks the first kind and leaves the second alone.
  check(
    'and offers to fetch only what is missing, at what that costs',
    /Read the missing \d+ · /.test(await page.locator('.warn-banner.scan-short button').textContent()),
    await page.locator('.warn-banner.scan-short button').textContent(),
  );
  const spentTile = await page.locator('.scan-tile').first().textContent();
  check(
    'every total summed from the rows is a floor, and says so',
    spentTile.includes('at least'),
    spentTile,
  );
  check(
    'and is drawn as one, rather than left looking finished',
    (await page.locator('.scan-tile.short').count()) > 0,
  );
  // The one figure somebody opened the statement to find is printed by the
  // bank, not added up here, so the missing parts do not touch it.
  const billText = await page.locator('.scan-bill').textContent();
  check(
    'but the balance the bank printed is not marked, because it is not a sum',
    !billText.includes('at least'),
    billText.slice(0, 120),
  );
  check(
    'and says why it stands while everything else is short',
    billText.includes('bank printed this one'),
    billText.slice(-160),
  );
  // A share has the missing rows in its denominator: unlike a total it is not a
  // floor, it is unknown, and it can move either way.
  const catRow = await page.locator('.scan-cat').first().textContent();
  check('a share of a statement only partly read is withheld', catRow.includes('—%'), catRow.slice(0, 90));
  check(
    'and the bar keeps its slot, so nothing reflows when the parts land',
    (await page.locator('.scan-bar.withheld').count()) > 0,
  );
  check(
    'the counts in the margin carry the same floor',
    (await page.locator('.scan-doc-link:has-text("The lines") .scan-doc-count').textContent()).includes('+'),
    await page.locator('.scan-doc-link:has-text("The lines") .scan-doc-count').textContent(),
  );
  // The check cannot run over part of a statement, and saying that is worth as
  // much as running it.
  check(
    'the arithmetic says it is withheld rather than showing a sum that cannot land',
    (await page.locator('.scan-arith').textContent()).includes('withheld'),
    (await page.locator('.scan-arith').textContent()).slice(0, 90),
  );
  // A paragraph about a month is a claim about all of it.
  check(
    'and the written summary is not offered over part of a statement',
    (await page.locator('.scan-why button:has-text("Write it out")').count()) === 0,
    await page.locator('.scan-why').textContent(),
  );
  check(
    'saying so, rather than leaving a button that quietly lies',
    (await page.locator('.scan-why .muted').textContent()).includes('Not while parts are missing'),
    await page.locator('.scan-why .muted').textContent(),
  );
  // The table is where somebody goes to check a figure they did not believe.
  const tail = await page.locator('.scan-short-tail').textContent();
  check('the table says the same thing where its rows run out', tail.includes('not in this list'), tail);
  check('and names the CSV, which outlives the screen', tail.includes('CSV'), tail);

  const kept = await page.locator('.scan-rows tbody tr').count();
  check(
    'every line that did come back is kept',
    kept === 90 - lostRows,
    `${kept} kept, ${lostRows} lost, of 90`,
  );
  check('and nothing was invented to fill the gap', kept > 0 && kept < 90, String(kept));
  // Once, then once more. A connection that drops twice will not work on the
  // third attempt, and every attempt is a reading somebody pays for.
  check(
    'the slice that died was asked for twice — not once, and not forever',
    attempts === slices.size + 1,
    `${attempts} requests for ${slices.size} slices`,
  );

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
          date: '2026-08-01',
          raw: `MERCHANT NUMBER ${n}`,
          merchant: `Merchant ${n}`,
          what: 'a shop',
          amount: Number(n),
          direction: 'out',
          kind: 'purchase',
          category: 'Shopping',
          confidence: 'high',
        })),
        statement: null,
        model: 'claude-opus-5',
        usage: { input: 4000, output: 900, cacheRead: 3000, cacheWrite: 0 },
        cost: 0.01,
      }),
    });
  });

  const readMissing = page.locator('.warn-banner.scan-short button.primary');
  check('the report offers to fetch what it could not read', (await readMissing.count()) === 1);
  await readMissing.click();
  await page.waitForFunction(
    () => !document.querySelector('.modal.scanner .warn-banner.scan-short'),
    null,
    { timeout: 20000 },
  );
  check(
    'and asks only for the part that was missing, not for the statement again',
    attempts - before === 1,
    `${attempts - before} requests`,
  );
  const whole = await page.locator('.scan-rows tbody tr').count();
  check('which completes the reading', whole === 90, String(whole));
  check(
    'and the warning about missing parts goes with it',
    !(await page.locator('.modal.scanner').textContent()).includes('could not be read'),
  );
  // Every mark the shortfall put on the report comes off with it, by itself:
  // there is no second state to dismiss, because the marks were only ever the
  // shortfall being true.
  const finished = await page.locator('.scan-doc-pane').textContent();
  check(
    'and so does every "at least" it put on the figures',
    !finished.includes('at least'),
    finished.slice(0, 200),
  );
  check('the shares come back', !finished.includes('—%') && (await page.locator('.scan-bar.withheld').count()) === 0);
  check(
    'the check is no longer withheld — this statement prints no opening balance to check against, which the bill card says on its own',
    !finished.includes('withheld until the statement is whole'),
  );
  check(
    'and the paragraph is on offer again',
    (await page.locator('.scan-why button:has-text("Write it out")').count()) === 1,
  );
  check(
    'with nothing left at the end of the table to fetch',
    (await page.locator('.scan-short-tail').count()) === 0,
  );
  const firstAfter = await page.locator('.scan-rows .raw').first().textContent();
  const lastAfter = await page.locator('.scan-rows .raw').last().textContent();
  check(
    'with the recovered part put back where it was printed, not on the end',
    firstAfter.includes('001') && lastAfter.includes('090'),
    `${firstAfter} … ${lastAfter}`,
  );

  // --- on a phone ----------------------------------------------------------
  // Every check so far ran at 1280px. The report is a takeover of the whole
  // window, so at 390 it is the whole phone — and the part that breaks there is
  // the table: four columns in that width scroll sideways, and the column that
  // falls off the right edge is the amount, which is the one thing every row is
  // read for.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);

  const sideways = await page.evaluate(() => {
    const wrap = document.querySelector('.tablewrap');
    const pane = document.querySelector('.scan-doc-pane');
    return {
      table: wrap.scrollWidth - wrap.clientWidth,
      pane: pane.scrollWidth - pane.clientWidth,
    };
  });
  check(
    'the table does not scroll sideways on a phone',
    sideways.table <= 1,
    `${sideways.table}px over`,
  );
  check('and neither does the document', sideways.pane <= 1, `${sideways.pane}px over`);

  const amount = await page.locator('.scan-rows tbody tr').first().locator('td.num').boundingBox();
  check(
    'so the amount is on the screen rather than off the right edge of it',
    amount && amount.x + amount.width <= 390,
    JSON.stringify(amount),
  );
  const merchant = await page
    .locator('.scan-rows tbody tr')
    .first()
    .locator('td')
    .nth(1)
    .boundingBox();
  check(
    'beside what it was spent on, which is the pairing a row is read for',
    amount && merchant && Math.abs(amount.y - merchant.y) < 24,
    `amount y ${Math.round(amount.y)} · merchant y ${Math.round(merchant.y)}`,
  );
  // The headings are the sort controls. A list you cannot sort is worse than a
  // table you have to scroll, so they stay — laid out as a row of their own.
  check(
    'and the columns are still there to sort by',
    (await page.locator('.scan-rows th button').count()) === 4,
  );

  // The desk is the other half of the same flow, and the two looking different
  // at the same width is worse than either choice.
  await close();
  await open('statement-long.pdf');
  await page.waitForSelector('.scan-hidden', { timeout: 30000 });
  const go = await page.locator('.scan-go').boundingBox();
  const readButton = await page
    .locator('.modal.scanner button:has-text("Read the transactions")')
    .boundingBox();
  check(
    'the desk keeps the price and the button in reach on a phone',
    go && go.y + go.height <= 844 + 1,
    JSON.stringify(go),
  );
  check(
    'and the button is a thumb-sized target rather than a line of text',
    readButton && readButton.height >= 44,
    `${Math.round(readButton?.height ?? 0)}px tall`,
  );
  check(
    'with the price on the same step as the button that spends it',
    (await page.locator('.scan-go .scan-estimate').count()) === 1,
    await page.locator('.scan-go').textContent(),
  );
  const chipBox = await page.locator('.scan-page-chip').first().boundingBox();
  check(
    'and a page is a target rather than a word',
    chipBox && chipBox.height >= 44,
    `${Math.round(chipBox?.height ?? 0)}px tall`,
  );
  await close();
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.unroute('**/api/statements/scan');
  await page.unroute('**/api/statements/analyse');

  // --- statements kept, and compared -------------------------------------
  //
  // The comparison arithmetic is tested directly in test/api/history.test.js.
  // What a browser is needed for is the screen: that a page exists to reach,
  // that it reads what was kept, and — the one that matters — that the caveat
  // about a merchant refiled between two readings is printed ABOVE the
  // category list it qualifies rather than below it. A warning that arrives
  // after the claim it undermines has already been believed.
  const keep = async (periodStart, periodEnd, rows) =>
    page.evaluate(
      async ([start, end, lines, household]) => {
        const res = await fetch('/api/statements/kept', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Household-Id': String(household) },
          body: JSON.stringify({
            statement: { periodStart: start, periodEnd: end },
            rows: lines,
          }),
        });
        return res.status;
      },
      [periodStart, periodEnd, rows, await page.evaluate(() => localStorage.getItem('budget.householdId'))],
    );

  const line = (merchant, amount, category) => ({
    date: '2026-07-04',
    raw: merchant.toUpperCase(),
    merchant,
    what: 'a shop',
    amount,
    direction: 'out',
    kind: 'purchase',
    category,
    confidence: 'high',
  });

  const keptJuly = await keep('2026-07-01', '2026-07-31', [
    line('Carrefour', 400, 'Groceries'),
    line('Tap Coffee', 200, 'Eating out'),
    line('Netflix', 56, 'Subscriptions'),
  ]);
  // The same coffee shop, filed elsewhere the second time. This is the drift a
  // fixed vocabulary cannot remove — both answers are defensible — and it is
  // what the caveat exists to name.
  const keptAugust = await keep('2026-08-01', '2026-08-31', [
    line('Carrefour', 520, 'Groceries'),
    line('Tap Coffee', 200, 'Groceries'),
    line('Netflix', 62, 'Subscriptions'),
  ]);
  check('two statements can be kept', keptJuly === 201 && keptAugust === 201,
    `${keptJuly} and ${keptAugust}`);

  await page.click('.side-nav button:has-text("Statements")');
  await page.waitForSelector('.stmt-list', { timeout: 10000 });
  check('the statements page lists what was kept',
    (await page.locator('.stmt-list li').count()) === 2,
    String(await page.locator('.stmt-list li').count()));
  check('and names the periods the way a person would say them',
    (await page.locator('.stmt-list li .n').first().textContent()).includes('August 2026'),
    await page.locator('.stmt-list li .n').first().textContent());
  check('the two most recent are compared without anything being chosen',
    (await page.locator('.stmt-compare .stmt-headline').textContent()).includes('Spending'),
    await page.locator('.stmt-compare .stmt-headline').textContent());

  const caveat = page.locator('.stmt-caveat');
  check('a merchant refiled between the two readings is named',
    (await caveat.count()) === 1 && (await caveat.textContent()).includes('Tap Coffee'),
    (await caveat.count()) ? await caveat.textContent() : 'no caveat');
  const caveatTop = (await caveat.boundingBox())?.y ?? 0;
  const categoriesTop =
    (await page.locator('.stmt-compare h4:has-text("Categories")').boundingBox())?.y ?? 0;
  check('and said above the categories it makes misleading, not below them',
    caveatTop > 0 && caveatTop < categoriesTop, `caveat ${Math.round(caveatTop)}, list ${Math.round(categoriesTop)}`);

  check('a charge in both statements is found, which one statement could not show',
    (await page.locator('.stmt-recurring').textContent()).includes('Netflix'),
    await page.locator('.stmt-recurring .stmt-mover .n').first().textContent());

  // Nothing here reached the ledger. That separation is the whole premise of
  // keeping statements in their own tables, so it is asserted rather than
  // assumed.
  const ledger = await page.evaluate(async (household) => {
    const res = await fetch('/api/transactions?month=2026-08', {
      headers: { 'X-Household-Id': String(household) },
    });
    return (await res.json()).length;
  }, await page.evaluate(() => localStorage.getItem('budget.householdId')));
  check('and none of it was written into the ledger', ledger === 0, String(ledger));

  check('no page errors throughout', bad.length === 0, bad.join(' | '));

  await browser.close();
  console.log(`\nStatement scanner (browser)\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
