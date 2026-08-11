const env = require('../config/env');

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

// Whether a .env was found, and what came out of it. Names only, never values.
function reportEnvFiles() {
  if (env.loaded.length === 0) {
    console.log('\n  No .env file found.');
    console.log('  Expected one at the repository root, next to package.json.');

    const candidates = env.nearMisses();
    if (candidates.length > 0) {
      console.log('\n  These look like they were meant to be it:');
      for (const file of candidates) console.log(`    ${file}`);
      console.log('\n  The name has to be exactly ".env" — no prefix, no extension.');
      console.log('  Windows Explorer will not create a name starting with a dot, so rename it');
      console.log('  from a terminal instead:');
      console.log(`    Rename-Item "${candidates[0]}" .env`);
    }
    return;
  }
  for (const entry of env.loaded) {
    if (entry.error) {
      console.log(`\n  ${entry.file} could not be read: ${entry.error}`);
    } else if (entry.keys.length === 0) {
      console.log(`\n  ${entry.file} was found but no settings could be read from it.`);
      console.log('  Usually the file is saved in an encoding other than UTF-8, or every');
      console.log('  line is commented out. Check it looks like KEY=value with no quotes.');
    } else {
      console.log(`\n  Read from ${entry.file}: ${entry.keys.join(', ')}`);
    }
  }
}

async function main() {
  const connectionString = process.argv[2] || process.env.DATABASE_URL;

  reportEnvFiles();

  if (!connectionString) {
    console.log('\n  No connection string. Put DATABASE_URL in .env, or pass one as an argument.\n');
    process.exit(1);
  }

  process.env.DATABASE_URL = connectionString;
  const described = db.describeConnection();

  console.log('\nConnecting as (password omitted):');
  for (const [key, value] of Object.entries(described)) {
    console.log(`  ${key.padEnd(28)} ${value}`);
  }

  const first = await attempt(connectionString, sslFor(connectionString));
  if (first.ok) return report(first, false);

  // A certificate this script can't verify would otherwise stop the diagnosis
  // before it reached the thing being diagnosed. It retries without
  // verification and says so — this is a throwaway connection that reads
  // nothing, not how the app connects.
  if (isCertificateProblem(first.err)) {
    console.log(`\n  Certificate could not be verified: ${first.err.message}`);
    console.log('  Retrying without verification, to get past it and test the credentials.\n');

    const second = await attempt(connectionString, { rejectUnauthorized: false });
    if (second.ok) {
      report(second, true);
      console.log('  The credentials are fine. What failed was the certificate check, so set');
      console.log('  DATABASE_CA_CERT or DATABASE_SSL_NO_VERIFY=true — see README, "TLS".\n');
      return;
    }
    return report(second, true);
  }

  return report(first, false);
}

async function attempt(connectionString, ssl) {
  const client = new Client({ connectionString, ssl, connectionTimeoutMillis: 10_000 });
  try {
    await client.connect();
    const { rows } = await client.query('SELECT current_user, version()');
    await client.end();
    return { ok: true, row: rows[0] };
  } catch (err) {
    await client.end().catch(() => {});
    return { ok: false, err };
  }
}

const isCertificateProblem = (err) =>
  /self.signed|unable to verify|CERT/i.test(`${err.code || ''} ${err.message || ''}`);

function report(result, unverified) {
  if (result.ok) {
    console.log(`\n  Connected as ${result.row.current_user}${unverified ? ' (certificate not verified)' : ''}`);
    console.log(`  ${result.row.version.split(',')[0]}\n`);
    return;
  }
  console.log(`\n  FAILED  ${result.err.code || '(no code)'}`);
  console.log(`  ${result.err.message}\n`);
  const text = hint(result.err);
  if (text) console.log(text + '\n');
  process.exitCode = 1;
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
