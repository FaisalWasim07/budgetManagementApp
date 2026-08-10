const fs = require('fs');
const path = require('path');
const db = require('./pool');

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
//   * an advisory lock, because concurrent CREATE TABLE IF NOT EXISTS can still
//     collide in the system catalogue and raise a duplicate-key error;
//   * the cached promise, so repeated calls in one process do no work.
async function ensureSchema() {
  if (!applied) {
    applied = (async () => {
      await db.exec(`SELECT pg_advisory_lock(${LOCK_KEY})`);
      try {
        await db.exec(schema());
      } finally {
        await db.exec(`SELECT pg_advisory_unlock(${LOCK_KEY})`);
      }
    })().catch((err) => {
      // Don't cache a failure: the next request should get to try again.
      applied = null;
      throw err;
    });
  }
  return applied;
}

module.exports = ensureSchema;
