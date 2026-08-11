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

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => {
    bad.push('PAGE ERROR: ' + e.message);
    console.log('>>> STACK\n' + e.stack + '\n<<<');
  });

  // --- first run ---
  await page.goto(URL, { waitUntil: 'networkidle' });
  const h1 = await page.locator('h1').first().textContent();
  check('first run shows setup heading', h1.includes('Set up'), h1);
  check('confirm field present on setup', await page.locator('input[autocomplete="new-password"]').count() === 2);
  check('dashboard not rendered before login', await page.locator('nav.nav').count() === 0);

  // mismatch guard
  await page.fill('input[autocomplete="username"]', 'faisal');
  const pw = page.locator('input[type="password"]');
  await pw.nth(0).fill('testpass123');
  await pw.nth(1).fill('different123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(300);
  check('mismatched passwords rejected client-side', (await page.locator('.error-text').textContent()).includes('don’t match'));

  // short password -> server error surfaced
  await pw.nth(0).fill('short');
  await pw.nth(1).fill('short');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(500);
  check('short password rejected by server', (await page.locator('.error-text').textContent()).includes('8 characters'));

  // real setup
  await page.fill('input[autocomplete="username"]', 'faisal');
  await pw.nth(0).fill('testpass123');
  await pw.nth(1).fill('testpass123');
  await page.click('button[type="submit"]');

  // A brand new account has no household yet, so it is asked to make one
  // before there is any budget to show.
  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 10000 });
  check('setup leads to creating a household', true);
  await page.fill('input[placeholder="Our household"]', 'Test Home');
  await page.locator('input[placeholder^="e.g."]').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');

  await page.waitForSelector('button:has-text("Sign out")', { timeout: 15000 });
  check('the dashboard appears once a household exists', await page.locator('.appbar').count() === 1);
  check('sign out button in top bar', await page.locator('button:has-text("Sign out")').count() === 1);

  // --- session survives reload ---
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('button:has-text("Sign out")', { timeout: 10000 });
  check('session persists across reload', await page.locator('.appbar').count() === 1);

  // --- login settings inside Settings ---
  await page.click('.appbar button:has-text("Settings")');
  await page.waitForSelector('.modal');
  const modalText = await page.locator('.modal').textContent();
  check('settings shows signed-in user', modalText.includes('Signed in as faisal'), modalText.slice(0, 120));
  check('adding a bare login is no longer offered here',
    (await page.locator('button:has-text("Add another login")').count()) === 0);
  check('it points at People & sharing instead',
    (await page.locator('.modal').textContent()).includes('People & sharing'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- sign out ---
  await page.click('button:has-text("Sign out")');
  await page.waitForTimeout(800);
  const h1b = await page.locator('h1').first().textContent();
  check('sign out returns to login form', h1b === 'Household Budget' && (await page.locator('.appbar').count()) === 0, h1b);
  check('login form has no confirm field', await page.locator('input[type="password"]').count() === 1);

  // --- wrong password ---
  await page.fill('input[autocomplete="username"]', 'faisal');
  await page.fill('input[type="password"]', 'nope-nope-nope');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(800);
  check('wrong password shows error', (await page.locator('.error-text').textContent()).includes('Wrong username or password'));
  check('password field cleared after failure', (await page.inputValue('input[type="password"]')) === '');

  // --- signing back in ---
  await page.fill('input[autocomplete="username"]', 'faisal');
  await page.fill('input[type="password"]', 'testpass123');
  await page.click('button[type="submit"]');
  await page.waitForSelector('button:has-text("Sign out")', { timeout: 15000 });
  check('signing back in returns to the budget', (await page.locator('.appbar').count()) === 1);
  check('the household is remembered', (await page.locator('.household-name').textContent()) === 'Test Home');

  // --- expired session mid-use falls back to login ---
  await ctx.clearCookies();
  await page.evaluate(() => window.dispatchEvent(new Event('budget:unauthorized')));
  await page.waitForTimeout(600);
  check('lost session drops back to login screen', (await page.locator('.appbar').count()) === 0, await page.locator('h1').first().textContent());

  console.log([...ok, ...bad].join('\n'));
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  await browser.close();
  process.exit(bad.length ? 1 : 0);
})();
