const fs = require('fs');
const path = require('path');
const db = require('./connection');
const seed = require('./seed');

const dbPath = path.join(__dirname, '..', 'data', 'budget.sqlite3');

const accountsTableSql = () =>
  db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'accounts'").get()?.sql;

// The accounts table was reshaped when the app moved to a free-form ledger.
// CREATE TABLE IF NOT EXISTS cannot upgrade an existing table, so a database
// from before that change has to be replaced. The old file is kept alongside.
function legacySchemaPresent() {
  if (!accountsTableSql()) return false;
  const columns = db.prepare('PRAGMA table_info(accounts)').all().map((c) => c.name);
  return !columns.includes('opening_balance');
}

// Later, 'credit' joined the allowed account types. That lives in a CHECK
// constraint, which SQLite can only change by rebuilding the table — so this
// one migrates in place and keeps every row.
function needsCreditTypeMigration() {
  const sql = accountsTableSql();
  return Boolean(sql) && !sql.includes("'credit'");
}

if (legacySchemaPresent()) {
  const backup = `${dbPath}.old-${Date.now()}`;
  db.close();
  fs.copyFileSync(dbPath, backup);
  fs.unlinkSync(dbPath);
  console.log('Found a database from the previous version.');
  console.log(`Saved a copy at ${path.basename(backup)} and started a fresh one.`);
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [__filename], { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}

if (needsCreditTypeMigration()) {
  // SQLite's documented table-rebuild order: build the replacement, copy, drop
  // the original, then rename. legacy_alter_table must be ON for that rename —
  // otherwise SQLite "helpfully" repoints the foreign keys in transactions and
  // subscriptions at the temporary name, which then stops existing.
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA legacy_alter_table = ON');
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE accounts_new (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        person_id       INTEGER NOT NULL REFERENCES persons(id),
        name            TEXT NOT NULL,
        currency        TEXT NOT NULL DEFAULT 'AED',
        type            TEXT NOT NULL DEFAULT 'current' CHECK (type IN ('current','savings','credit')),
        opening_balance REAL NOT NULL DEFAULT 0,
        is_active       INTEGER NOT NULL DEFAULT 1,
        sort_order      INTEGER NOT NULL DEFAULT 0,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    db.exec(`
      INSERT INTO accounts_new (id, person_id, name, currency, type, opening_balance, is_active, sort_order, created_at)
      SELECT id, person_id, name, currency, type, opening_balance, is_active, sort_order, created_at
      FROM accounts`);
    db.exec('DROP TABLE accounts');
    db.exec('ALTER TABLE accounts_new RENAME TO accounts');
    db.exec('COMMIT');
    console.log('Updated accounts so credit cards can be added. Existing accounts kept.');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  } finally {
    db.exec('PRAGMA legacy_alter_table = OFF');
    db.exec('PRAGMA foreign_keys = ON');
  }

  const broken = db.prepare('PRAGMA foreign_key_check').all();
  if (broken.length > 0) {
    throw new Error(`Account migration left ${broken.length} orphaned rows; database not changed.`);
  }
}

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);
console.log('Schema applied.');

seed();

console.log('Database ready.');
