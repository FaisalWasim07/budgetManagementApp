const fs = require('fs');
const path = require('path');
const db = require('./connection');
const seed = require('./seed');

const dbPath = path.join(__dirname, '..', 'data', 'budget.sqlite3');

// The accounts table was reshaped when the app moved to a free-form ledger.
// CREATE TABLE IF NOT EXISTS cannot upgrade an existing table, so a database
// from before that change has to be replaced rather than added to. The old
// file is kept alongside instead of being thrown away.
function legacySchemaPresent() {
  const accounts = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'")
    .get();
  if (!accounts) return false;
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  return !columns.includes('opening_balance');
}

if (legacySchemaPresent()) {
  const backup = `${dbPath}.old-${Date.now()}`;
  db.close();
  fs.copyFileSync(dbPath, backup);
  fs.unlinkSync(dbPath);
  console.log(`Found a database from the previous version.`);
  console.log(`Saved a copy at ${path.basename(backup)} and started a fresh one.`);
  // connection.js cached the now-deleted handle, so re-run in a clean process.
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [__filename], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
console.log('Schema applied.');

seed();

console.log('Database ready.');
