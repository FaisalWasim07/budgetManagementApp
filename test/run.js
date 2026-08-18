// Runs the API suites against a server this script starts and stops itself, so
// a test run needs nothing set up beforehand except a database to point at.
//
//   TEST_DATABASE_URL=postgresql://... npm test
//
// TEST_DATABASE_URL is deliberately a separate variable from DATABASE_URL. These
// suites create accounts, households and money; pointing them at the database
// the real app uses would be a bad afternoon. Requiring a different name means
// it cannot happen by having the wrong shell open.

const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.TEST_PORT || 5099;
const BASE = `http://localhost:${PORT}`;

const SUITES = [
  'api/money.test.js',
  'api/split.test.js',
  'api/editing.test.js',
  'api/recurring.test.js',
  'api/rates.test.js',
  'api/passkeys.test.js',
  'api/verify.test.js',
  'api/push.test.js',
  'api/whois.test.js',
  'api/households.test.js',
  'api/reset.test.js',
];

if (!process.env.TEST_DATABASE_URL) {
  console.error(
    '\nTEST_DATABASE_URL is not set.\n\n' +
      'These tests create and delete data, so they will not run against whatever\n' +
      'DATABASE_URL happens to point at. Give them their own database:\n\n' +
      '  TEST_DATABASE_URL=postgresql://user:pass@host:5432/budget_test npm test\n'
  );
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  PORT: String(PORT),
  // The suites create many accounts in a row from one address, which is
  // exactly what the signup limit exists to stop.
  SIGNUP_MAX: '10000',
  // Passkeys are bound to an origin, and the suite signs for the one the test
  // server is actually listening on.
  RP_ID: 'localhost',
  RP_ORIGIN: BASE,
  // A fresh pair per run, so the push routes exercise their configured path
  // without a key ever being written down anywhere.
  ...(() => {
    const { publicKey, privateKey } = require('web-push').generateVAPIDKeys();
    return {
      VAPID_PUBLIC_KEY: publicKey,
      VAPID_PRIVATE_KEY: privateKey,
      VAPID_SUBJECT: 'mailto:test@example.com',
    };
  })(),
};

async function waitForServer(timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      const body = await res.json();
      if (body.database) return true;
      // Reachable but no database: report that rather than timing out silently.
      throw new Error(`the server is up but cannot reach the database (${body.code || 'no code'})`);
    } catch (err) {
      if (err.message.includes('cannot reach the database')) throw err;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
  throw new Error('the test server did not start in time');
}

function run(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, file)], {
      env: { ...env, TEST_BASE_URL: BASE },
      stdio: 'inherit',
    });
    child.on('exit', (code) => resolve(code === 0));
  });
}

(async () => {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'src', 'index.js')], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });

  const stop = () => {
    if (!server.killed) server.kill();
  };
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  try {
    await waitForServer();
  } catch (err) {
    console.error(`\n${err.message}\n`);
    stop();
    process.exit(1);
  }

  const failures = [];
  for (const suite of SUITES) {
    if (!(await run(suite))) failures.push(suite);
  }

  stop();

  console.log('');
  if (failures.length) {
    console.log(`FAILED: ${failures.join(', ')}\n`);
    process.exit(1);
  }
  console.log('All suites passed.\n');
})();
