const { chromium } = require('playwright');
const { openEntry } = require('./helpers');

// The breakdown behind each figure on Home's month card.
//
// The API suite checks the lists add up. This checks the interaction: a mouse
// previews on hover and follows the pointer, a press pins, Escape and a press
// outside let go, a phone opens on a tap — and opening never moves the page
// underneath, which was the bug the KPI tiles once had.

const launchOptions = () =>
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const URL = process.env.TEST_APP_URL || 'http://localhost:5173';
const ok = [];
const bad = [];
const check = (name, cond, extra = '') =>
  (cond ? ok : bad).push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
const PASSWORD = 'flowpass12345';
const panelTitle = (page) => page.locator('.flow-head b').textContent();
const panelOpen = async (page) => (await page.locator('.flow-detail').count()) === 1;

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
    [`fl_${stamp}`, PASSWORD]
  );
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Flow Home');
  await page.locator('input.person-name').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('.flow-card', { timeout: 15000 });

  const month = await page.evaluate(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  });
  await page.evaluate(async (M) => {
    const hh = await (await fetch('/api/households')).json();
    const id = (hh.households ?? hh)[0].id;
    const H = { 'Content-Type': 'application/json', 'X-Household-Id': String(id) };
    const [main] = await (await fetch('/api/accounts', { headers: H })).json();
    const post = (url, body) => fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
    await post('/api/transactions', { account_id: main.id, month: M, kind: 'income', amount: 5000, category: 'Salary' });
    await post('/api/transactions', { account_id: main.id, month: M, kind: 'expense', amount: 300, category: 'Groceries', description: 'Weekly shop' });
    await post('/api/transactions', { account_id: main.id, month: M, kind: 'expense', amount: 120, category: 'Fuel' });
    await post('/api/subscriptions', { account_id: main.id, name: 'Netflix', amount: 56, cycle: 'monthly', start_month: M });
    // A rupee account, so an entry has to be converted to sit beside the rest.
    const rupees = await (await post('/api/accounts', { person_id: main.person_id, name: 'HBL', currency: 'PKR', type: 'current', opening_balance: 100000 })).json();
    await post('/api/transactions', { account_id: rupees.id, month: M, kind: 'expense', amount: 7600, category: 'Groceries', description: 'Bazaar' });
    // A second person, so the opened row has more than one person to group by.
    const noor = await (await post('/api/persons', { name: 'Noor' })).json();
    const all = await (await fetch('/api/accounts', { headers: H })).json();
    const noorAccount = all.find((a) => a.person_id === noor.id);
    await post('/api/transactions', { account_id: noorAccount.id, month: M, kind: 'expense', amount: 450, category: 'Groceries', description: 'Big shop' });
  }, month);
  // Today's PKR rate, written where the server caches it, so the conversion
  // is a known figure rather than whatever the market says this morning.
  {
    const { Client } = require('pg');
    const db = new Client({ connectionString: process.env.TEST_DATABASE_URL });
    await db.connect();
    await db.query(
      `INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at) VALUES ('PKR', 'AED', 0.013, $1)
       ON CONFLICT (base_currency, target_currency) DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`,
      [new Date().toISOString()]
    );
    await db.query(`DELETE FROM exchange_rate_history WHERE base_currency = 'PKR'`);
    await db.end();
  }
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.flow-card', { timeout: 15000 });
  await page.click('button[aria-label="Show amounts"]').catch(() => {});
  await page.waitForTimeout(1500);

  // --- a mouse previews ---------------------------------------------------
  const below = async () => (await page.locator('.home-cols').boundingBox()).y;
  const before = await below();
  await page.locator('.breakdown .k', { hasText: 'Spent' }).hover();
  await page.waitForTimeout(300);
  check('hovering a figure opens what it is made of', (await panelOpen(page)) && (await panelTitle(page)) === 'Spent',
    await page.locator('.flow-detail').count());
  const rows = await page.locator('.flow-rows li .what b').allTextContents();
  check('spent is listed by category, biggest first', rows.join(',') === 'Groceries,Fuel', rows.join(','));
  check('and opening it does not move the page underneath', (await below()) === before, `${before} → ${await below()}`);

  await page.locator('.breakdown .k', { hasText: 'Subscriptions' }).hover();
  await page.waitForTimeout(250);
  check('the panel follows the pointer to the next figure', (await panelTitle(page)) === 'Subscriptions',
    await panelTitle(page));
  check('which lists the recurring items', (await page.locator('.flow-rows').textContent()).includes('Netflix'),
    await page.locator('.flow-rows').textContent());

  const bar = await page.locator('.flow-card .bar').boundingBox();
  await page.mouse.move(bar.x + 4, bar.y + bar.height / 2);
  await page.waitForTimeout(250);
  check('pointing at the bar opens the part under the pointer', (await panelTitle(page)) === 'Spent',
    await panelTitle(page));

  await page.mouse.move(5, 890);
  await page.waitForTimeout(400);
  check('and moving away closes it', !(await panelOpen(page)));

  // --- a press pins -------------------------------------------------------
  await page.locator('.breakdown .k', { hasText: 'Left' }).click();
  await page.mouse.move(5, 890);
  await page.waitForTimeout(400);
  check('a click keeps it open after the pointer leaves', (await panelOpen(page)) && (await panelTitle(page)) === 'Left');
  check('left is the sum written out',
    (await page.locator('.flow-sum dt').allTextContents()).join(',') ===
      'Came in,Spent,Subscriptions,Moved to savings,Left',
    (await page.locator('.flow-sum dt').allTextContents()).join(','));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  check('Escape lets it go', !(await panelOpen(page)));

  await page.locator('.flow-top .flow-opener').click();
  await page.waitForTimeout(200);
  check('what came in opens too', (await panelTitle(page)) === 'Came in', await panelTitle(page));
  await page.locator('.hero').click({ position: { x: 10, y: 10 } });
  await page.waitForTimeout(200);
  check('a click anywhere else closes it', !(await panelOpen(page)));

  // --- the keyboard -------------------------------------------------------
  await page.locator('.breakdown .k', { hasText: 'Spent' }).focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('Enter on a figure opens it', (await panelOpen(page)) &&
    (await page.locator('.breakdown .k', { hasText: 'Spent' }).getAttribute('aria-expanded')) === 'true');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(200);
  check('and again closes it', !(await panelOpen(page)));

  // --- a row opens to the entries in it -----------------------------------
  // "3 entries" was a count of things you could not see.
  await page.locator('.breakdown .k', { hasText: 'Spent' }).hover();
  await page.waitForTimeout(250);
  await page.locator('.flow-row-toggle', { hasText: 'Groceries' }).click();
  await page.waitForTimeout(250);
  const inside = await page.locator('.flow-entries .entry-what b').allTextContents();
  check('a category opens to the entries in it, by their description',
    inside.join(' | ') === 'Big shop | Weekly shop | Bazaar', inside.join(' | '));
  // Grouped under who spent them, the bigger share first: Noor's 450 against
  // Faisal's 300 + 98.80.
  const who = await page.locator('.flow-entries .entry-who-name').allTextContents();
  const shares = await page.locator('.flow-entries .entry-who-total').allTextContents();
  check('the entries are grouped by person, the bigger share first', who.join(',') === 'Noor,Faisal', who.join(','));
  check('each person carrying their share of the row',
    /AED\s450(\.00)?$/.test(shares[0] ?? '') && /398\.80/.test(shares[1] ?? ''), shares.join(' | '));
  // PKR 7,600 at 0.013 is AED 98.80: shown in the household's currency, with
  // the rupees underneath, and ranked by that rather than by the bigger number.
  const bazaar = page.locator('.flow-entries li', { hasText: 'Bazaar' });
  const [inAed, inPkr] = [
    await bazaar.locator('.entry-amt b').textContent(),
    await bazaar.locator('.entry-amt small').textContent(),
  ];
  check('an entry in another currency shows in the household currency first',
    /AED/.test(inAed) && /98\.8/.test(inAed), inAed);
  check('with its own currency underneath', /PKR/.test(inPkr) && /7,600/.test(inPkr), inPkr);
  check('an entry already in the household currency carries no second figure',
    (await page.locator('.flow-entries li', { hasText: 'Weekly shop' }).locator('.entry-amt small').count()) === 0);
  await page.mouse.move(5, 890);
  await page.waitForTimeout(400);
  check('reaching in to open one pins the panel, so it stays while you read', await panelOpen(page));
  await page.locator('.flow-row-toggle', { hasText: 'Groceries' }).click();
  await page.waitForTimeout(200);
  check('and pressing the row again folds it', (await page.locator('.flow-entries').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);

  // --- Activity opens from the card, not the navigation ----------------------
  check('Activity is no longer in the sidebar',
    (await page.locator('.side-nav button', { hasText: /^Activity$/ }).count()) === 0);
  const link = page.locator('.flow-activity');
  check('the month card carries the way into it', (await link.count()) === 1 && /All activity in/.test(await link.textContent()),
    await link.textContent().catch(() => ''));
  await link.click();
  await page.waitForSelector('.txn-table .txn', { timeout: 10000 });
  check('which opens this month’s entries', (await page.locator('.txn-table .txn').count()) >= 5,
    String(await page.locator('.txn-table .txn').count()));
  check('with Home still lit in the sidebar, since Activity is part of it',
    (await page.locator('.side-nav button.active').textContent())?.trim() === 'Home');
  await page.locator('.topbar .crumb', { hasText: 'Home' }).click();
  await page.waitForSelector('.flow-card');
  check('and the crumb in the top bar goes back', (await page.locator('.flow-activity').count()) === 1);

  // --- the add sheet's category is a dropdown of the ones used before -------
  await openEntry(page, 'Spent');
  const options = () => page.locator('.sheet select[aria-label="Category"] option').allTextContents();
  const spentOptions = await options();
  check('spending categories are offered, most used first',
    spentOptions.join(',') === 'No category,Groceries,Fuel,New category…', spentOptions.join(','));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await openEntry(page, 'Received');
  const inOptions = await options();
  check('and money in has its own list', inOptions.join(',') === 'No category,Salary,New category…', inOptions.join(','));
  await page.locator('.sheet select[aria-label="Category"]').selectOption('__new');
  check('"New category…" opens a box to type one, ready to type into',
    await page.locator('.sheet input[aria-label="New category"]').evaluate((el) => el === document.activeElement));
  await page.locator('.sheet button', { hasText: 'Back to list' }).click();
  check('and the list comes back', (await page.locator('.sheet input[aria-label="New category"]').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- the gooey + and its three popups ---------------------------------
  await page.hover('.gooey-desk .gooey-main');
  await page.waitForTimeout(700);
  check('pointing at the + opens its three balls', (await page.locator('.gooey-desk.open').count()) === 1);
  check('and fades the page behind them', (await page.locator('.gooey-scrim-desk').count()) === 1);
  // The pointer travelling from the + to a ball crosses the gap between them;
  // that must not count as leaving (it used to snap them shut on the way).
  {
    const from = await page.locator('.gooey-desk .gooey-main').boundingBox();
    const to = await page.locator('.gooey-desk .gooey-opt[data-kind="transfer"]').boundingBox();
    let shut = 0;
    for (let i = 1; i <= 16; i++) {
      await page.mouse.move(
        from.x + from.width / 2 + ((to.x + to.width / 2) - (from.x + from.width / 2)) * (i / 16),
        from.y + from.height / 2 + ((to.y + to.height / 2) - (from.y + from.height / 2)) * (i / 16),
      );
      await page.waitForTimeout(20);
      if (!(await page.locator('.gooey-desk.open').count())) shut++;
    }
    check('travelling from the + to a ball keeps them open the whole way', shut === 0, `${shut} of 16 steps closed`);
  }
  const plus = await page.locator('.gooey-desk .gooey-main').boundingBox();
  const eye = await page.locator('.topbar .icon-button.refresh').boundingBox();
  check('the + is the same size as the buttons beside it',
    Math.round(plus.width) === Math.round(eye.width) && Math.round(plus.height) === Math.round(eye.height),
    `${plus.width}×${plus.height} vs ${eye.width}×${eye.height}`);
  await page.mouse.move(10, 600);
  await page.waitForTimeout(500);
  check('moving away closes them again', (await page.locator('.gooey-desk.open').count()) === 0);
  for (const [kind, title, go] of [['Spent', 'Spent', 'Save spending'], ['Received', 'Received', 'Save income'], ['Moved', 'Moved', 'Move money']]) {
    await openEntry(page, kind);
    const got = (await page.locator('.sheet.open .pop-title b').textContent()).trim();
    const button = (await page.locator('.sheet.open .pop-foot .go').textContent()).trim();
    check(`${kind} opens its own popup, with its own button`, got === title && button === go, `${got} / ${button}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
  await openEntry(page, 'Spent');
  await page.locator('.sheet input[aria-label="Amount"]').fill('12');
  const order = await page.locator('.sheet.open .pop-figure').evaluate((el) =>
    [...el.children].map((c) => (c.tagName === 'INPUT' ? 'amount' : c.className)).join(','));
  check('the sign comes before the amount and the currency after it', order === 'pop-sign,amount,cur', order);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // --- a phone ------------------------------------------------------------
  const cookies = await context.cookies();
  const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await phoneCtx.addCookies(cookies);
  const phone = await phoneCtx.newPage();
  phone.on('pageerror', (e) => bad.push('PAGE ERROR (phone): ' + e.message));
  await phone.goto(URL, { waitUntil: 'networkidle' });
  await phone.waitForSelector('.flow-card', { timeout: 15000 });
  await phone.click('button[aria-label="Show amounts"]').catch(() => {});
  await phone.waitForTimeout(1200);
  await phone.locator('.breakdown .k', { hasText: 'Spent' }).tap();
  await phone.waitForTimeout(600);
  check('on a phone a tap opens it', (await panelOpen(phone)) && (await panelTitle(phone)) === 'Spent');
  const panelBox = await phone.locator('.flow-panel').boundingBox();
  const tabTop = (await phone.locator('.tabbar').boundingBox()).y;
  check('and it is brought clear of the tab bar', panelBox.y + panelBox.height <= tabTop + 1,
    `panel ends ${Math.round(panelBox.y + panelBox.height)}, tab bar starts ${Math.round(tabTop)}`);
  await phone.locator('.breakdown .k', { hasText: 'Spent' }).tap();
  await phone.waitForTimeout(300);
  check('and a second tap closes it', !(await panelOpen(phone)));
  check('nothing on the phone scrolls sideways',
    (await phone.evaluate(() => document.documentElement.scrollWidth)) <= 390);
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
