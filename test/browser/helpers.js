// Recording money goes through the sheet now. Home used to carry a quick-add
// strip; it was the one thing on the page that was neither a balance nor an
// account, and the + in the top bar and the middle of the phone's bar both
// open the same sheet instead.
async function addMoney(page, { amount, kind = 'Spent', category }) {
  const opener = (await page.locator('.add-top').count())
    ? '.add-top'
    : '.tabbar button.add';
  await page.click(opener);
  await page.waitForSelector('.sheet.open', { timeout: 8000 });
  await page.locator('.sheet input[aria-label="Amount"]').fill(String(amount));
  await page.locator(`.sheet button:has-text("${kind}")`).click();
  if (category) await page.locator('.sheet input[aria-label="Category"]').fill(category);
  await page.locator('.sheet button:has-text("Save")').click();
  await page.waitForTimeout(1500);
}

// Moving money is a button inside the sheet rather than a third mode of it,
// so reaching the transfer form means opening the sheet first.
async function openTransfer(page) {
  const opener = (await page.locator('.add-top').count()) ? '.add-top' : '.tabbar button.add';
  await page.click(opener);
  await page.waitForSelector('.sheet.open', { timeout: 8000 });
  await page.locator('.sheet button:has-text("Move money")').click();
}

module.exports = { addMoney, openTransfer };
