const db = require('../db/pool');
const pushService = require('./pushService');
const exchangeRateService = require('./exchangeRateService');
const { currentMonth, shiftMonth, subscriptionDueIn } = require('./summaryService');

// What Bayt says when nobody is looking at it.
//
// Two rules shape every message here.
//
// No money. Not one figure, not a total, not a balance. A notification lands on
// a lock screen where anyone glancing at the phone reads it, and the whole
// point of putting amounts behind a passkey was that they should not be
// readable by whoever is holding the device. A notification says something
// happened and is worth opening; the numbers are on the other side of the lock.
//
// Rare. Two or three a month. An app that notifies often gets muted, and a
// muted app has lost the channel for the message that actually mattered.
//
// Counts of things are not money and do appear — how many items charge is not a
// fact about anyone's wealth, and it is the part that makes the message worth
// opening rather than a bare nudge.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const monthName = (month) => MONTHS[Number(String(month).split('-')[1]) - 1];

// Reads as a list rather than as data: "Netflix, DEWA and du", or with more
// than three, "Netflix, DEWA and 4 more".
function nameList(names) {
  if (names.length === 0) return '';
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  if (names.length === 3) return `${names[0]}, ${names[1]} and ${names[2]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

const householdsWithNotifications = () =>
  db.all(
    `SELECT DISTINCT m.household_id, m.user_id
     FROM household_members m
     JOIN push_subscriptions p ON p.user_id = m.user_id
     ORDER BY m.household_id, m.user_id`
  );

const recurringFor = (householdId) =>
  db.all(
    `SELECT s.name, s.cycle, s.direction, s.start_month, s.end_month, s.billing_month
     FROM subscriptions s
     JOIN accounts a ON a.id = s.account_id
     WHERE a.household_id = ? AND s.is_active = 1`,
    [householdId]
  );

// When something was last written down — or, for a household that has never
// written anything down, when it was created.
//
// The fallback is the interesting half. Without it a household that was set up
// and then abandoned is the one household that never gets a nudge, which is
// exactly backwards: it is the one that most needs one. Measuring from creation
// also means a household made this morning is not nagged this afternoon.
const lastRecorded = (householdId) =>
  db.get(
    `SELECT COALESCE(
              (SELECT MAX(t.created_at)
               FROM transactions t
               JOIN accounts a ON a.id = t.account_id
               WHERE a.household_id = h.id),
              h.created_at
            ) AS at
     FROM households h WHERE h.id = ?`,
    [householdId]
  );

// The month has turned over. Worth one message, because it is the only moment
// the previous month is final and the new one is empty.
//
// Note what this cannot say: which day something charges. Recurring items are
// held to the month, not the date — there is no day-of-month anywhere in the
// schema — so "three things charge on Thursday" would be invented. What is
// true is how many land in this month at all.
async function monthOpener(householdId, month) {
  const items = await recurringFor(householdId);
  const due = items.filter((item) => item.direction !== 'income' && subscriptionDueIn(item, month));
  const yearly = due.filter((item) => item.cycle === 'yearly');
  const last = monthName(shiftMonth(month, -1));

  const parts = [`${last} is closed.`];
  if (due.length > 0) {
    parts.push(
      `${due.length} recurring ${due.length === 1 ? 'item charges' : 'items charge'} this month — ${nameList(due.map((i) => i.name))}.`
    );
  }
  // A yearly bill landing is the one people forget, so it is called out rather
  // than folded into the count.
  if (yearly.length > 0) {
    parts.push(`${yearly.length === 1 ? 'One of them is' : 'Some are'} yearly.`);
  }

  return {
    title: `📅 ${monthName(month)} is open`,
    body: parts.join(' '),
    tag: `month-${month}`,
    url: '/',
  };
}

// Nothing has been written down in a while. The way a hand-kept ledger dies is
// quietly, so this is the one message that exists to prevent that — and it is
// skipped entirely whenever it would be untrue.
const QUIET_DAYS = 7;

async function quietNudge(householdId, now) {
  const last = await lastRecorded(householdId);
  if (!last?.at) return null;
  const days = Math.floor((now - new Date(last.at)) / 86400000);
  if (days < QUIET_DAYS) return null;
  return {
    title: '✍️ Anything to add?',
    body: `Nothing has been recorded for ${days} days. A minute now beats guessing at the end of the month.`,
    tag: 'quiet',
    url: '/',
  };
}

// Money landed in somebody else's account.
//
// The only message here that is not on a schedule, and the only one that
// answers to something a person just did rather than to the calendar. Somebody
// moving money into your account is worth knowing about at the time — it is the
// one event in this app that happens *to* you rather than being something you
// did yourself.
//
// Sent to the person who owns the destination account, and never to the person
// who made the transfer. Moving money between two of your own accounts is not
// news to you, and an app that tells you what you just did is an app that gets
// muted.
//
// No amount, like everything else. "Money arrived, open to see."
async function transferArrivals({ legs, byUserId, senderName }) {
  // Grouped by recipient: four destinations that all belong to one person are
  // one notification, not four.
  const byRecipient = new Map();
  for (const leg of legs) {
    if (!leg.userId || leg.userId === byUserId) continue;
    const held = byRecipient.get(leg.userId) ?? [];
    held.push(leg.accountName);
    byRecipient.set(leg.userId, held);
  }

  const messages = [];
  for (const [userId, accounts] of byRecipient) {
    const one = accounts.length === 1;
    messages.push({
      userId,
      message: {
        title: `💸 ${senderName} sent you money`,
        body: one
          ? `It has landed in ${accounts[0]}. Open Bayt to see how much.`
          : `It has landed in ${nameList(accounts)}. Open Bayt to see how much.`,
        // Distinct per send rather than shared, so two transfers on the same
        // day are two notifications instead of the second replacing the first
        // silently.
        tag: `arrival-${Date.now()}`,
        renotify: true,
        url: '/',
        // Money arriving is worth waking a radio for, unlike a monthly summary.
        urgency: 'high',
      },
    });
  }
  return messages;
}

// Tells whoever the money went to. Never throws: a notification that cannot be
// sent must not turn a transfer that already happened into an error.
async function announceTransfer(details) {
  try {
    const messages = await transferArrivals(details);
    const results = [];
    for (const { userId, message } of messages) {
      results.push(await pushService.sendTo(userId, message));
    }
    return results;
  } catch {
    return [];
  }
}

// What today deserves for one household — the whole decision, in one place.
//
// Extracted so the preview in Settings runs exactly this and not a second
// implementation that agrees with it today and drifts by March. A preview of
// something other than what will really be sent is worse than no preview.
async function messagesFor(householdId, now = new Date()) {
  const month = currentMonth();
  if (now.getUTCDate() === 1) return [await monthOpener(householdId, month)];
  // Sunday, and only when it is true. Deliberately not on the 1st as well —
  // two notifications in one morning is how an app gets muted.
  if (now.getUTCDay() === 0) {
    const nudge = await quietNudge(householdId, now);
    return nudge ? [nudge] : [];
  }
  return [];
}

// One job, run once a day, that works out what — if anything — today deserves.
//
// One rather than several because a cron on Vercel's free plan fires daily, and
// because "what should today say" is a single question. Most days the answer is
// nothing, and sending nothing is the correct outcome rather than a failure.
async function runDaily({ now = new Date() } = {}) {
  const month = currentMonth();

  const sent = [];

  // Rates first, and silently. It is the one automation that needs no message:
  // nobody wants to be told an exchange rate was checked.
  let rates = 'skipped';
  try {
    await exchangeRateService.refreshAll();
    rates = 'refreshed';
  } catch (err) {
    rates = `failed: ${err.message}`;
  }

  const pairs = await householdsWithNotifications();

  for (const { household_id: householdId, user_id: userId } of pairs) {
    const messages = await messagesFor(householdId, now);

    for (const message of messages) {
      const result = await pushService.sendTo(userId, message);
      sent.push({ userId, householdId, tag: message.tag, ...result });
    }
  }

  return { month, rates, considered: pairs.length, sent };
}

module.exports = {
  runDaily,
  messagesFor,
  monthOpener,
  quietNudge,
  transferArrivals,
  announceTransfer,
  nameList,
  currentMonth,
};
