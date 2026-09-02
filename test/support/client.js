// A minimal API client that keeps a session cookie and a current household, so
// each test reads like a person using the app rather than like plumbing.

const BASE = process.env.TEST_BASE_URL || 'http://localhost:5099';

function client() {
  let cookie = '';
  let household = null;

  // `extra` exists for the scheduled-job route, which authenticates with a
  // shared secret rather than a session.
  const call = async (method, path, body, extra) => {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(cookie ? { cookie } : {}),
        ...(household ? { 'X-Household-Id': String(household) } : {}),
        ...(extra ?? {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    let data = null;
    try {
      data = await res.json();
    } catch {
      // 204 and friends have no body.
    }
    return { status: res.status, data };
  };

  return {
    get: (p, h) => call('GET', p, undefined, h),
    post: (p, b, h) => call('POST', p, b, h),
    put: (p, b) => call('PUT', p, b),
    patch: (p, b) => call('PATCH', p, b),
    del: (p, b) => call('DELETE', p, b),
    use: (id) => {
      household = id;
    },
  };
}

// Results are collected rather than thrown, so one failure doesn't hide the
// twenty checks after it — which is exactly when you most want to see them.
function results() {
  const ok = [];
  const bad = [];
  return {
    check(name, condition, detail = '') {
      (condition ? ok : bad).push(
        `${condition ? 'PASS' : 'FAIL'} ${name}${detail ? ' :: ' + detail : ''}`
      );
    },
    report(title) {
      console.log(`\n${title}`);
      for (const line of [...ok, ...bad]) console.log('  ' + line);
      console.log(`  ${ok.length} passed, ${bad.length} failed`);
      return { passed: ok.length, failed: bad.length };
    },
  };
}

// Unique per run, so a suite can be run repeatedly against the same database
// without colliding on usernames.
const unique = () => `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;

// Months, for suites whose subject is *when* something happens rather than a
// particular date. Several rules in the app are relative to now — an item
// cannot be ended before last month, a start date cannot move once it has
// charged — so a suite that names fixed months is only testing them for as
// long as real time agrees, and then reports the app as broken instead of
// itself.
//
// Worked out here rather than imported from the server: a suite that borrowed
// the app's own month arithmetic could not notice it being wrong.
const monthName = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
const thisMonth = () => monthName(new Date());
const shiftMonth = (month, by) => {
  const [year, month1] = month.split('-').map(Number);
  return monthName(new Date(Date.UTC(year, month1 - 1 + by, 1)));
};

module.exports = { BASE, client, results, unique, thisMonth, shiftMonth };
