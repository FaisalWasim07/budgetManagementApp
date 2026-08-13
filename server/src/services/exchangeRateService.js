const db = require('../db/pool');
const settingsService = require('./settingsService');
const rateProviders = require('./rateProviders');

// After a failure, stop hammering the providers on every single request.
const RETRY_AFTER_MS = 60_000;

const failedUntil = new Map();
const lastFailure = new Map();

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

const pairKey = (base, target) => `${base}->${target}`;

function getCachedRate(base, target) {
  return db.get(
    'SELECT rate, fetched_at FROM exchange_rates WHERE base_currency = ? AND target_currency = ?',
    [base, target]
  );
}

function upsertRate(base, target, rate, fetchedAt) {
  return db.run(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT (base_currency, target_currency)
     DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`,
    [base, target, rate, fetchedAt]
  );
}

const fetchLiveRate = (base, target) => rateProviders.fetchRate(base, target);

// A rate the user typed in Settings. Those are per household — one household's
// idea of the PKR rate is not another's — so the household has to be carried
// down here. The rate *cache* stays shared: a published exchange rate is a fact
// about the world, not about anyone's budget.
async function manualRate(householdId, base, target) {
  if (householdId == null) return null;
  const value = Number(await settingsService.get(householdId, `manual_rate_${base}_${target}`));
  return Number.isFinite(value) && value > 0 ? value : null;
}

async function fallback(householdId, base, target, cached) {
  const reason = lastFailure.get(pairKey(base, target)) || null;
  const manual = await manualRate(householdId, base, target);
  if (manual != null) {
    return { rate: manual, fetchedAt: null, source: 'manual', stale: false, reason };
  }
  if (cached) {
    return { rate: cached.rate, fetchedAt: cached.fetched_at, source: 'cache', stale: true, reason };
  }
  return { rate: null, fetchedAt: null, source: 'none', stale: true, reason };
}

// Resolution order: today's cached rate, then a live lookup, then whatever
// fallback exists. Never throws and never blocks for more than the timeout.
async function getRate(base, target, { force = false, householdId = null } = {}) {
  if (base === target) return { rate: 1, fetchedAt: null, source: 'same', stale: false };

  const cached = await getCachedRate(base, target);
  if (!force && cached && cached.fetched_at.slice(0, 10) === todayUTC()) {
    return { rate: cached.rate, fetchedAt: cached.fetched_at, source: 'live', stale: false };
  }

  const key = pairKey(base, target);
  if (!force && failedUntil.get(key) > Date.now()) {
    return fallback(householdId, base, target, cached);
  }

  try {
    const { rate, provider } = await fetchLiveRate(base, target);
    const fetchedAt = new Date().toISOString();
    await upsertRate(base, target, rate, fetchedAt);
    failedUntil.delete(key);
    lastFailure.delete(key);
    return { rate, fetchedAt, source: 'live', provider, stale: false };
  } catch (err) {
    failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
    lastFailure.set(key, err.message);
    return fallback(householdId, base, target, cached);
  }
}

const refreshRate = (base, target, householdId) =>
  getRate(base, target, { force: true, householdId });

async function getRateMap(currencies, target, options) {
  const unique = [...new Set(currencies)];
  const entries = await Promise.all(unique.map(async (c) => [c, await getRate(c, target, options)]));
  return Object.fromEntries(entries);
}

const refreshAll = (currencies, target, householdId) =>
  getRateMap(currencies, target, { force: true, householdId });

const diagnose = (base, target) => rateProviders.diagnose(base, target);

// --- what a month was worth ----------------------------------------------
//
// Every figure the app converts belongs to a month, and only the month you are
// living in should move. A past month is a record: it is what your money was
// worth then, and the rupee changing in November must not reach back and edit
// September. So the current month reads live and writes down what it read, and
// every earlier month reads what was written.

// Kept here rather than imported: summaryService already requires this module,
// and one small duplicated function is cheaper than a circular import.
function currentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const SAME = { rate: 1, fetchedAt: null, source: 'same', stale: false };

function snapshot(householdId, month, target, map) {
  const writes = Object.entries(map)
    .filter(([base, info]) => base !== target && info?.rate != null)
    .map(([base, info]) =>
      db.run(
        `INSERT INTO exchange_rate_history (household_id, month, base_currency, target_currency, rate)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (household_id, month, base_currency, target_currency)
         DO UPDATE SET rate = excluded.rate, captured_at = now()`,
        [householdId, month, base, target, info.rate]
      )
    );
  return Promise.all(writes);
}

// The whole history for one household, which is currencies × months — tens of
// rows, not thousands — so it is read once and searched in memory rather than
// queried per month per currency.
const historyRows = (householdId, target) =>
  householdId == null
    ? Promise.resolve([])
    : db.all(
        `SELECT month, base_currency, rate FROM exchange_rate_history
         WHERE household_id = ? AND target_currency = ?`,
        [householdId, target]
      );

// The rate recorded for that month, or the most recent one before it. A month
// you never opened the app in borrows the last rate the app actually saw,
// which is a better answer than today's and an honest one: it is the last
// thing that was true.
function recordedAt(rows, base, month) {
  let best = null;
  for (const row of rows) {
    if (row.base_currency !== base || row.month > month) continue;
    if (!best || row.month > best.month) best = row;
  }
  return best;
}

// A rate map per month. The current month (and anything later) uses live rates
// and refreshes its snapshot; earlier months use what was recorded.
async function getRateMaps(currencies, target, months, { householdId = null } = {}) {
  const list = [...new Set(currencies)];
  const now = currentMonth();
  const rows = await historyRows(householdId, target);

  const foreign = list.filter((c) => c !== target);
  const needsLive =
    months.some((month) => month >= now) ||
    foreign.some((c) => months.some((month) => month < now && !recordedAt(rows, c, month)));

  const live = needsLive ? await getRateMap(list, target, { householdId }) : {};

  const maps = {};
  for (const month of months) {
    const map = {};
    for (const base of list) {
      if (base === target) {
        map[base] = SAME;
      } else if (month >= now) {
        map[base] = live[base];
      } else {
        const row = recordedAt(rows, base, month);
        if (row) {
          map[base] = {
            rate: row.rate,
            fetchedAt: null,
            source: 'historical',
            rateMonth: row.month,
            stale: false,
          };
        } else {
          // Nothing was ever recorded this far back. Today's rate is the only
          // answer available, and it says so rather than passing itself off as
          // what that month was worth.
          const fallbackRate = live[base];
          map[base] =
            fallbackRate?.rate == null
              ? fallbackRate
              : { ...fallbackRate, source: 'estimated' };
        }
      }
    }
    maps[month] = map;
  }

  if (householdId != null && months.some((month) => month >= now)) {
    await snapshot(householdId, now, target, live);
  }

  return maps;
}

// One month's worth, for the callers that only ever want one.
const getRateMapFor = async (currencies, target, month, options) =>
  (await getRateMaps(currencies, target, [month], options))[month];

module.exports = {
  getRate,
  refreshRate,
  getRateMap,
  getRateMaps,
  getRateMapFor,
  refreshAll,
  diagnose,
  currentMonth,
};
