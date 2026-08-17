const { chromium } = require('playwright');

// Asking for a passkey before any figure goes on screen.
//
// Driven through a virtual platform authenticator, which is what Face ID and a
// fingerprint reader look like to the browser: the same navigator.credentials
// call, the same user-verification flag, answered without a human. Setting it
// to refuse is how a stranger's face is simulated.

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

  const cdp = await context.newCDPSession(page);
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

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [`lk_${stamp}`, 'lockpass12345']
  );
  await page.goto(URL, { waitUntil: 'networkidle' });

  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Lock Home');
  await page.locator('input[placeholder^="e.g."]').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.waitForTimeout(1200);

  const value = () => page.locator('.hero .value').textContent();
  const masked = async () => (await value()).includes('•');

  // --- with nothing set up, the eye is just the eye ------------------------
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(1700);
  check('with no passkey the eye still just works', !(await masked()), await value());
  await page.click('button[aria-label="Hide amounts"]');
  await page.waitForTimeout(1400);

  const openSettings = async () => {
    await page.click('.sidebar button[aria-label="Menu"], .topbar button[aria-label="Menu"]');
    await page.waitForTimeout(300);
    await page.click('.menu button:has-text("Settings")');
    await page.waitForSelector('.modal', { timeout: 8000 });
    await page.click('.modal-tabs button:has-text("Account")');
    await page.waitForTimeout(700);
  };

  await openSettings();
  check(
    'and the setting is not offered, because there is nothing to check against',
    (await page.locator('.lock-amounts').count()) === 0
  );

  // --- register a passkey, as a person would ------------------------------
  await page.locator('.modal button:has-text("Add a passkey")').first().click();
  await page.waitForTimeout(3000);

  // The very first passkey hands back recovery codes, and the panel shows
  // those instead of the list until they have been acknowledged.
  check(
    'the first passkey comes with recovery codes to write down',
    (await page.locator('.modal button:has-text("Done")').count()) === 1
  );
  await page.locator('.modal input[type="checkbox"]').first().check();
  await page.locator('.modal button:has-text("Done")').click();
  await page.waitForTimeout(900);
  check(
    'a passkey registers through the virtual authenticator',
    (await page.locator('.passkey-row').count()) === 1,
    `${await page.locator('.passkey-row').count()} listed`
  );
  check('and now the setting is offered', (await page.locator('.lock-amounts input').count()) === 1);

  // click(), not check(): check() asserts the box flipped the instant it is
  // clicked, and this one is controlled by the account — it only ticks once the
  // save has come back.
  await page.locator('.lock-amounts input').click();
  await page.waitForTimeout(1500);
  check(
    'the box ticks once the account has taken it',
    await page.locator('.lock-amounts input').isChecked()
  );
  check(
    'turning it on is saved against the account, not the browser',
    (await page.evaluate(async () => {
      const r = await fetch('/api/auth/me');
      return (await r.json()).user.lock_amounts;
    })) === true
  );
  check(
    'and nothing is left behind in this browser',
    (await page.evaluate(() => localStorage.getItem('budget.lockAmounts'))) === null
  );
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // --- the eye now asks ----------------------------------------------------
  check('amounts are hidden to begin with', await masked(), await value());
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(2600);
  check('a verified passkey reveals them', !(await masked()), await value());

  await page.click('button[aria-label="Hide amounts"]');
  await page.waitForTimeout(1400);
  check('hiding never asks for anything', await masked(), await value());

  // --- and refuses when the person is not verified -------------------------
  // Which is a stranger holding the phone: the prompt appears, the face does
  // not match, nothing is revealed.
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(2600);
  check('an unverified person gets nothing', await masked(), await value());
  check(
    'and is not shouted at for it — declining is a normal thing to do',
    (await page.locator('.error-text').count()) === 0
  );

  // --- it comes back when it is you again ----------------------------------
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(2600);
  check('and works again once verified', !(await masked()), await value());

  // --- turning it off puts things back -------------------------------------
  await page.click('button[aria-label="Hide amounts"]');
  await page.waitForTimeout(1400);
  await openSettings();
  await page.locator('.lock-amounts input').click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(1800);
  check(
    'switched off, the eye stops asking — so a lost passkey is not a lock-out',
    !(await masked()),
    await value()
  );

  // Signing in fresh has to arrive already knowing, or the figures show for a
  // moment before the app works out that they should not.
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: true });
  await openSettings();
  await page.locator('.lock-amounts input').click();
  await page.waitForTimeout(1500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check(
    'a reload knows to ask before it has drawn anything',
    (await page.evaluate(async () => {
      const r = await fetch('/api/auth/status');
      return (await r.json()).user.lock_amounts;
    })) === true
  );
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('.hero', { timeout: 15000 });
  await page.waitForTimeout(1200);
  await cdp.send('WebAuthn.setUserVerified', { authenticatorId, isUserVerified: false });
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(2600);
  check('and still refuses after the reload', await masked(), await value());

  await browser.close();
  console.log(ok.concat(bad).join('\n'));
  console.log(`\n  ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch((err) => {
  // Print what did run before the failure, or a timeout tells you nothing
  // about which of the steps before it actually worked.
  console.log(ok.concat(bad).join('\n'));
  console.error('\nSTOPPED:', err.message);
  process.exit(1);
});
