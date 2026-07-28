const db = require('../db/connection');

const FRANKFURTER_URL = 'https://api.frankfurter.dev/v1/latest';

function todayUTC() {
  return new Date().toISOString().slice(0, 10);
}

function getCachedRate(base, target) {
  return db
    .prepare(
      'SELECT base_currency, target_currency, rate, fetched_at FROM exchange_rates WHERE base_currency = ? AND target_currency = ?'
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

async function fetchLiveRate(base, target) {
  const url = `${FRANKFURTER_URL}?base=${encodeURIComponent(base)}&symbols=${encodeURIComponent(target)}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Exchange rate API responded with ${response.status}`);
  }
  const data = await response.json();
  const rate = data.rates && data.rates[target];
  if (typeof rate !== 'number') {
    throw new Error(`Exchange rate API did not return a rate for ${base}->${target}`);
  }
  return rate;
}

// Returns the cached rate, refreshing it first if it's missing or stale (not from today).
// Degrades to { rate: null, stale: true } on any failure instead of throwing, so a bad
// network call never takes down the whole summary/dashboard.
async function getRate(base, target) {
  if (base === target) {
    return { rate: 1, fetchedAt: todayUTC(), stale: false };
  }

  const cached = getCachedRate(base, target);
  const isFresh = cached && cached.fetched_at.slice(0, 10) === todayUTC();

  if (isFresh) {
    return { rate: cached.rate, fetchedAt: cached.fetched_at, stale: false };
  }

  try {
    const rate = await fetchLiveRate(base, target);
    const fetchedAt = new Date().toISOString();
    upsertRate(base, target, rate, fetchedAt);
    return { rate, fetchedAt, stale: false };
  } catch (err) {
    if (cached) {
      return { rate: cached.rate, fetchedAt: cached.fetched_at, stale: true };
    }
    return { rate: null, fetchedAt: null, stale: true };
  }
}

// Bypasses the "is it today" freshness check — used by the manual refresh button.
async function refreshRate(base, target) {
  if (base === target) {
    return { rate: 1, fetchedAt: todayUTC(), stale: false };
  }
  try {
    const rate = await fetchLiveRate(base, target);
    const fetchedAt = new Date().toISOString();
    upsertRate(base, target, rate, fetchedAt);
    return { rate, fetchedAt, stale: false };
  } catch (err) {
    const cached = getCachedRate(base, target);
    if (cached) {
      return { rate: cached.rate, fetchedAt: cached.fetched_at, stale: true };
    }
    return { rate: null, fetchedAt: null, stale: true };
  }
}

module.exports = { getRate, refreshRate };
