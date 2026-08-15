// Browser suites. Separate from `npm test` because they need Playwright and a
// Chromium, which is a lot to install for someone who only wants to check the
// money maths.
//
//   npm install --no-save playwright
//   TEST_DATABASE_URL=postgresql://... npm run test:browser

const { spawn } = require('child_process');
const path = require('path');

const PORT = process.env.TEST_PORT || 5098;
const VITE_PORT = process.env.TEST_VITE_PORT || 5198;
const SUITES = [
  'auth.test.js',
  'passkeys.test.js',
  'households.test.js',
  'dashboard.test.js',
  'phone.test.js',
];

if (!process.env.TEST_DATABASE_URL) {
  console.error('\nTEST_DATABASE_URL is not set — see test/run.js for why.\n');
  process.exit(1);
}

try {
  require.resolve('playwright');
} catch {
  console.error(
    '\nPlaywright is not installed. These suites drive a real browser:\n\n' +
      '  npm install --no-save playwright\n\n' +
      'The API suites (npm test) need nothing extra.\n'
  );
  process.exit(1);
}

const env = {
  ...process.env,
  DATABASE_URL: process.env.TEST_DATABASE_URL,
  PORT: String(PORT),
  SIGNUP_MAX: '10000',
  // The browser drives the app through Vite, so that is the origin a passkey
  // gets bound to.
  RP_ID: 'localhost',
  RP_ORIGIN: `http://localhost:${VITE_PORT}`,
};

const wait = async (url, timeoutMs = 40000) => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${url} did not come up`);
};

(async () => {
  const root = path.join(__dirname, '..', '..');
  const server = spawn(process.execPath, [path.join(root, 'server', 'src', 'index.js')], {
    env,
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  // The client is served by Vite so the suites exercise the real app, proxying
  // /api to the server started above.
  const vite = spawn(
    process.execPath,
    [
      path.join(root, 'client', 'node_modules', 'vite', 'bin', 'vite.js'),
      '--port', String(VITE_PORT), '--strictPort',
    ],
    {
      cwd: path.join(root, 'client'),
      env: { ...env, VITE_API_PORT: String(PORT) },
      stdio: ['ignore', 'ignore', 'inherit'],
    }
  );

  const stop = () => {
    if (!server.killed) server.kill();
    if (!vite.killed) vite.kill();
  };
  process.on('exit', stop);
  process.on('SIGINT', () => {
    stop();
    process.exit(130);
  });

  try {
    await wait(`http://localhost:${PORT}/api/health`);
    await wait(`http://localhost:${VITE_PORT}/`);
  } catch (err) {
    console.error(`\n${err.message}\n`);
    stop();
    process.exit(1);
  }

  const failures = [];
  for (const suite of SUITES) {
    const passed = await new Promise((resolve) => {
      const child = spawn(process.execPath, [path.join(__dirname, suite)], {
        env: { ...env, TEST_APP_URL: `http://localhost:${VITE_PORT}` },
        stdio: 'inherit',
      });
      child.on('exit', (code) => resolve(code === 0));
    });
    if (!passed) failures.push(suite);
  }

  stop();
  console.log('');
  if (failures.length) {
    console.log(`FAILED: ${failures.join(', ')}\n`);
    process.exit(1);
  }
  console.log('All browser suites passed.\n');
})();
