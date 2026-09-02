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
  const close = async () => {
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
  await page.waitForTimeout(1200);
  check('a wrong password is refused, and can be corrected in place',
    (await page.locator('.modal.scanner .field .muted').last().textContent()).includes('did not open it'));
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

  check('no page errors throughout', bad.length === 0, bad.join(' | '));

  await browser.close();
  console.log(`\nStatement scanner (browser)\n  ${passed} passed, ${failed} failed\n`);
  process.exit(failed ? 1 : 0);
})();
