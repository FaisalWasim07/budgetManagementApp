const { Pool, types } = require('pg');

// COUNT() and SUM() over integers come back as PostgreSQL bigint, which the
// driver hands over as a *string* to avoid losing precision past 2^53. Nothing
// in a household budget goes near that, and a string silently breaks every
// `count === 0` and `count > 0` in the app, so bigint is parsed as a number.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env and put your Postgres ' +
      'connection string in it (see README, "Database").'
  );
}

const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString);

// Certificates are verified by default. Supabase's pooler presents a publicly
// trusted certificate, so this should just work; the escape hatch exists
// because a corporate network doing TLS interception would otherwise be an
// unexplained connection failure.
function sslOption() {
  if (isLocal) return false;
  if (process.env.DATABASE_SSL_NO_VERIFY === 'true') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

const pool = new Pool({
  connectionString,
  ssl: sslOption(),
  // Each serverless invocation gets its own short-lived pool, so it wants a
  // small ceiling and a quick idle timeout: connections are a shared resource
  // across every concurrent invocation, not something this process owns.
  max: process.env.VERCEL ? 2 : 10,
  idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on('error', (err) => {
  // An idle client dropped by the pooler must not take the process down.
  console.error('Idle Postgres client error:', err.message);
});

// The app's SQL was written against SQLite's `?` placeholders. Rewriting all of
// it to $1/$2 by hand would be a large diff of pure noise, so the numbering is
// applied here instead. Quoted literals are skipped so a `?` inside a string
// is left alone.
function toPositional(sql) {
  let out = '';
  let index = 0;
  let inSingle = false;
  let inDouble = false;

  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;

    if (ch === '?' && !inSingle && !inDouble) {
      index += 1;
      out += `$${index}`;
    } else {
      out += ch;
    }
  }
  return out;
}

// Errors from the driver name the failing column but not the statement, which
// makes a typo in one of sixty queries hard to place.
async function query(runner, sql, params) {
  try {
    return await runner.query(toPositional(sql), params);
  } catch (err) {
    err.message = `${err.message}\n  in query: ${sql.trim().split('\n')[0]}`;
    throw err;
  }
}

function api(runner) {
  return {
    all: async (sql, params = []) => (await query(runner, sql, params)).rows,
    get: async (sql, params = []) => (await query(runner, sql, params)).rows[0],
    run: async (sql, params = []) => {
      const result = await query(runner, sql, params);
      return { rowCount: result.rowCount, rows: result.rows };
    },
  };
}

const base = api(pool);

// Multiple statements in one go, for schema files. No parameters, so no
// placeholder rewriting.
const exec = (sql) => pool.query(sql);

// Runs fn against a single connection wrapped in BEGIN/COMMIT. Anything thrown
// rolls the whole thing back — used where two rows have to appear together or
// not at all, like the two legs of a transfer.
async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(api(client));
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { ...base, exec, tx, pool, toPositional };
