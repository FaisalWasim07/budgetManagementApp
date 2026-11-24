// Recording money goes through the sheet now. Home used to carry a quick-add
// strip; it was the one thing on the page that was neither a balance nor an
// account, and the + in the top bar and the middle of the phone's bar both
// open the same sheet instead.
async function addMoney(page, { amount, kind = 'Spent', category, description }) {
  await openEntry(page, kind);
  await page.locator('.sheet input[aria-label="Amount"]').fill(String(amount));
  if (category) await pickCategory(page, category);
  if (description) await page.locator('.sheet input[aria-label="Description"]').fill(description);
  await page.locator('.sheet .pop-foot .go').click();
  await page.waitForTimeout(1500);
}

// Recording money starts on the gooey +: in the top bar's corner on a desk,
// in the middle of the tab bar on a phone. It opens to three balls (Spent,
// Received, Moved) and each opens its own popup. On a desk the pointer moving
// onto the + opens it, and the click that follows keeps it open.
const KINDS = { Spent: 'expense', Received: 'income', Moved: 'transfer' };
async function openEntry(page, kind = 'Spent') {
  const fab = (await page.locator('.gooey-desk').count()) ? '.gooey-desk' : '.gooey-phone';
  await page.locator(`${fab} .gooey-main`).first().click();
  await page.locator(`${fab}.open .gooey-opt[data-kind="${KINDS[kind]}"]`).first().click();
  await page.waitForSelector('.sheet.open', { timeout: 8000 });
}

// The category is a dropdown of the ones used before, with "New category…"
// at the bottom opening a box to type one. Picks it if it is listed, types it
// if it is not.
async function pickCategory(page, category) {
  const select = page.locator('.sheet select[aria-label="Category"]');
  const listed = await select.locator('option').evaluateAll(
    (options, wanted) => options.some((o) => o.value === wanted),
    category
  );
  if (listed) {
    await select.selectOption(category);
  } else {
    await select.selectOption('__new');
    await page.locator('.sheet input[aria-label="New category"]').fill(category);
  }
}

// Activity is not in the navigation any more: it opens from the foot of the
// month card on Home. Goes Home first (from the sidebar or the phone's bar,
// whichever this page has), then follows the card's link. No wait after the
// last click, so a check straight after it sees the first frame.
async function openActivity(page) {
  const home = (await page.locator('.side-nav').count())
    ? page.locator('.side-nav button', { hasText: /^Home$/ })
    : page.locator('.tabbar button', { hasText: /^Home$/ });
  await home.click();
  await page.waitForSelector('.flow-activity', { timeout: 15000 });
  await page.locator('.flow-activity').click();
}

// Moving money is the third ball on the +. A move to one account is done in
// its popup; the full dialog (several accounts, shares) is the "Split across
// several accounts" link in it, which is what this opens.
async function openTransfer(page) {
  await openEntry(page, 'Moved');
  await page.locator('.sheet button:has-text("Split across several accounts")').click();
  await page.waitForSelector('.modal', { timeout: 8000 });
}

module.exports = { addMoney, openEntry, openTransfer, pickCategory, openActivity };
