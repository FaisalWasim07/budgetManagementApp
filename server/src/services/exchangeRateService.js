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

module.exports = { getRate, refreshRate, getRateMap, refreshAll, diagnose };
