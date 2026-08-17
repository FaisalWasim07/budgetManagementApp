const { chromium } = require('playwright');
const { addMoney } = require('./helpers');

// The phone shell, driven at the width it is actually used at. Everything the
// other suites check is checked at a desk, where there is room for a sidebar
// and for buttons on every row — so a control that only exists on the desktop
// shell passes them all and is still missing on a phone.
//
// That is exactly how recurring items became uneditable on a phone: the row's
// edit, stop and delete buttons are not drawn at this width, and nothing else
// opened the item.

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
  const context = await browser.newContext({
    viewport: { width: 393, height: 850 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => bad.push('PAGE ERROR: ' + e.message));
  page.on('dialog', (d) => d.accept());

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.evaluate(
    async ([u, p]) => {
      await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: u, password: p }),
      });
    },
    [`ph_${stamp}`, 'phone12345']
  );
  await page.goto(URL, { waitUntil: 'networkidle' });

  await page.waitForSelector('input[placeholder="Our household"]', { timeout: 15000 });
  await page.fill('input[placeholder="Our household"]', 'Phone Home');
  await page.locator('input[placeholder^="e.g."]').nth(0).fill('Faisal');
  await page.click('button:has-text("Create household")');
  await page.waitForSelector('.tabbar', { timeout: 15000 });
  await page.waitForTimeout(1200);
  // Amounts open masked, so a figure cannot be read back until the eye is
  // opened — the dust animation takes about a second.
  await page.click('button[aria-label="Show amounts"]');
  await page.waitForTimeout(1600);

  // --- the shell is the phone's, not the desk's ---------------------------
  check('the sidebar is gone', (await page.locator('nav.side-nav:visible').count()) === 0);
  check('the tab bar is there instead', (await page.locator('.tabbar').count()) === 1);
  check('nothing scrolls sideways', !(await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1
  )));

  await addMoney(page, { amount: '900', kind: 'Received', category: 'Salary' });

  // --- an entry can be edited by tapping its row --------------------------
  await page.locator('.tabbar button', { hasText: /^Activity$/ }).click();
  await page.waitForTimeout(900);
  check('rows carry no buttons at this width', (await page.locator('.txn-acts:visible').count()) === 0);
  await page.locator('.txn.tappable').first().tap();
  await page.waitForSelector('.modal', { timeout: 8000 });
  check('so tapping the row is what opens it', (await page.locator('.modal').count()) === 1);
  // The month an entry counts in is almost never why you opened this, so it is
  // folded away — and it is the app's own picker, not a browser's.
  check('no native month control is left', (await page.locator('.modal input[type="month"]').count()) === 0);
  check(
    'the month is folded away until it disagrees',
    (await page.locator('.modal details.tuck').count()) === 1 &&
      (await page.locator('.modal details.tuck[open]').count()) === 0
  );
  await page.locator('.modal button:has-text("Cancel")').tap();
  await page.waitForTimeout(400);

  // --- swiping a row aside deletes it -------------------------------------
  // Driven through CDP rather than Playwright's tap, because the whole point
  // is the movement between the finger going down and coming up — and both
  // bugs this covers lived in exactly that gap. The first shipped with the
  // easing sign inverted, so past the trigger the row crept backwards and
  // could never arm; the second let a sideways drag also pull the refresh
  // indicator down, because a real thumb never travels in a straight line.
  const touch = await context.newCDPSession(page);
  const swipeLeft = async (locator, distance, atMidpoint) => {
    const box = await locator.boundingBox();
    // Drifting a little downward on purpose: a horizontal swipe that is
    // perfectly horizontal is not one a hand ever makes, and the vertical
    // component is what used to wake pull-to-refresh.
    const x0 = box.x + box.width - 24;
    const y0 = box.y + box.height / 2;
    await touch.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ x: x0, y: y0 }],
    });
    const steps = 10;
    for (let i = 1; i <= steps; i += 1) {
      await touch.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [{ x: x0 - (distance * i) / steps, y: y0 + i * 1.5 }],
      });
      if (i === Math.round(steps / 2) && atMidpoint) await atMidpoint();
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  // At the very top of the page, which is the only place pull-to-refresh arms.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const before = await page.locator('.txn.tappable').count();
  const first = page.locator('.txn.tappable').first();
  const target = (await first.locator('.what b').textContent()).trim();

  let pulledWhileSwiping = true;
  await swipeLeft(first, 170, async () => {
    pulledWhileSwiping = (await page.locator('.pull-hint').count()) > 0;
    check(
      'a row follows the finger as it is dragged aside',
      (await page.locator('.swipe-front').first().evaluate(
        (el) => new DOMMatrix(getComputedStyle(el).transform).m41
      )) < -40
    );
  });
  await page.waitForTimeout(1600);

  check('swiping sideways does not also pull the page to refresh', !pulledWhileSwiping);
  check(
    'and letting go past the threshold deletes the row',
    (await page.locator('.txn.tappable').count()) === before - 1,
    `${before} before, ${await page.locator('.txn.tappable').count()} after`
  );
  const undoOffered = (await page.locator('.toast button:has-text("Undo")').count()) === 1;
  check('with an undo offered rather than a question', undoOffered);
  check(
    'and the editor did not open behind it',
    (await page.locator('.modal').count()) === 0
  );

  // Guarded: if the swipe did not delete, tapping a button that was never
  // drawn times the whole suite out and reports nothing about why.
  if (undoOffered) {
    await page.locator('.toast button:has-text("Undo")').tap();
    await page.waitForTimeout(1500);
    check(
      'undo puts the swiped row back',
      (await page.locator('.txn.tappable').count()) === before,
      `expected ${before}`
    );
  } else {
    check('undo puts the swiped row back', false, 'nothing was deleted to undo');
  }

  // A short drag is a wobble, not a decision.
  await page.evaluate(() => window.scrollTo(0, 0));
  await swipeLeft(page.locator('.txn.tappable').first(), 40);
  await page.waitForTimeout(1200);
  check(
    'a half-hearted swipe deletes nothing',
    (await page.locator('.txn.tappable').count()) === before
  );
  void target;

  // --- a recurring item can be reached at all -----------------------------
  await page.locator('.tabbar button', { hasText: /^Recurring$/ }).click();
  await page.waitForTimeout(900);
  await page.locator('button:has-text("Add item")').tap();
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.locator('.modal input[aria-label="Amount"]').fill('56');
  await page.locator('.modal input[placeholder^="e.g."]').first().fill('Netflix');
  await page.locator('.modal button:has-text("Add")').tap();
  await page.waitForTimeout(1800);
  check('a recurring item can be added on a phone', (await page.locator('.txn:not(.empty)').count()) >= 1);

  const row = page.locator('.recurring-lists .txn', { hasText: 'Netflix' }).first();
  check('its row has no buttons either', (await row.locator('.txn-acts:visible').count()) === 0);
  await row.tap();
  await page.waitForSelector('.modal', { timeout: 8000 });
  check('tapping it opens the editor', (await page.locator('.modal').count()) === 1);
  // Delete has nowhere else to live on this shell. Stop is not offered here:
  // the item starts this month, so stopping it would remove it, which is what
  // delete already does.
  check('the editor carries delete', (await page.locator('.modal button:has-text("Delete")').count()) === 1);
  check(
    'and no Stop, which would do the same thing to this one',
    (await page.locator('.modal button:has-text("Stop")').count()) === 0
  );
  await page.locator('.modal input[aria-label="Amount"]').fill('61');
  await page.locator('.modal button:has-text("Update")').tap();
  await page.waitForTimeout(1800);
  check(
    'and the change sticks',
    (await page.locator('.txn', { hasText: 'Netflix' }).first().textContent()).includes('61'),
    await page.locator('.txn', { hasText: 'Netflix' }).first().textContent()
  );

  // Deleting from inside the dialog is the only way to remove one here.
  await page.locator('.recurring-lists .txn', { hasText: 'Netflix' }).first().tap();
  await page.waitForSelector('.modal', { timeout: 8000 });
  await page.locator('.modal button:has-text("Delete")').tap();
  await page.waitForTimeout(700);
  // Deleting a recurring item erases it from every month it ever charged, so
  // it asks — in the app's own dialog now, not the browser's, which a phone
  // labels with the site's hostname and which cannot say what is at stake.
  check(
    'and deleting a recurring item asks first',
    (await page.locator('.modal.confirm').count()) === 1
  );
  check(
    'saying what it will take',
    /every month it ever charged/i.test(await page.locator('.confirm-detail').textContent())
  );
  await page.locator('.modal.confirm button:has-text("Delete")').tap();
  await page.waitForTimeout(1800);
  check(
    'deleting works from the dialog',
    (await page.locator('.txn', { hasText: 'Netflix' }).count()) === 0
  );

  // --- the bar fits, and refresh lives in the menu -------------------------
  // At this width there is no room for a refresh button of its own; putting
  // one there pushed the menu — and with it sign-out — off the right edge.
  check(
    'no refresh button crowds the bar',
    (await page.locator('.topbar button[aria-label="Refresh"]').count()) === 0
  );
  check(
    'the bar does not overflow',
    !(await page.evaluate(() => {
      const bar = document.querySelector('.topbar-inner');
      return bar.scrollWidth > bar.clientWidth + 1;
    }))
  );
  check(
    'the menu is still reachable',
    await page.locator('.topbar button[aria-label="Menu"]').isVisible()
  );
  await page.locator('.topbar button[aria-label="Menu"]').tap();
  await page.waitForTimeout(300);
  check('and refresh is in it', (await page.locator('.menu button:has-text("Refresh")').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // --- a sheet holds the page still ---------------------------------------
  await page.locator('.tabbar button', { hasText: /^Activity$/ }).click();
  await page.waitForTimeout(900);
  await page.evaluate(() => window.scrollTo(0, 40));
  await page.locator('.tabbar button.add').tap();
  await page.waitForSelector('.sheet.open', { timeout: 8000 });
  check(
    'the page is locked behind the add sheet',
    (await page.evaluate(() => document.body.style.overflow)) === 'hidden'
  );

  await browser.close();
  console.log(ok.concat(bad).join('\n'));
  console.log(`\n  ${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch((err) => {
  console.error('\nSTOPPED:', err.message);
  process.exit(1);
});
