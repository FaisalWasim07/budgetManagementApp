const { chromium } = require('playwright');

// Passkeys, driven by a real browser against Chromium's virtual authenticator.
// The API suite proves the cryptography; this proves the part that only exists
// in a browser — that `navigator.credentials` is called with the right shapes,
// that the base64url conversion on both sides agrees, and that a person
// clicking through the screens ends up signed in.
const launchOptions = () =>
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {};

const URL = process.env.TEST_APP_URL || 'http://localhost:5173';
const ok = [];
const bad = [];
const check = (name, cond, extra = '') =>
  (cond ? ok : bad).push(`${cond ? 'PASS' : 'FAIL'} ${name}${extra ? ' :: ' + extra : ''}`);

const stamp = Date.now().toString(36);
const USER = `pkui_${stamp}`;
const PASSWORD = 'passkeyui123';

// A platform authenticator that is already unlocked: the equivalent of a phone
// whose owner has just looked at it. Without this every prompt would hang
// waiting for a face that a test cannot supply.
async function attachAuthenticator(page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  const { authenticatorId } = await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  return { cdp, authenticatorId };
}

const openMenu = async (page) => {
  await page.click('button[aria-label="Menu"]');
  await page.waitForSelector('.menu');
};

const openSettings = async (page) => {
  await openMenu(page);
  await page.click('.menu button:has-text("Settings")');
  await page.waitForSelector('.modal');
  // Settings opens on Money; logins and passkeys are the Account tab.
  await page.click('.modal-tabs button:has-text("Account")');
  await page.waitForTimeout(250);
};

(async () => {
  const browser = await chromium.launch(launchOptions());
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e) => bad.push('PAGE ERROR: ' + e.message));

  await attachAuthenticator(page);

  // --- an account with nothing on it --------------------------------------
  await page.goto(URL, { waitUntil: 'networkidle' });
  // The account and its household are made through the API rather than the
  // forms: another suite covers those screens, and this one is about what
  // happens to signing in afterwards.
  await page.evaluate(
    async ([username, password]) => {
      const json = { 'Content-Type': 'application/json' };
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ username, password }),
      });
      await fetch('/api/households', {
        method: 'POST',
        headers: json,
        body: JSON.stringify({ name: 'Passkey Home', people: ['Faisal'] }),
      });
    },
    [USER, PASSWORD]
  );

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.waitForSelector('.topbar', { timeout: 20000 });
  await openSettings(page);

  const passkeySection = page.locator('.modal', { hasText: 'Passkeys' });
  check('settings has a passkeys section', (await passkeySection.count()) > 0);
  check(
    'and it starts switched off',
    (await page.locator('.modal').textContent()).includes('Off'),
  );

  // --- adding one ----------------------------------------------------------
  await page.click('.modal button:has-text("Add a passkey")');
  await page.waitForSelector('.recovery', { timeout: 15000 });
  const codeCount = await page.locator('.recovery .codes li').count();
  check('adding one shows ten recovery codes', codeCount === 10, String(codeCount));

  const codes = await page.locator('.recovery .codes li').allTextContents();

  const doneDisabled = await page.locator('.recovery button:has-text("Done")').isDisabled();
  check('and will not let you past until you say you saved them', doneDisabled);

  await page.check('.recovery input[type="checkbox"]');
  await page.click('.recovery button:has-text("Done")');
  await page.waitForTimeout(600);

  const after = await page.locator('.modal').textContent();
  check('the passkey is listed afterwards', (await page.locator('.passkey-row').count()) === 1);
  check('and the account reports itself protected', after.includes('On ·'), after.slice(0, 0) || undefined);
  check('with ten codes left', after.includes('10 recovery codes left'));

  // --- signing in now takes two steps -------------------------------------
  await page.click('.modal button:has-text("Close"), .modal [aria-label="Close"]').catch(() => {});
  await openMenu(page);
  await page.click('.menu button:has-text("Sign out")');
  await page.waitForSelector('form.auth-card', { timeout: 15000 });

  await page.fill('input[autocomplete="username"]', USER);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  // The device prompt fires by itself, so this should land on the dashboard
  // without anything else being clicked.
  await page.waitForSelector('.topbar', { timeout: 20000 });
  check('password plus passkey signs you in with nothing typed', (await page.locator('.topbar').count()) === 1);

  // --- the recovery route --------------------------------------------------
  await openMenu(page);
  await page.click('.menu button:has-text("Sign out")');
  await page.waitForSelector('form.auth-card', { timeout: 15000 });

  // A browser with no authenticator at all: the second step has to offer the
  // way round rather than a button that cannot work.
  const bare = await browser.newContext();
  const barePage = await bare.newPage();
  barePage.on('pageerror', (e) => bad.push('PAGE ERROR (bare): ' + e.message));
  await barePage.addInitScript(() => {
    delete window.PublicKeyCredential;
  });
  await barePage.goto(URL, { waitUntil: 'networkidle' });
  await barePage.fill('input[autocomplete="username"]', USER);
  await barePage.fill('input[type="password"]', PASSWORD);
  await barePage.click('button[type="submit"]');
  await barePage.waitForSelector('.auth-card', { timeout: 15000 });
  await barePage.waitForTimeout(400);

  const bareText = await barePage.locator('.auth-card').textContent();
  check('a browser without passkeys is told so', bareText.includes('can’t use passkeys'), bareText.slice(0, 90));
  check('and is offered a recovery code', bareText.includes('Use a recovery code'));

  await barePage.click('button:has-text("Use a recovery code")');
  await barePage.fill('input[autocomplete="one-time-code"]', codes[0]);
  await barePage.click('button:has-text("Use this code")');
  await barePage.waitForSelector('.topbar', { timeout: 20000 });
  check('a recovery code gets in without any device', (await barePage.locator('.topbar').count()) === 1);

  // Cancelling the device prompt. A refused verification is what the page
  // sees when someone dismisses Face ID, and it has to leave the screen usable
  // rather than stuck mid-wait — including the way round.
  const cancelled = await browser.newContext();
  const cancelPage = await cancelled.newPage();
  cancelPage.on('pageerror', (e) => bad.push('PAGE ERROR (cancel): ' + e.message));
  const cancelCdp = await cancelled.newCDPSession(cancelPage);
  await cancelCdp.send('WebAuthn.enable');
  await cancelCdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: false,
      automaticPresenceSimulation: true,
    },
  });

  await cancelPage.goto(URL, { waitUntil: 'networkidle' });
  await cancelPage.fill('input[autocomplete="username"]', USER);
  await cancelPage.fill('input[type="password"]', PASSWORD);
  await cancelPage.click('button[type="submit"]');
  await cancelPage.waitForSelector('button:has-text("Use a recovery code")', { timeout: 15000 });
  await cancelPage.waitForTimeout(1500);

  const cancelText = await cancelPage.locator('.auth-card').textContent();
  check(
    'cancelling the prompt offers the button again rather than an error',
    cancelText.includes('Confirm with your device'),
    cancelText.slice(0, 90)
  );

  await cancelPage.click('button:has-text("Use a recovery code")');
  await cancelPage.fill('input[autocomplete="one-time-code"]', codes[1]);
  const codeButton = cancelPage.locator('button:has-text("Use this code")');
  check('and the code form is ready to use', !(await codeButton.isDisabled()));
  await codeButton.click();
  await cancelPage.waitForSelector('.topbar', { timeout: 20000 });
  check('so a cancelled prompt still ends in the budget', (await cancelPage.locator('.topbar').count()) === 1);

  // A wrong password must never reach the second step, however it is typed.
  const wrong = await browser.newContext();
  const wrongPage = await wrong.newPage();
  await wrongPage.goto(URL, { waitUntil: 'networkidle' });
  await wrongPage.fill('input[autocomplete="username"]', USER);
  await wrongPage.fill('input[type="password"]', 'notmypassword');
  await wrongPage.click('button[type="submit"]');
  await wrongPage.waitForTimeout(900);
  const wrongText = await wrongPage.locator('.auth-card').textContent();
  check(
    'a wrong password stops at the password',
    wrongText.includes('Wrong username or password') && !wrongText.includes('One more step'),
    wrongText.slice(0, 80)
  );

  // --- removing it ---------------------------------------------------------
  await openSettings(barePage);
  await barePage.click('.passkey-row button[aria-label^="Remove"]');
  await barePage.fill('.modal input[autocomplete="current-password"]', PASSWORD);
  await barePage.click('.modal button:has-text("Remove it")');
  await barePage.waitForTimeout(900);
  const removed = await barePage.locator('.modal').textContent();
  check('removing the last one says the account is unprotected again', removed.includes('only lock'), removed.slice(0, 0) || undefined);
  check('and the list is empty', (await barePage.locator('.passkey-row').count()) === 0);

  await browser.close();

  console.log('\nPasskeys (browser)');
  for (const line of [...ok, ...bad]) console.log('  ' + line);
  console.log(`  ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch((err) => {
  console.error('\nSTOPPED: ' + err.message);
  process.exit(1);
});
