const { chromium } = require('playwright');

// The redesigned dashboard, driven the way a person drives it: type an amount
// into the strip, correct it, delete it, open an account, add from inside it.
// The point of this suite is that a change to how the dashboard looks can never
// quietly take away something it used to do.

const launchOptions = () =>
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// The month is a grid you pick from, not a pair of arrows, so moving by one
// means working out which cell that is — and crossing a year boundary means
// stepping the year first.
async function pickMonth(page, delta) {
  await page.click('.month-trigger');
  await page.waitForSelector('.month-grid');
  const current = await page.locator('.month-trigger .short, .month-trigger .long').first().innerText();
  const index = SHORT.findIndex((m) => current.startsWith(m));
  const target = index + delta;
  if (target < 0) await page.click('.year-nav button[aria-label="Previous year"]');
  if (target > 11) await page.click('.year-nav button[aria-label="Next year"]');
  await page.click(`.month-grid button:has-text("${SHORT[(target + 12) % 12]}")`);
  await page.waitForTimeout(1600);
}

async function backToThisMonth(page) {
  await page.click('.month-trigger');
  await page.waitForSelector('.month-grid');
  await page.click('button:has-text("Back to this month")');
  await page.waitForTimeout(1600);
}

const URL = process.env.TEST_APP_URL || 'http://localhost:5173';
const ok = [];
const bad = [];
const check = (name, cond, extra = '') =>
  (cond ? ok : bad).push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;

(async () => {
  const browser = await chromium.launch(launchOptions());
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', (e) => bad.push('PAGE ERROR: ' + e.message));
  // Deleting asks first; this suite always means yes.
  page.on('dialog', (d) => d.accept());

  // --- set up a household to work in --------------------------------------
  // Signup is the same POST the first-run form makes; going through it directly
  // keeps this suite independent of whether a login already exists.
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [`dash_${stamp}`, 'dashboard123']
  );
  await page.goto(URL, { waitUntil: 'networkidle' });

  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Dash Home');
  await page.locator('input[placeholder^="e.g."]').nth(0).fill('Faisal');
  await page.locator('input[placeholder^="e.g."]').nth(1).fill('Wife');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.waitForTimeout(1200);

  // --- amounts are hidden until you ask ------------------------------------
  check(
    'amounts are hidden when the app opens',
    (await page.locator('.hero .value').textContent()).includes('•'),
    await page.locator('.hero .value').textContent()
  );
  await page.click('button[aria-label="Show amounts"]');
  // The figures disintegrate before the new ones appear — about a second, so
  // waiting less than that would be testing the animation, not the toggle.
  await page.waitForTimeout(1600);
  check(
    'the eye reveals them',
    /\d/.test(await page.locator('.hero .value').textContent()),
    await page.locator('.hero .value').textContent()
  );

  // --- the quick-add strip -------------------------------------------------
  await page.fill('#quick-amount', '9000');
  await page.locator('.quick button:has-text("Received")').click();
  await page.locator('.quick input[aria-label="Category"]').fill('Salary');
  await page.locator('.quick button[type="submit"]').click();
  await page.waitForTimeout(1500);

  check('an entry can be recorded from the strip', (await page.locator('.txn:not(.empty)').count()) === 1);
  check(
    'the strip clears but stays put, ready for the next one',
    (await page.inputValue('#quick-amount')) === '' && (await page.locator('.quick').count()) === 1
  );

  await page.fill('#quick-amount', '240');
  await page.locator('.quick button:has-text("Spent")').click();
  await page.locator('.quick input[aria-label="Category"]').fill('Groceries');
  await page.locator('.quick button[type="submit"]').click();
  await page.waitForTimeout(1500);
  check('a second entry lands too', (await page.locator('.txn:not(.empty)').count()) === 2);

  // --- the month card counts it -------------------------------------------
  const flow = await page.locator('.card:has(.breakdown)').textContent();
  check('the month card shows what came in', flow.includes('9,000'), flow.slice(0, 90));
  check('the month card shows what was spent', flow.includes('240'), flow.slice(0, 140));

  // --- editing -------------------------------------------------------------
  const groceries = page.locator('.txn', { hasText: 'Groceries' }).first();
  await groceries.locator('button[title="Edit"]').click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input[type="number"]').first().fill('275');
  await page.click('.modal button:has-text("Save")');
  await page.waitForTimeout(1500);
  check(
    'an entry can be edited',
    (await page.locator('.txn', { hasText: 'Groceries' }).first().textContent()).includes('275'),
    await page.locator('.txn', { hasText: 'Groceries' }).first().textContent()
  );

  // --- deleting ------------------------------------------------------------
  await page
    .locator('.txn', { hasText: 'Groceries' })
    .first()
    .locator('button[title="Delete"]')
    .click();
  await page.waitForTimeout(1500);
  check(
    'an entry can be deleted',
    (await page.locator('.txn', { hasText: 'Groceries' }).count()) === 0
  );

  // --- filters -------------------------------------------------------------
  await page.click('.filter-row button:has-text("Went out")');
  await page.waitForTimeout(400);
  check('filtering to spending hides the salary', (await page.locator('.txn:not(.empty)').count()) === 0);
  await page.click('.filter-row button:has-text("Everything")');
  await page.waitForTimeout(400);
  check('and everything brings it back', (await page.locator('.txn:not(.empty)').count()) === 1);

  // --- account rows --------------------------------------------------------
  await page.locator('.account-row:not(.add)').first().click();
  await page.waitForTimeout(700);
  check('an account row opens', (await page.locator('.detail.open').count()) === 1);
  check(
    'the open row lists that account’s entries',
    (await page.locator('.detail.open .entries').textContent()).includes('Salary')
  );

  // --- adding from inside an account ---------------------------------------
  await page.locator('.detail.open button:has-text("Add to this account")').click();
  await page.waitForTimeout(500);
  check('"add to this account" opens the sheet', (await page.locator('.sheet.open').count()) === 1);
  check('and it is preset to that account', Boolean(await page.locator('.sheet select').inputValue()));

  await page.locator('.sheet input[aria-label="Amount"]').fill('60');
  await page.locator('.sheet input[aria-label="Category"]').fill('Fuel');
  await page.click('.sheet button:has-text("Save")');
  await page.waitForTimeout(1600);
  check('the sheet saves and closes', (await page.locator('.sheet.open').count()) === 0);
  check('the entry it made is in the list', (await page.locator('.txn', { hasText: 'Fuel' }).count()) === 1);

  // Every row carries an icon worked out from what it was called, and every
  // account row one for what kind of account it is. A row with no tile is a
  // row the list cannot be scanned by.
  const txnCount = await page.locator('.txn:not(.empty)').count();
  check(
    'every entry has an icon tile',
    (await page.locator('.txn:not(.empty) .tile svg').count()) === txnCount,
    `${await page.locator('.txn:not(.empty) .tile svg').count()} of ${txnCount}`
  );
  check(
    'the salary is tinted as money coming in',
    (await page.locator('.txn .tile.in').count()) >= 1
  );
  const accountCount = await page.locator('.account-row:not(.add)').count();
  check(
    'every account has one too',
    (await page.locator('.account-row:not(.add) .tile svg').count()) === accountCount,
    `${await page.locator('.account-row:not(.add) .tile svg').count()} of ${accountCount}`
  );
  check('and each person has an initial', (await page.locator('.person-head .avatar').count()) >= 1);

  // The row itself opens the editor, which is the only way in on a phone —
  // the two icon buttons are hidden there because they cost every entry a
  // second line.
  await page.locator('.txn.tappable').first().click();
  await page.waitForSelector('.modal', { timeout: 8000 });
  check('tapping an entry opens the editor', (await page.locator('.modal').count()) === 1);
  check(
    'and delete is inside it rather than only on the row',
    (await page.locator('.modal button:has-text("Delete")').count()) === 1
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('the app names itself', (await page.locator('.brand .wordmark').textContent()) === 'Bayt');

  // --- moving money between accounts ---------------------------------------
  check(
    'the strip offers two kinds of entry, not three',
    (await page.locator('.quick .seg-mini button').count()) === 2
  );
  check(
    'and moving money is its own button',
    (await page.locator('.quick button:has-text("Move money")').count()) === 1
  );

  await page.click('.quick button:has-text("Move money")');
  await page.waitForSelector('.modal');
  const selects = page.locator('.modal select');
  await selects.nth(0).selectOption({ index: 0 });
  await selects.nth(1).selectOption({ index: 1 });
  await page.locator('.modal input[type="number"]').first().fill('500');
  await page.click('.modal button:has-text("Transfer")');
  await page.waitForTimeout(1800);
  check(
    'a transfer records both sides',
    (await page.locator('.txn b', { hasText: /^(To|From) / }).count()) === 2,
    await page.locator('.txn-list').textContent()
  );

  // --- what a person's total is made of ------------------------------------
  // One currency, so there is nothing to break down and nothing is said.
  check(
    'a single-currency person gets no breakdown',
    (await page.locator('.person .holdings').count()) === 0
  );

  // Add an account in another currency and the total explains itself.
  await page.locator('.account-row.add').first().click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input[placeholder^="e.g."]').fill('Meezan Savings');
  await page.locator('.modal select').first().selectOption('PKR');
  await page.locator('.modal input[type="number"]').first().fill('100000');
  await page.click('.modal button:has-text("Save")');
  await page.waitForTimeout(1800);

  const holdings = await page.locator('.person .holdings').first().textContent();
  check(
    'two currencies are broken down under the total',
    holdings.includes('AED') && holdings.includes('PKR'),
    holdings
  );
  check('and only the person who holds both gets one',
    (await page.locator('.person .holdings').count()) === 1);

  // --- recurring, and how it shows on the dashboard ------------------------
  await page.click('.nav button:has-text("Recurring")');
  await page.waitForSelector('.txn-list');
  await page.click('button:has-text("Add recurring")');
  await page.waitForSelector('.modal');
  await page.locator('.modal input[aria-label="Amount"]').fill('56');
  await page.locator('.modal input[placeholder^="e.g."]').fill('Netflix');
  await page.click('.modal button:has-text("Add")');
  await page.waitForTimeout(1600);
  check('a subscription can be added', (await page.locator('.txn:not(.empty)').count()) === 1);
  check(
    'the page leads with what it costs a month and a year',
    /a month/.test(await page.locator('.recurring-hero').textContent()) &&
      /a year/.test(await page.locator('.recurring-hero').textContent()),
    await page.locator('.recurring-hero').textContent()
  );

  // Editing one — the thing the old page promised in writing and could not do.
  await page.locator('.txn', { hasText: 'Netflix' }).first().locator('button[title="Edit"]').click();
  await page.waitForSelector('.modal');
  await page.locator('.modal input[aria-label="Amount"]').fill('62');
  await page.click('.modal button:has-text("Save")');
  await page.waitForTimeout(1600);
  check(
    'a recurring item can be edited',
    (await page.locator('.txn', { hasText: 'Netflix' }).first().textContent()).includes('62'),
    await page.locator('.txn', { hasText: 'Netflix' }).first().textContent()
  );

  // Stopping is not deleting — but it only has something to keep once the item
  // has actually run, so this steps forward a month first. Stopped from
  // September, August keeps its charge and the item moves to Stopped.
  await pickMonth(page, +1);
  await page.locator('.txn', { hasText: 'Netflix' }).first().locator('button:has-text("Stop")').click();
  await page.waitForTimeout(1600);
  check('stopping moves it out of Going out', (await page.locator('.txn.ended').count()) === 1);
  check(
    'and says which month it stopped in',
    (await page.locator('.txn.ended').first().textContent()).includes('stopped'),
    await page.locator('.txn.ended').first().textContent()
  );

  await page.locator('.txn.ended').first().locator('button:has-text("Restart")').click();
  await page.waitForTimeout(1600);
  check('restarting brings it back', (await page.locator('.txn.ended').count()) === 0);
  await backToThisMonth(page);

  await page.click('.nav button:has-text("Dashboard")');
  await page.waitForTimeout(1600);
  const flowAfter = await page.locator('.card:has(.breakdown)').textContent();
  check('the month card counts the subscription', flowAfter.includes('1 item'), flowAfter.slice(0, 200));

  await page.locator('.account-row:not(.add)').first().click();
  await page.waitForTimeout(700);
  check(
    'the subscription shows inside the account it comes out of',
    (await page.locator('.detail.open .entries').textContent()).includes('Netflix')
  );

  // --- stats ---------------------------------------------------------------
  await page.click('.nav button:has-text("Stats")');
  await page.waitForTimeout(1200);
  check('stats shows six cards', (await page.locator('.chart').count()) === 6);
  const columns = await page.evaluate(
    () => getComputedStyle(document.querySelector('.charts')).gridTemplateColumns.split(' ').length
  );
  check('and lays them out two to a row', columns === 2, `${columns} columns`);

  check('four figures head the page', (await page.locator('.kpi').count()) === 4);
  const kpiLabels = (await page.locator('.kpi .k').allTextContents()).join('|');
  check(
    'and they are net worth, in, out and kept',
    kpiLabels === 'Net worth|Came in|Went out|Kept',
    kpiLabels
  );
  // Every tile has to say how it moved, or the figure is a number without a
  // direction — which is what the old Stats page already did.
  check('each says how it moved since last month', (await page.locator('.kpi .d').count()) === 4);
  // Kept only has a shape once two months have income to work it out from, so
  // a brand-new household draws three of the four.
  const minis = await page.locator('.kpi .mini').count();
  check('and the money figures carry a sparkline', minis >= 3, `${minis} of 4`);

  const slices = await page.locator('.donut circle').count();
  const legend = await page.locator('.donut-legend li').count();
  check('where it went is a donut with a legend per slice', slices > 0 && slices === legend,
    `${slices} slices, ${legend} legend rows`);

  // --- the month, and coming back to today ---------------------------------
  await page.click('.nav button:has-text("Dashboard")');
  await pickMonth(page, -1);
  check('last month has none of this month’s entries', (await page.locator('.txn:not(.empty)').count()) === 0);
  await backToThisMonth(page);
  check('one tap comes back to this month', (await page.locator('.txn:not(.empty)').count()) > 0);

  // Picks an account by name rather than position, so adding one somewhere
  // else in this suite cannot silently point these at the wrong pot.
  const pickIn = async (select, name) => {
    const options = await select.locator('option').allTextContents();
    await select.selectOption({ index: options.findIndex((text) => text.includes(name)) });
  };

  // --- a cross-currency move suggests what will arrive ----------------------
  // Needs a rate to suggest from, and this machine has no internet, so the
  // manual override stands in for the one the app would normally fetch.
  await page.evaluate(async (household) => {
    await fetch('/api/settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'X-Household-Id': String(household) },
      body: JSON.stringify({ manualRates: { PKR: 0.0131 } }),
    });
  }, await page.evaluate(() => localStorage.getItem('budget.householdId')));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(1600);

  await page.click('.quick button:has-text("Move money")');
  await page.waitForSelector('.modal');
  const legs = page.locator('.modal select');
  await pickIn(legs.nth(0), 'Main Account');
  await pickIn(legs.nth(1), 'Meezan Savings');
  await page.locator('.modal input[type="number"]').first().fill('1000');
  await page.waitForTimeout(400);

  const arriving = page.locator('.modal input[type="number"]').nth(1);
  check(
    'the arriving amount is filled in from the rate',
    Number(await arriving.inputValue()) > 76000,
    await arriving.inputValue()
  );
  check(
    'and it says the figure is an estimate',
    (await page.locator('.modal').textContent()).includes('Estimated at today'),
  );
  check(
    'the implied rate is spelled out',
    (await page.locator('.modal').textContent()).includes('1 AED ='),
    (await page.locator('.modal').textContent()).slice(-160)
  );

  // Typing your own stops the estimate overwriting it.
  await arriving.fill('70000');
  await page.waitForTimeout(300);
  await page.locator('.modal input[type="number"]').first().fill('1200');
  await page.waitForTimeout(400);
  check(
    'once you type your own, the estimate leaves it alone',
    (await arriving.inputValue()) === '70000',
    await arriving.inputValue()
  );
  await page.click('.modal button:has-text("Cancel")');
  await page.waitForTimeout(400);

  // --- savings to savings is not saving -------------------------------------
  // Adding up only what arrives counted this as money saved, because the
  // destination reported it arriving and nothing reported it leaving.
  const addAccount = async (name, type, opening) => {
    await page.locator('.account-row.add').first().click();
    await page.waitForSelector('.modal');
    await page.locator('.modal input[placeholder^="e.g."]').fill(name);
    await page.locator('.modal select').nth(1).selectOption(type);
    await page.locator('.modal input[type="number"]').first().fill(String(opening));
    await page.click('.modal button:has-text("Save")');
    await page.waitForTimeout(1600);
  };

  const move = async (from, to, amount) => {
    await page.click('.quick button:has-text("Move money")');
    await page.waitForSelector('.modal');
    const both = page.locator('.modal select');
    await pickIn(both.nth(0), from);
    await pickIn(both.nth(1), to);
    await page.locator('.modal input[type="number"]').first().fill(String(amount));
    await page.click('.modal button:has-text("Transfer")');
    await page.waitForTimeout(1800);
  };

  const savingsTile = () =>
    page.locator('.breakdown > div').filter({ hasText: 'savings' }).first();

  // Intl separates the currency code from the number with a non-breaking
  // space, which does not compare equal to the one you type.
  const figure = async () =>
    (await savingsTile().locator('.v').textContent()).replace(/\s+/g, ' ').trim();

  await addAccount('Rainy Day', 'savings', 5000);
  await addAccount('House Fund', 'savings', 0);

  await move('Rainy Day', 'House Fund', 1000);
  check(
    'moving between two savings accounts is not money saved',
    (await figure()) === 'AED 0',
    await savingsTile().textContent()
  );

  // And the other direction, which the card could not say at all before.
  await move('Rainy Day', 'Main Account', 2000);
  check(
    'taking money out of savings says so',
    (await savingsTile().textContent()).includes('Taken from savings'),
    await savingsTile().textContent()
  );
  check(
    'and shows it as a positive figure',
    (await figure()).includes('2,000'),
    await figure()
  );

  // --- and it is hidden again next time --------------------------------------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  check(
    'a reload hides the amounts again',
    (await page.locator('.hero .value').textContent()).includes('•')
  );

  finish();
  await browser.close();
})();

function finish() {
  console.log([...ok, ...bad].join('\n'));
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
}

process.on('uncaughtException', (err) => {
  console.log([...ok, ...bad].join('\n'));
  console.log('\nSTOPPED: ' + err.message.split('\n')[0]);
  process.exit(1);
});
