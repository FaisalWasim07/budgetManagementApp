const { chromium } = require('playwright');
const { addMoney, openTransfer } = require('./helpers');

// A description typed when money is entered or moved, and seen again where
// you look for it: Activity, Home's latest entries, and the edit dialog.

const launchOptions = () =>
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const URL = process.env.TEST_APP_URL || 'http://localhost:5173';
const ok = [];
const bad = [];
const check = (name, cond, extra = '') =>
  (cond ? ok : bad).push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => bad.push('PAGE ERROR: ' + e.message));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [`ds_${stamp}`, 'descpass12345']
  );
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Desc Home');
  await page.locator('input.person-name').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.evaluate(async () => {
    const hh = await (await fetch('/api/households')).json();
    const id = (hh.households ?? hh)[0].id;
    const H = { 'Content-Type': 'application/json', 'X-Household-Id': String(id) };
    const [main] = await (await fetch('/api/accounts', { headers: H })).json();
    await fetch('/api/accounts', {
      method: 'POST',
      headers: H,
      body: JSON.stringify({ person_id: main.person_id, name: 'Rainy day', currency: 'AED', type: 'savings' }),
    });
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.click('button[aria-label="Show amounts"]').catch(() => {});
  await page.waitForTimeout(800);

  // --- entering money -----------------------------------------------------
  await page.click('.add-top');
  await page.waitForSelector('.sheet.open', { timeout: 8000 });
  check('the add sheet has a description box', (await page.locator('.sheet input[aria-label="Description"]').count()) === 1);
  check('marked optional, so leaving it blank is plainly fine',
    (await page.locator('.sheet .label:has-text("Description") .optional').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await addMoney(page, { amount: 5000, kind: 'Received', category: 'Salary', description: 'November invoice' });
  await addMoney(page, { amount: 214, category: 'Groceries', description: 'Weekly shop at Carrefour' });
  await addMoney(page, { amount: 30, category: 'Fuel' });

  // --- moving money -------------------------------------------------------
  await openTransfer(page);
  await page.waitForSelector('.modal');
  const pickIn = async (select, name) => {
    const options = await select.locator('option').allTextContents();
    await select.selectOption({ index: options.findIndex((text) => text.includes(name)) });
  };
  await pickIn(page.locator('.modal select').nth(0), 'Main');
  await pickIn(page.locator('.modal select').nth(1), 'Rainy day');
  await page.locator('.modal input[type="number"]').first().fill('1000');
  check('the transfer form has a description box too',
    (await page.locator('.modal input[aria-label="Description"]').count()) === 1);
  await page.locator('.modal input[aria-label="Description"]').fill('November savings');
  await page.locator('.modal button[type="submit"]').click();
  await page.waitForTimeout(1800);

  // --- Home's latest ------------------------------------------------------
  // Without a reload: the list beside the totals has to pick the new entries
  // up the moment they are saved, which it once did not.
  const latest = await page.locator('.latest .txn .what b').allTextContents();
  check('Home’s latest entries are named by their description',
    latest.includes('Weekly shop at Carrefour') && latest.includes('November invoice'), latest.join(' | '));
  const shopRow = page.locator('.latest .txn', { hasText: 'Weekly shop at Carrefour' });
  check('with the category still on the line under it',
    (await shopRow.locator('small').textContent()).includes('Groceries'), await shopRow.locator('small').textContent());

  // --- Activity -----------------------------------------------------------
  await page.locator('nav.side-nav button:has-text("Activity")').click();
  await page.waitForSelector('.txn-table', { timeout: 10000 });
  await page.waitForTimeout(800);
  const titles = await page.locator('.txn-table .txn .what-text b').allTextContents();
  check('Activity shows the description as the entry’s name',
    titles.includes('Weekly shop at Carrefour') && titles.includes('November invoice'), titles.join(' | '));
  const shop = page.locator('.txn-table .txn', { hasText: 'Weekly shop at Carrefour' });
  check('and keeps the category in its own column, so neither hides the other',
    (await shop.locator('.chip').textContent()) === 'Groceries', await shop.locator('.chip').textContent().catch(() => 'none'));
  check('an entry without a description is still named by its category', titles.includes('Fuel'), titles.join(' | '));

  const moves = page.locator('.txn-table .txn', { hasText: 'November savings' });
  check('both sides of the move carry its description', (await moves.count()) === 2, String(await moves.count()));
  const moveNotes = await moves.locator('.what-text small').allTextContents();
  check('and each still says where the money went',
    moveNotes.includes('To Rainy day') && moveNotes.some((t) => t.startsWith('From ')), moveNotes.join(' | '));

  await page.locator('.txn-search input, input[type="search"]').first().fill('carrefour').catch(() => {});
  await page.waitForTimeout(400);
  const found = await page.locator('.txn-table .txn .what-text b').allTextContents();
  check('searching Activity finds an entry by its description',
    found.length === 1 && found[0] === 'Weekly shop at Carrefour', found.join(' | '));
  await page.locator('.txn-search input, input[type="search"]').first().fill('').catch(() => {});
  await page.waitForTimeout(300);

  // --- editing ------------------------------------------------------------
  await page.locator('.txn-table .txn', { hasText: 'Weekly shop at Carrefour' }).locator('.what').click();
  await page.waitForSelector('.modal', { timeout: 8000 });
  const editBox = page.locator('.modal label:has-text("Description") input');
  check('the edit dialog opens with the description filled in',
    (await editBox.inputValue()) === 'Weekly shop at Carrefour', await editBox.inputValue());

  // --- the account's own page --------------------------------------------
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await page.locator('nav.side-nav button:has-text("Home")').click();
  await page.waitForTimeout(600);
  await page.locator('.account-row', { hasText: 'Main Account' }).first().click();
  await page.waitForSelector('.ledger-table', { timeout: 10000 });
  await page.waitForTimeout(500);
  const ledger = await page.locator('.ledger-table .txn .what-text b').allTextContents();
  check('the account’s own page names entries by their description as well',
    ledger.includes('Weekly shop at Carrefour'), ledger.join(' | '));

  // --- a phone ------------------------------------------------------------
  const cookies = await context.cookies();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phoneCtx.addCookies(cookies);
  const phone = await phoneCtx.newPage();
  await phone.goto(URL, { waitUntil: 'networkidle' });
  await phone.waitForSelector('.tabbar', { timeout: 15000 });
  await phone.click('button[aria-label="Show amounts"]').catch(() => {});
  await phone.locator('.tabbar button:has-text("Activity")').tap();
  await phone.waitForTimeout(1200);
  const phoneShop = phone.locator('.txn', { hasText: 'Weekly shop at Carrefour' }).first();
  check('on a phone, Activity names it by its description too', (await phoneShop.count()) === 1);
  check('with the category first on the line under it',
    ((await phoneShop.locator('small').textContent()) ?? '').startsWith('Groceries'),
    await phoneShop.locator('small').textContent());
  await phoneCtx.close();

  await browser.close();
  console.log(ok.concat(bad).join('\n'));
  console.log(`\n  ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch((err) => {
  console.log(ok.concat(bad).join('\n'));
  console.error('\nSTOPPED:', err.message);
  process.exit(1);
});
