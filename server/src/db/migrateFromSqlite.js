require('../config/env');

const fs = require('fs');
const path = require('path');
const db = require('./pool');
const ensureSchema = require('./ensureSchema');

// One-shot copy of the old local SQLite database into Postgres, for anyone
// carrying data over from the version that ran entirely on one laptop.
//
// Ids are preserved, so every account keeps its transactions and subscriptions.
// That is also why the identity sequences have to be reset afterwards: rows
// inserted with explicit ids don't advance them, and the next insert would
// otherwise collide with id 1.
//
//   node server/src/db/migrateFromSqlite.js [path-to-budget.sqlite3]
//
// Refuses to run against a database that already holds a budget, so it can't
// quietly duplicate everything when run twice.

const DEFAULT_SQLITE = path.join(__dirname, '..', 'data', 'budget.sqlite3');

// Copied in this order so a row never references one that doesn't exist yet.
const TABLES = [
  { name: 'settings', columns: ['key', 'value'] },
  { name: 'persons', columns: ['id', 'name'] },
  {
    name: 'accounts',
    columns: ['id', 'person_id', 'name', 'currency', 'type', 'opening_balance', 'is_active', 'sort_order'],
  },
  {
    name: 'transactions',
    columns: [
      'id', 'account_id', 'month', 'kind', 'amount',
      'category', 'description', 'transfer_id', 'entry_date',
    ],
  },
  {
    name: 'subscriptions',
    columns: [
      'id', 'account_id', 'name', 'amount', 'cycle', 'billing_month',
      'start_month', 'end_month', 'category', 'notes', 'is_active',
    ],
  },
  {
    name: 'exchange_rates',
    columns: ['base_currency', 'target_currency', 'rate', 'fetched_at'],
  },
];

// Tables whose ids were copied across and whose sequence must catch up.
const SEQUENCED = ['persons', 'accounts', 'transactions', 'subscriptions'];

function openSqlite(file) {
  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    throw new Error(
      `Reading the old database needs Node 22 or newer (you have ${process.version}). ` +
        'Install a current Node from https://nodejs.org and run this again.'
    );
  }
  return new DatabaseSync(file, { readOnly: true });
}

async function main() {
  const file = process.argv[2] || DEFAULT_SQLITE;
  if (!fs.existsSync(file)) {
    throw new Error(
      `No SQLite database at ${file}\n` +
        'Pass the path explicitly if it lives somewhere else:\n' +
        '  npm run migrate:sqlite -- "D:\\\\path\\\\to\\\\budget.sqlite3"'
    );
  }

  await ensureSchema();

  const existing = await db.get('SELECT COUNT(*) AS count FROM transactions');
  if (existing.count > 0) {
    throw new Error(
      `The Postgres database already has ${existing.count} transactions in it. ` +
        'Refusing to import on top of existing data — empty it first if that is really what you want.'
    );
  }

  const sqlite = openSqlite(file);
  const counts = {};

  await db.tx(async (t) => {
    for (const table of TABLES) {
      const rows = sqlite.prepare(`SELECT * FROM ${table.name}`).all();
      counts[table.name] = rows.length;

      for (const row of rows) {
        const placeholders = table.columns.map(() => '?').join(', ');
        await t.run(
          `INSERT INTO ${table.name} (${table.columns.join(', ')}) VALUES (${placeholders})`,
          table.columns.map((c) => row[c] ?? null)
        );
      }
    }

    for (const name of SEQUENCED) {
      await t.run(
        `SELECT setval(
           pg_get_serial_sequence('${name}', 'id'),
           GREATEST((SELECT COALESCE(MAX(id), 0) FROM ${name}), 1)
         )`
      );
    }
  });

  sqlite.close();

  console.log(`\nCopied from ${file}:\n`);
  for (const [name, n] of Object.entries(counts)) {
    console.log(`  ${String(n).padStart(6)}  ${name}`);
  }
  console.log(
    '\nLogins were not copied — password hashes stay with the machine that made them.\n' +
      'Open the app and it will ask you to create one.\n'
  );
}

main()
  .then(() => db.pool.end())
  .catch(async (err) => {
    console.error(`\n${err.message}\n`);
    await db.pool.end().catch(() => {});
    process.exit(1);
  });
