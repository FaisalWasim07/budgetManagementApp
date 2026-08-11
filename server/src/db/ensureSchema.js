const fs = require('fs');
const path = require('path');
const db = require('./pool');
const migrations = require('./migrations');

const schema = () => fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

// An arbitrary but fixed key, so every instance of the app contends for the
// same lock.
const LOCK_KEY = 826_411_907;

let applied = null;

// Applying the schema is a no-op once the tables exist, so it runs on boot and
// a release that adds a table needs no separate migrate step.
//
// Two things make that safe on a serverless host, where many instances can
// cold-start at the same moment:
//   * a lock, because concurrent CREATE TABLE IF NOT EXISTS can still collide
//     in the system catalogue and raise a duplicate-key error;
//   * the cached promise, so repeated calls in one process do no work.
//
// The lock is transaction-scoped and taken on the same connection as the DDL.
// A session-level pg_advisory_lock would be wrong here: through a transaction
// pooler each statement can be handed a different backend connection, so the
// lock would be taken on one, the schema applied on another, and the unlock
// aimed at a third. pg_advisory_xact_lock is released by COMMIT, so there is
// nothing to leak and nothing to unlock by hand.
async function ensureSchema() {
  if (!applied) {
    applied = db
      .tx(async (t) => {
        await t.run('SELECT pg_advisory_xact_lock(?)', [LOCK_KEY]);
        await t.exec(schema());
      })
      // Reshaping tables that already hold data can't be expressed as CREATE
      // IF NOT EXISTS, so it runs separately — after the tables it depends on
      // exist, and still behind the same lock, which is held until this
      // promise's transaction commits.
      .then(async () => {
        const notes = await migrations.run();
        for (const note of notes) console.log(`Migration: ${note}`);
      })
      .catch((err) => {
        // Don't cache a failure: the next request should get to try again.
        applied = null;
        throw err;
      });
  }
  return applied;
}

module.exports = ensureSchema;
