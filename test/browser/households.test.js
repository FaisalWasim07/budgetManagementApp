const { chromium } = require('playwright');
const { addMoney } = require('./helpers');

// CHROMIUM_PATH covers machines with a browser already installed elsewhere;
// otherwise Playwright uses the one it downloaded.
const launchOptions = () =>
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const URL = process.env.TEST_APP_URL || 'http://localhost:5173';
const ok = [];
const bad = [];
const check = (name, cond, extra = '') =>
  (cond ? ok : bad).push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

const stamp = Date.now().toString(36).slice(-5);

async function signUp(page, username, password) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  // If a login form is showing, switch to creating an account via the API-backed
  // signup the setup form posts to.
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [username, password]
  );
  await page.goto(URL, { waitUntil: 'networkidle' });
}

(async () => {
  const browser = await chromium.launch(launchOptions());

  // --- person A: brand new account, no household -------------------------
  const ctxA = await browser.newContext();
  const a = await ctxA.newPage();
  a.on('pageerror', (e) => bad.push('PAGE ERROR (A): ' + e.message));

  await signUp(a, `ui_a_${stamp}`, 'passwordA123');
  await a.waitForSelector('h1', { timeout: 10000 });
  const heading = await a.locator('h1').first().textContent();
  check('a new account is asked to set up a household', heading.includes('Set up your household'), heading);

  await a.fill('input[placeholder="Our household"]', 'Faisal Home');
  const people = a.locator('input[placeholder^="e.g."]');
  await people.nth(0).fill('Faisal');
  await people.nth(1).fill('Wife');
  await a.click('button:has-text("Create household")');
  await a.waitForSelector('nav.side-nav', { timeout: 15000 });
  await a.waitForTimeout(1500);

  check('the dashboard appears after creating a household', await a.locator('nav.side-nav').count() === 1);
  const sections = await a.locator('.person').count();
  check('both people are shown with their accounts', sections === 2, String(sections));
  // '+ Add an account' is a row too, so each person shows two.
  const accountRows = await a.locator('.account-row:not(.add)').count();
  check('each person got a main account', accountRows === 2, String(accountRows));
  check('household name is in the top bar', (await a.locator('.household-name').textContent()) === 'Faisal Home');

  // --- record money -------------------------------------------------------
  // Money is recorded through the sheet the + opens, on either shell.
  await addMoney(a, { amount: '9000', kind: 'Received', category: 'Salary' });

  await a.click('.side-nav button:has-text("Activity")');
  await a.waitForTimeout(600);
  const listText = await a.locator('.txn-list').textContent();
  check('the entry appears in the activity list', listText.includes('Salary'), listText.slice(0, 120));
  check('the entry shows who added it', listText.includes(`ui_a_${stamp}`), listText.slice(0, 160));
  check('the entry shows a date', /\w{3}\s+\d{1,2}/.test(listText), listText.slice(0, 160));

  // --- add a person from the sharing screen -------------------------------
  await a.click('.household-trigger');
  await a.click('button:has-text("People & sharing")');
  await a.waitForSelector('.modal');
  await a.fill('input[placeholder^="Add a person"]', 'Child');
  await a.click('button:has-text("Add person")');
  await a.waitForTimeout(1500);
  const modalText = await a.locator('.modal').textContent();
  check('a person can be added from the sharing screen', modalText.includes('Child'), modalText.slice(0, 150));
  check('sharing is in tabs', (await a.locator('.modal-tabs button').count()) === 2);
  // Nothing may scroll inside the dialog — that was the point of the tabs.
  const inner = await a.evaluate(() => {
    const m = document.querySelector('.modal');
    return m.scrollHeight > m.clientHeight + 1;
  });
  check('and the dialog does not scroll inside itself', inner === false);

  // --- create a viewer invite ---------------------------------------------
  await a.click('.modal-tabs button:has-text("Access")');
  await a.waitForTimeout(300);
  await a.selectOption('select[aria-label="Invite role"]', 'viewer');
  await a.click('button:has-text("Create an invite code")');
  await a.waitForTimeout(1200);
  const code = await a.locator('.invite-code').first().textContent();
  check('an invite code is produced', Boolean(code && code.length > 8), code || '(none)');
  await a.keyboard.press('Escape');

  // --- person B: joins with the code --------------------------------------
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage();
  b.on('pageerror', (e) => bad.push('PAGE ERROR (B): ' + e.message));

  await signUp(b, `ui_b_${stamp}`, 'passwordB123');
  await b.waitForSelector('h1', { timeout: 10000 });
  await b.click('button:has-text("Join with a code")');
  await b.fill('input[required]', code.trim());
  await b.click('form button[type="submit"]');
  await b.waitForSelector('nav.side-nav', { timeout: 15000 });
  await b.waitForTimeout(1500);

  check('the invitee lands in the household', (await b.locator('.household-name').textContent()) === 'Faisal Home');
  const banner = await b.locator('.warn-banner').count();
  check('a viewer is told they are read-only', banner === 1);
  await b.click('.side-nav button:has-text("Activity")');
  await b.waitForTimeout(600);
  check('a viewer sees the money', (await b.locator('.txn-list').textContent()).includes('Salary'));
  check('a viewer gets no way to add money', await b.locator('.add-top').count() === 0);
  check('a viewer cannot add an account', await b.locator('.account-row.add').count() === 0);
  check('a viewer gets no edit or delete buttons', await b.locator('.txn-acts').count() === 0);
  // A disabled + is a promise already broken; it is not in their bar at all.
  check('a viewer gets no add button', await b.locator('.tabbar .add').count() === 0);
  check(
    'and an account they open offers them nothing to change',
    await (async () => {
      await b.click('.side-nav button:has-text("Home")');
      await b.waitForTimeout(500);
      await b.locator('.account-row:not(.add)').first().click();
      await b.waitForSelector('.account-page', { timeout: 8000 });
      // The account's actions live in the top bar now, so that is where a
      // viewer must find nothing.
      const buttons = await b.locator('#tool-slot button').count();
      await b.click('.page-title .crumb');
      await b.waitForTimeout(400);
      return buttons === 0;
    })()
  );

  // --- person B makes their own household, and switches -------------------
  await b.click('.household-trigger');
  await b.click('button:has-text("New or join a household")');
  await b.waitForSelector('input[placeholder="Our household"]', { timeout: 10000 });
  await b.fill('input[placeholder="Our household"]', 'Bob Home');
  await b.locator('input[placeholder^="e.g."]').nth(0).fill('Bob');
  await b.click('button:has-text("Create household")');
  await b.waitForSelector('nav.side-nav', { timeout: 15000 });
  await b.waitForTimeout(1500);

  check('the second household becomes current', (await b.locator('.household-name').textContent()) === 'Bob Home');
  await b.click('.side-nav button:has-text("Activity")');
  await b.waitForTimeout(600);
  check('the new household has none of the other one’s money',
    !(await b.locator('.txn-list').textContent()).includes('Salary'));
  await b.click('.side-nav button:has-text("Home")');
  await b.waitForTimeout(600);
  check('in their own household they can write again', await b.locator('.add-top').count() === 1);

  await b.click('.household-trigger');
  const options = await b.locator('.menu button').allTextContents();
  check('both households are listed to switch between',
    options.some((o) => o.includes('Faisal Home')) && options.some((o) => o.includes('Bob Home')),
    options.join(' | '));

  // --- switching back is still read-only ----------------------------------
  await b.click('.menu button:has-text("Faisal Home")');
  await b.waitForTimeout(2000);
  check('switching back restores view-only', await b.locator('.warn-banner').count() === 1);

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
