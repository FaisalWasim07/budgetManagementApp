const db = require('../db/pool');
const { shiftMonth, subscriptionChargesThrough } = require('./summaryService');

// Recurring items are never written into the ledger — every month's total is
// worked out from the item itself, on the fly. That is what makes ending one
// correct every future month at once, and it is also the trap: changing an
// item's amount would silently restate every month it has ever been charged.
// Last March's total would move because Netflix put its price up in August.
//
// So a change that affects money does not edit the item. It closes the old one
// at the end of last month and opens a new one from this month, which is what
// actually happened: you paid 56 until August and 62 after it. Everything here
// exists to make that one idea hold.

// Changing any of these changes what a month costs, so it has to start a new
// period rather than rewrite the old one. Everything else — the name, the
// category, a note — is a label, and a label can be corrected retrospectively
// because it was never money.
const MONEY_FIELDS = ['account_id', 'amount', 'direction', 'cycle', 'billing_month'];

const changed = (existing, patch, field) =>
  Object.prototype.hasOwnProperty.call(patch, field) &&
  patch[field] != null &&
  String(patch[field]) !== String(existing[field]);

const touchesMoney = (existing, patch) =>
  MONEY_FIELDS.some((field) => changed(existing, patch, field));

// Has this item ever been charged before `month`? An item created this month,
// or one whose price is corrected the same month it started, has no history to
// protect and is simply edited.
const chargedBefore = (item, month) =>
  subscriptionChargesThrough(item, shiftMonth(month, -1)) > 0;

const billingMonthFor = (item) =>
  item.cycle === 'yearly'
    ? item.billing_month || Number(String(item.start_month).split('-')[1])
    : null;

const fields = (item) => [
  item.account_id,
  String(item.name).trim(),
  item.direction,
  item.amount,
  item.cycle,
  billingMonthFor(item),
  item.start_month,
  item.end_month || null,
  item.category || null,
  item.notes || null,
  item.is_active ? 1 : 0,
];

const COLUMNS = `account_id, name, direction, amount, cycle, billing_month,
                 start_month, end_month, category, notes, is_active`;

async function update(id, item) {
  return db.get(
    `UPDATE subscriptions
     SET account_id = ?, name = ?, direction = ?, amount = ?, cycle = ?, billing_month = ?,
         start_month = ?, end_month = ?, category = ?, notes = ?, is_active = ?
     WHERE id = ? RETURNING *`,
    [...fields(item), id]
  );
}

async function insert(item) {
  return db.get(
    `INSERT INTO subscriptions (${COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
    fields(item)
  );
}

// Applies a patch from `month` onwards. Returns the row that now describes the
// item going forward, plus whether history was split off behind it.
async function change(existing, patch, month) {
  const merged = { ...existing, ...patch };

  if (!touchesMoney(existing, patch) || !chargedBefore(existing, month)) {
    return { item: await update(existing.id, merged), split: false };
  }

  return db.tx(async (t) => {
    // The old period stops at the end of last month. Its amount, and therefore
    // every month it covered, is left exactly as it was.
    await t.run('UPDATE subscriptions SET end_month = ? WHERE id = ?', [
      shiftMonth(month, -1),
      existing.id,
    ]);

    const item = await t.get(
      `INSERT INTO subscriptions (${COLUMNS})
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
      fields({
        ...merged,
        start_month: month,
        // A future end date belongs to the new period; one already in the past
        // was the old period's and must not be carried forward.
        end_month: merged.end_month && merged.end_month >= month ? merged.end_month : null,
      })
    );

    return { item, split: true, endedId: existing.id };
  });
}

// Stopping is not deleting and not hiding: it is saying "this no longer runs
// from here on". The months it did run stay exactly as they were.
async function stop(existing, month) {
  const end = shiftMonth(month, -1);

  // Stopping something before it ever ran leaves nothing behind, so the item
  // goes rather than lingering as a period of zero months.
  if (end < existing.start_month) {
    await db.run('DELETE FROM subscriptions WHERE id = ?', [existing.id]);
    return { item: null, removed: true };
  }

  const item = await db.get(
    'UPDATE subscriptions SET end_month = ?, is_active = 1 WHERE id = ? RETURNING *',
    [end, existing.id]
  );
  return { item, removed: false };
}

// Two different things wear the same word. Restarting something you stopped
// last month is an undo — the item simply carries on. Restarting one that
// stopped in March is a new period, and clearing its end date instead would
// quietly bill you for April through July, which is the exact retroactive
// rewrite this whole file exists to prevent.
async function resume(existing, month) {
  const wasStoppedLastMonth = existing.end_month === shiftMonth(month, -1);
  const neverStarted = existing.start_month > month;

  if (existing.is_active !== 1) {
    // An item archived under the old is_active flag has no end date to reason
    // about; bringing it back starts it from this month.
    const item = await update(existing.id, {
      ...existing,
      is_active: 1,
      start_month: existing.start_month > month ? existing.start_month : month,
      end_month: null,
    });
    return { item, restarted: true };
  }

  if (wasStoppedLastMonth || neverStarted) {
    const item = await update(existing.id, { ...existing, end_month: null });
    return { item, restarted: false };
  }

  const item = await insert({ ...existing, start_month: month, end_month: null, is_active: 1 });
  return { item, restarted: true };
}

module.exports = { change, stop, resume, touchesMoney, chargedBefore, MONEY_FIELDS };
