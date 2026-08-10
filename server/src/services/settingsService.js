const db = require('../db/pool');

const DEFAULTS = { primary_currency: 'AED' };

async function get(key) {
  const row = await db.get('SELECT value FROM settings WHERE key = ?', [key]);
  return row ? row.value : DEFAULTS[key];
}

async function set(key, value) {
  await db.run(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
  return get(key);
}

async function remove(key) {
  await db.run('DELETE FROM settings WHERE key = ?', [key]);
}

async function getAll() {
  const rows = await db.all('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

const primaryCurrency = () => get('primary_currency');

const manualRateKey = (base, target) => `manual_rate_${base}_${target}`;

// Manual rates keyed by source currency, for the currently selected primary.
async function manualRates(target) {
  const prefix = 'manual_rate_';
  const suffix = `_${target}`;
  const out = {};
  for (const row of await db.all('SELECT key, value FROM settings')) {
    if (row.key.startsWith(prefix) && row.key.endsWith(suffix)) {
      const base = row.key.slice(prefix.length, row.key.length - suffix.length);
      out[base] = Number(row.value);
    }
  }
  return out;
}

module.exports = { get, set, remove, getAll, primaryCurrency, manualRateKey, manualRates };
