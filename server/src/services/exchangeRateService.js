const db = require('../db/connection');
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
  return db
    .prepare(
      'SELECT rate, fetched_at FROM exchange_rates WHERE base_currency = ? AND target_currency = ?'
    )
    .get(base, target);
}

function upsertRate(base, target, rate, fetchedAt) {
  db.prepare(
    `INSERT INTO exchange_rates (base_currency, target_currency, rate, fetched_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(base_currency, target_currency)
     DO UPDATE SET rate = excluded.rate, fetched_at = excluded.fetched_at`
  ).run(base, target, rate, fetchedAt);
}

const fetchLiveRate = (base, target) => rateProviders.fetchRate(base, target);

// A rate the user typed in Settings, used when the live lookup can't be had.
function manualRate(base, target) {
  const value = Number(settingsService.get(`manual_rate_${base}_${target}`));
  return Number.isFinite(value) && value > 0 ? value : null;
}

function fallback(base, target, cached) {
  const reason = lastFailure.get(pairKey(base, target)) || null;
  const manual = manualRate(base, target);
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
async function getRate(base, target, { force = false } = {}) {
  if (base === target) return { rate: 1, fetchedAt: null, source: 'same', stale: false };

  const cached = getCachedRate(base, target);
  if (!force && cached && cached.fetched_at.slice(0, 10) === todayUTC()) {
    return { rate: cached.rate, fetchedAt: cached.fetched_at, source: 'live', stale: false };
  }

  const key = pairKey(base, target);
  if (!force && failedUntil.get(key) > Date.now()) {
    return fallback(base, target, cached);
  }

  try {
    const { rate, provider } = await fetchLiveRate(base, target);
    const fetchedAt = new Date().toISOString();
    upsertRate(base, target, rate, fetchedAt);
    failedUntil.delete(key);
    lastFailure.delete(key);
    return { rate, fetchedAt, source: 'live', provider, stale: false };
  } catch (err) {
    failedUntil.set(key, Date.now() + RETRY_AFTER_MS);
    lastFailure.set(key, err.message);
    return fallback(base, target, cached);
  }
}

const refreshRate = (base, target) => getRate(base, target, { force: true });

async function getRateMap(currencies, target, options) {
  const unique = [...new Set(currencies)];
  const entries = await Promise.all(unique.map(async (c) => [c, await getRate(c, target, options)]));
  return Object.fromEntries(entries);
}

const refreshAll = (currencies, target) => getRateMap(currencies, target, { force: true });

const diagnose = (base, target) => rateProviders.diagnose(base, target);

module.exports = { getRate, refreshRate, getRateMap, refreshAll, diagnose };
