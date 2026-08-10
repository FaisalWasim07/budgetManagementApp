const { Pool, types } = require('pg');

// COUNT() and SUM() over integers come back as PostgreSQL bigint, which the
// driver hands over as a *string* to avoid losing precision past 2^53. Nothing
// in a household budget goes near that, and a string silently breaks every
// `count === 0` and `count > 0` in the app, so bigint is parsed as a number.
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

// Supabase's poolers present a certificate from their own authority rather than
// a publicly trusted one, so verifying against the system roots fails with
// SELF_SIGNED_CERT_IN_CHAIN. There are two honest answers, in order of
// preference:
//
//   DATABASE_CA_CERT       the provider's CA certificate, downloadable from
//                          Supabase under Settings -> Database -> SSL. The
//                          connection is encrypted *and* the server is proven
//                          to be the one you meant.
//   DATABASE_SSL_NO_VERIFY encrypted, but the server is not verified. Simpler,
//                          and what most deployments settle for.
//
// Neither is the default: silently skipping verification is how an encrypted
// connection quietly becomes an interceptable one.
function sslOption(connectionString) {
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString)) return false;

  const ca = process.env.DATABASE_CA_CERT;
  if (ca && ca.trim()) {
    // Somewhere between a dashboard text box and here, real newlines often
    // arrive as the two characters \ and n.
    return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  }

  if (process.env.DATABASE_SSL_NO_VERIFY === 'true') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

let created = null;

// Built on first use rather than on import. A missing DATABASE_URL is a
// configuration mistake that should surface as a failed query the health check
// can report, not as a module that throws while loading and takes the whole
// function down before it can answer anything.
function getPool() {
  if (created) return created;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'DATABASE_URL is not set. Locally: copy .env.example to .env and put your ' +
        'Postgres connection string in it. On a host: set it as an environment ' +
        'variable and redeploy (see README, "Database").'
    );
  }

  created = new Pool({
    connectionString,
    ssl: sslOption(connectionString),
    // Each serverless invocation gets its own short-lived pool, so it wants a
    // small ceiling and a quick idle timeout: connections are a shared resource
    // across every concurrent invocation, not something this process owns.
    max: process.env.VERCEL ? 2 : 10,
    idleTimeoutMillis: process.env.VERCEL ? 5_000 : 30_000,
    connectionTimeoutMillis: 10_000,
  });

  created.on('error', (err) => {
    // An idle client dropped by the pooler must not take the process down.
    console.error('Idle Postgres client error:', err.message);
  });

  return created;
}

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
    // Several statements at once, for schema files. No parameters, so no
    // placeholder rewriting.
    exec: (sql) => runner.query(sql),
  };
}

// Resolves the pool at call time, so requiring this module never connects.
const base = api({ query: (text, values) => getPool().query(text, values) });

// Runs fn against a single connection wrapped in BEGIN/COMMIT. Anything thrown
// rolls the whole thing back — used where two rows have to appear together or
// not at all, like the two legs of a transfer.
async function tx(fn) {
  const client = await getPool().connect();
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

// `end` is a function rather than the pool itself so that scripts can close
// cleanly without a bare require ever opening a connection.
const end = () => (created ? created.end() : Promise.resolve());

module.exports = { ...base, tx, end, getPool, toPositional };
