require('../config/env');

const { Client } = require('pg');
const db = require('./pool');

// Tries the connection once and prints everything the driver said, so a
// connection string can be checked in seconds instead of through a deploy.
//
//   npm run db:test                       uses DATABASE_URL from .env
//   npm run db:test -- "postgresql://..." tries the one you pass instead
//
// The password is never printed.

function sslFor(connectionString) {
  if (/@(localhost|127\.0\.0\.1|\[::1\])[:/]/.test(connectionString)) return false;
  const ca = process.env.DATABASE_CA_CERT;
  if (ca && ca.trim()) return { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  if (process.env.DATABASE_SSL_NO_VERIFY === 'true') return { rejectUnauthorized: false };
  return { rejectUnauthorized: true };
}

async function main() {
  const connectionString = process.argv[2] || process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('No connection string. Put DATABASE_URL in .env, or pass one as an argument.');
    process.exit(1);
  }

  process.env.DATABASE_URL = connectionString;
  const described = db.describeConnection();

  console.log('\nConnecting as (password omitted):');
  for (const [key, value] of Object.entries(described)) {
    console.log(`  ${key.padEnd(28)} ${value}`);
  }

  const client = new Client({
    connectionString,
    ssl: sslFor(connectionString),
    connectionTimeoutMillis: 10_000,
  });

  try {
    await client.connect();
    const { rows } = await client.query('SELECT current_user, version()');
    console.log(`\n  Connected as ${rows[0].current_user}`);
    console.log(`  ${rows[0].version.split(',')[0]}\n`);
    await client.end();
  } catch (err) {
    console.log(`\n  FAILED  ${err.code || '(no code)'}`);
    console.log(`  ${err.message}\n`);
    console.log(hint(err));
    process.exitCode = 1;
  }
}

function hint(err) {
  const message = String(err.message || '');

  if (/tenant or user not found/i.test(message)) {
    return [
      '  "Tenant or user not found" comes from the pooler, not from Postgres, and',
      '  is not about the password. It means the pooler could not match the project.',
      '  Usually one of:',
      '    - the region in the host is wrong. Copy the pooler string from Supabase',
      '      rather than adapting the direct one; the region there is not always the',
      '      one you picked for the project.',
      '    - the project reference after "postgres." belongs to a different project.',
      '    - the project is paused. Open it in the Supabase dashboard and resume it.',
    ].join('\n');
  }
  if (err.code === '28P01') {
    return '  The password was rejected. Reset it in Supabase and update DATABASE_URL.';
  }
  if (err.code === 'ENOTFOUND') {
    return '  That host does not resolve — check it for typos.';
  }
  if (/self.signed|unable to verify/i.test(message) || /CERT/.test(err.code || '')) {
    return '  Certificate could not be verified. See README, "TLS".';
  }
  return '';
}

main();
