const { chromium } = require('playwright');

// The desktop sidebar: folding it to a rail, and saying who you are by name.

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

  const username = `sb_${stamp}`;
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [username, 'sidebarpass123']
  );
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Side Home');
  await page.locator('input.person-name').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('nav.side-nav', { timeout: 15000 });
  await page.waitForTimeout(800);

  // --- who you are --------------------------------------------------------
  check('the sidebar names you as the person you are here, not your login',
    (await page.locator('.side-you-name b').textContent()) === 'Faisal',
    await page.locator('.side-you-name b').textContent());
  check('with the login still there on hover',
    (await page.locator('.side-you').getAttribute('title')) === `Signed in as ${username}`,
    await page.locator('.side-you').getAttribute('title'));

  // --- folding ------------------------------------------------------------
  const opacity = () => page.locator('.side-toggle').evaluate((el) => getComputedStyle(el).opacity);
  const width = () => page.locator('.sidebar').evaluate((el) => Math.round(el.getBoundingClientRect().width));
  await page.mouse.move(900, 500);
  await page.waitForTimeout(250);
  check('the fold button is out of sight while the pointer is on the page', (await opacity()) === '0', await opacity());
  await page.mouse.move(100, 400);
  await page.waitForTimeout(250);
  check('and appears when it is over the navigation', (await opacity()) === '1', await opacity());

  const wide = await width();
  await page.locator('.side-toggle').click();
  await page.waitForTimeout(450);
  check('pressing it folds the sidebar to a rail', (await width()) < wide && (await width()) <= 64,
    `${wide} → ${await width()}`);
  const stats = page.locator('.side-nav button').nth(1);
  check('the icons keep their names for a screen reader', (await stats.innerText()).includes('Stats'),
    await stats.innerText());
  check('and show them as a tooltip', (await stats.getAttribute('title')) === 'Stats', await stats.getAttribute('title'));
  check('the button says what it will do now',
    (await page.locator('.side-toggle').getAttribute('aria-label')) === 'Expand navigation');

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('nav.side-nav', { timeout: 15000 });
  await page.waitForTimeout(400);
  check('it stays folded after a reload', (await width()) <= 64, String(await width()));

  await page.mouse.move(30, 400);
  await page.waitForTimeout(250);
  await page.locator('.side-toggle').click();
  await page.waitForTimeout(450);
  check('and the same button opens it again', (await width()) === wide, `${await width()} vs ${wide}`);

  await browser.close();
  console.log(ok.concat(bad).join('\n'));
  console.log(`\n  ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch((err) => {
  console.log(ok.concat(bad).join('\n'));
  console.error('\nSTOPPED:', err.message);
  process.exit(1);
});
