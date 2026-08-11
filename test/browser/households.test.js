const { chromium } = require('playwright');

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
  await a.waitForSelector('nav.nav', { timeout: 15000 });
  await a.waitForTimeout(1500);

  check('the dashboard appears after creating a household', await a.locator('nav.nav').count() === 1);
  const sections = await a.locator('.columns > section').count();
  check('both people are shown with their accounts', sections === 2, String(sections));
  const accountCards = await a.locator('.account').count();
  check('each person got a main account', accountCards === 2, String(accountCards));
  check('household name is in the top bar', (await a.locator('.household-name').textContent()) === 'Faisal Home');

  // --- record money -------------------------------------------------------
  await a.locator('.account').first().locator('input[type="number"]').fill('9000');
  await a.locator('.account').first().locator('input[type="text"]').fill('Salary');
  await a.locator('.account').first().locator('select').selectOption('income');
  await a.locator('.account').first().locator('button:has-text("Add")').click();
  await a.waitForTimeout(1500);

  const tableText = await a.locator('table').first().textContent();
  check('the entry shows who added it', tableText.includes(`ui_a_${stamp}`), tableText.slice(0, 120));
  check('the entry shows a date', /\w{3}\s+\d{1,2},\s*\d{2}/.test(tableText), tableText.slice(-60));

  // --- add a person from the sharing screen -------------------------------
  await a.click('.household-trigger');
  await a.click('button:has-text("People & sharing")');
  await a.waitForSelector('.modal');
  await a.fill('input[placeholder^="Add a person"]', 'Child');
  await a.click('button:has-text("Add person")');
  await a.waitForTimeout(1500);
  const modalText = await a.locator('.modal').textContent();
  check('a person can be added from the sharing screen', modalText.includes('Child'), modalText.slice(0, 150));

  // --- create a viewer invite ---------------------------------------------
  await a.selectOption('select[aria-label="Invite role"]', 'viewer');
  await a.click('button:has-text("Create invite")');
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
  await b.waitForSelector('nav.nav', { timeout: 15000 });
  await b.waitForTimeout(1500);

  check('the invitee lands in the household', (await b.locator('.household-name').textContent()) === 'Faisal Home');
  const banner = await b.locator('.warn-banner').count();
  check('a viewer is told they are read-only', banner === 1);
  check('a viewer sees the money', (await b.locator('table').first().textContent()).includes('Salary'));
  check('a viewer gets no Add buttons', await b.locator('.account button:has-text("Add")').count() === 0);
  check('a viewer gets no Move money button', await b.locator('button:has-text("Move money")').count() === 0);
  check('a viewer gets no Delete buttons', await b.locator('table button:has-text("Delete")').count() === 0);

  // --- person B makes their own household, and switches -------------------
  await b.click('.household-trigger');
  await b.click('button:has-text("New or join a household")');
  await b.waitForSelector('input[placeholder="Our household"]', { timeout: 10000 });
  await b.fill('input[placeholder="Our household"]', 'Bob Home');
  await b.locator('input[placeholder^="e.g."]').nth(0).fill('Bob');
  await b.click('button:has-text("Create household")');
  await b.waitForSelector('nav.nav', { timeout: 15000 });
  await b.waitForTimeout(1500);

  check('the second household becomes current', (await b.locator('.household-name').textContent()) === 'Bob Home');
  check('the new household has none of the other one’s money',
    !(await b.locator('table').first().textContent()).includes('Salary'));
  check('in their own household they can write again', await b.locator('.account button:has-text("Add")').count() > 0);

  await b.click('.household-trigger');
  const options = await b.locator('.household-option').allTextContents();
  check('both households are listed to switch between',
    options.some((o) => o.includes('Faisal Home')) && options.some((o) => o.includes('Bob Home')),
    options.join(' | '));

  // --- switching back is still read-only ----------------------------------
  await b.click('.household-option:has-text("Faisal Home")');
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
