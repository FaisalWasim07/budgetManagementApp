const { chromium } = require('playwright');

// Choosing a colour for the app, and it being yours.
//
// The API suite covers storage and validation. This covers what only a browser
// can: that pressing a swatch recolours the page at once, that the choice
// survives a reload and reaches a device that has never seen it, that a second
// person in the same household keeps their own, and that signing out puts the
// login screen back in the brand colour rather than the last person's.

const launchOptions = () =>
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const URL = process.env.TEST_APP_URL || 'http://localhost:5173';
const ok = [];
const bad = [];
const check = (name, cond, extra = '') =>
  (cond ? ok : bad).push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

const stamp = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e3)}`;
const PASSWORD = 'accentpass12345';

const accentOf = (page) => page.evaluate(() => document.documentElement.dataset.accent);
// What the accent actually resolves to on screen, not just the attribute: a
// colour with no CSS behind it would set the attribute and change nothing.
const brandOf = (page) =>
  page.evaluate(() => getComputedStyle(document.querySelector('button.primary')).backgroundImage);

async function signUp(page, username) {
  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [username, PASSWORD]
  );
  await page.goto(URL, { waitUntil: 'networkidle' });
}

async function openColour(page) {
  await page.click('.sidebar button[aria-label="Menu"], .topbar button[aria-label="Menu"]');
  await page.waitForTimeout(300);
  await page.click('.menu button:has-text("Settings")');
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.click('.modal-tabs button:has-text("Account")');
  await page.waitForTimeout(250);
  const row = page.locator('.set-section:has(.set-section-title:text-is("Colour"))');
  if (!(await row.evaluate((el) => el.open))) await row.locator('summary').click();
  await page.waitForTimeout(250);
  return row;
}

(async () => {
  const browser = await chromium.launch(launchOptions());
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on('pageerror', (e) => bad.push('PAGE ERROR: ' + e.message));

  await signUp(page, `ac_${stamp}`);
  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Accent Home');
  await page.locator('input.person-name').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.waitForTimeout(800);

  check('a new account starts in mint', (await accentOf(page)) === 'mint', await accentOf(page));
  const mintBrand = await brandOf(page);

  // --- choosing one -------------------------------------------------------
  const row = await openColour(page);
  check('the closed row says which colour is on',
    (await row.locator('.set-section-state').textContent()).trim() === 'Mint',
    await row.locator('.set-section-state').textContent());
  check('all seven colours are offered', (await row.locator('.accent-swatch').count()) === 7,
    String(await row.locator('.accent-swatch').count()));

  await row.locator('label.accent-swatch:has-text("Ocean")').click();
  await page.waitForTimeout(400);
  check('pressing a swatch recolours the app straight away', (await accentOf(page)) === 'ocean',
    await accentOf(page));
  check('and the colour really changes, not just the attribute', (await brandOf(page)) !== mintBrand,
    await brandOf(page));
  check('the row follows', (await row.locator('.set-section-state').textContent()).trim() === 'Ocean',
    await row.locator('.set-section-state').textContent());

  // Arrow keys, because they are real radios underneath.
  await row.locator('input[value="ocean"]').focus();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(600);
  check('the keyboard moves between colours', (await accentOf(page)) === 'indigo', await accentOf(page));

  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- it is saved --------------------------------------------------------
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  check('it survives a reload', (await accentOf(page)) === 'indigo', await accentOf(page));

  // A device that has never been told: nothing cached, so this can only have
  // come from the account.
  const other = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const phone = await other.newPage();
  await phone.goto(URL, { waitUntil: 'networkidle' });
  await phone.fill('input[autocomplete="username"]', `ac_${stamp}`);
  await phone.locator('input[type="password"]').first().fill(PASSWORD);
  await phone.click('button[type="submit"]');
  await phone.waitForSelector('.hero', { timeout: 15000 });
  check('and reaches another device the moment you sign in there', (await accentOf(phone)) === 'indigo',
    await accentOf(phone));
  await other.close();

  // --- it is yours --------------------------------------------------------
  const inviteCode = await page.evaluate(async () => {
    const hh = await (await fetch('/api/households')).json();
    const id = (hh.households ?? hh)[0].id;
    const res = await fetch(`/api/households/${id}/invites`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'editor' }),
    });
    return (await res.json()).code;
  });
  const second = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const them = await second.newPage();
  await signUp(them, `ac2_${stamp}`);
  await them.evaluate(async (code) => {
    await fetch('/api/households/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
  }, inviteCode);
  await them.goto(URL, { waitUntil: 'networkidle' });
  await them.waitForSelector('.hero', { timeout: 15000 });
  check('someone else in the same household does not get my colour', (await accentOf(them)) === 'mint',
    await accentOf(them));
  const theirRow = await openColour(them);
  await theirRow.locator('label.accent-swatch:has-text("Clay")').click();
  await them.waitForTimeout(600);
  await second.close();

  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  check('and their choosing one leaves mine alone', (await accentOf(page)) === 'indigo', await accentOf(page));

  // --- signing out --------------------------------------------------------
  await page.click('.sidebar button[aria-label="Menu"], .topbar button[aria-label="Menu"]');
  await page.waitForTimeout(300);
  await page.click('.menu button:has-text("Sign out")');
  await page.waitForSelector('input[autocomplete="username"]', { timeout: 10000 });
  check('signing out puts the login screen back in mint', (await accentOf(page)) === 'mint',
    await accentOf(page));
  check('and forgets the cached colour, so the next person does not start in it',
    (await page.evaluate(() => localStorage.getItem('budget.accent'))) === null,
    String(await page.evaluate(() => localStorage.getItem('budget.accent'))));

  await browser.close();
  console.log(ok.concat(bad).join('\n'));
  console.log(`\n  ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch((err) => {
  console.log(ok.concat(bad).join('\n'));
  console.error('\nSTOPPED:', err.message);
  process.exit(1);
});
