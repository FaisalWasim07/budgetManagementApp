const db = require('../db/pool');

const DEFAULTS = { primary_currency: 'AED' };

// Every function takes the household explicitly. There is no ambient "current
// household" to forget to pass, which is what stops one household reading
// another's settings.

async function get(householdId, key) {
  const row = await db.get('SELECT value FROM settings WHERE household_id = ? AND key = ?', [
    householdId,
    key,
  ]);
  return row ? row.value : DEFAULTS[key];
}

async function set(householdId, key, value) {
  await db.run(
    `INSERT INTO settings (household_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT (household_id, key) DO UPDATE SET value = excluded.value`,
    [householdId, key, String(value)]
  );
  return get(householdId, key);
}

async function remove(householdId, key) {
  await db.run('DELETE FROM settings WHERE household_id = ? AND key = ?', [householdId, key]);
}

async function getAll(householdId) {
  const rows = await db.all('SELECT key, value FROM settings WHERE household_id = ?', [householdId]);
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

const primaryCurrency = (householdId) => get(householdId, 'primary_currency');

const manualRateKey = (base, target) => `manual_rate_${base}_${target}`;

// Manual rates keyed by source currency, for the currently selected primary.
async function manualRates(householdId, target) {
  const prefix = 'manual_rate_';
  const suffix = `_${target}`;
  const out = {};
  const rows = await db.all('SELECT key, value FROM settings WHERE household_id = ?', [householdId]);
  for (const row of rows) {
    if (row.key.startsWith(prefix) && row.key.endsWith(suffix)) {
      const base = row.key.slice(prefix.length, row.key.length - suffix.length);
      out[base] = Number(row.value);
    }
  }
  return out;
}

module.exports = { get, set, remove, getAll, primaryCurrency, manualRateKey, manualRates };
