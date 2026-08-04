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

// Returns the cached rate, refreshing when missing or not from today.
// Never throws: on failure it returns the stale cached rate if there is one,
// otherwise { rate: null }, so a network problem degrades the currency display
// instead of taking down the dashboard.
async function getRate(base, target) {
  if (base === target) {
    return { rate: 1, fetchedAt: null, stale: false };
  }

  const cached = getCachedRate(base, target);
  if (cached && cached.fetched_at.slice(0, 10) === todayUTC()) {
    return { rate: cached.rate, fetchedAt: cached.fetched_at, stale: false };
  }

  try {
    const rate = await fetchLiveRate(base, target);
    const fetchedAt = new Date().toISOString();
    upsertRate(base, target, rate, fetchedAt);
    return { rate, fetchedAt, stale: false };
  } catch (err) {
    if (cached) return { rate: cached.rate, fetchedAt: cached.fetched_at, stale: true };
    return { rate: null, fetchedAt: null, stale: true };
  }
}

async function refreshRate(base, target) {
  if (base === target) return { rate: 1, fetchedAt: null, stale: false };
  try {
    const rate = await fetchLiveRate(base, target);
    const fetchedAt = new Date().toISOString();
    upsertRate(base, target, rate, fetchedAt);
    return { rate, fetchedAt, stale: false };
  } catch (err) {
    const cached = getCachedRate(base, target);
    if (cached) return { rate: cached.rate, fetchedAt: cached.fetched_at, stale: true };
    return { rate: null, fetchedAt: null, stale: true };
  }
}

// Builds a { currency: rateInfo } map for every currency given, so a summary
// fetches each distinct pair once rather than per account.
async function getRateMap(currencies, target) {
  const unique = [...new Set(currencies)];
  const entries = await Promise.all(
    unique.map(async (c) => [c, await getRate(c, target)])
  );
  return Object.fromEntries(entries);
}

async function refreshAll(currencies, target) {
  const unique = [...new Set(currencies)].filter((c) => c !== target);
  await Promise.all(unique.map((c) => refreshRate(c, target)));
  return getRateMap(currencies, target);
}

module.exports = { getRate, refreshRate, getRateMap, refreshAll };
