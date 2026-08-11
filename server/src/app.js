require('./config/env');

const path = require('path');
const express = require('express');
const cors = require('cors');

const db = require('./db/pool');
const ensureSchema = require('./db/ensureSchema');
const authRouter = require('./routes/auth');
const householdsRouter = require('./routes/households');
const personsRouter = require('./routes/persons');
const accountsRouter = require('./routes/accounts');
const transactionsRouter = require('./routes/transactions');
const subscriptionsRouter = require('./routes/subscriptions');
const settingsRouter = require('./routes/settings');
const exchangeRatesRouter = require('./routes/exchangeRates');
const summaryRouter = require('./routes/summary');
const { attachUser, requireAuth } = require('./middleware/auth');
const { resolveHousehold, blockViewerWrites } = require('./middleware/household');

const app = express();

// Session cookies only travel same-origin, so credentialed cross-origin
// requests are refused rather than allowed from anywhere.
app.use(cors({ origin: false }));
app.use(express.json());

// Behind a proxy (any real deployment) req.ip is the proxy's address unless
// Express is told to read X-Forwarded-For, which would make the login rate
// limit count every household as one client.
if (process.env.TRUST_PROXY === 'true' || process.env.VERCEL) app.set('trust proxy', 1);

// Answers before the schema check and before auth, so it can distinguish "the
// API isn't wired up at all" (nothing answers, or the host's own 404) from
// "the API is running but can't reach the database". Deliberately says nothing
// beyond that — the reason for a failure goes to the logs, not to the caller.
app.get('/api/health', async (req, res) => {
  try {
    await db.get('SELECT 1 AS ok');
    res.json({ api: true, database: true });
  } catch (err) {
    // Always logged; only returned when explicitly asked for, because the
    // username and host are infrastructure detail and this endpoint is public.
    const connection = db.describeConnection();
    console.error('Health check failed to reach the database:', err);
    console.error('Connection in use (password omitted):', connection);

    const debugging = process.env.DEBUG_CONNECTION === 'true';

    res.status(503).json({
      api: true,
      database: false,
      code: err.code ?? null,
      // The message is the part that separates causes sharing one code —
      // Supabase's pooler answers "Tenant or user not found" with the same
      // 28P01 it uses for a genuinely wrong password, and those need opposite
      // fixes. Included only when debugging is explicitly switched on.
      message: debugging ? err.message : undefined,
      connection: debugging ? connection : undefined,
    });
  }
});

// Serverless has no startup hook — the first request into a cold instance is
// the earliest point anything can run. ensureSchema caches its own promise, so
// this costs one extra await per instance and nothing after that.
app.use((req, res, next) => {
  ensureSchema().then(() => next(), next);
});

app.use(attachUser);
app.use('/api/auth', authRouter);

// Everything past this point requires a session. Declared once here rather
// than per route, so a new route can't be added and accidentally left public.
app.use('/api', requireAuth);

// Households come before the household-scoped middleware: you have to be able
// to list them before one can be selected, create your first, and accept an
// invite into one you are not a member of yet.
app.use('/api/households', householdsRouter);

// From here on every request is about exactly one household, which the user is
// confirmed to belong to, and req.household.id is the only thing routes may
// scope a query by. Both are declared once, for the same reason requireAuth is:
// a route added later cannot forget them.
app.use('/api', resolveHousehold);
app.use('/api', blockViewerWrites);

app.use('/api/persons', personsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/exchange-rates', exchangeRatesRouter);
app.use('/api/summary', summaryRouter);

// Only used when the app runs as a single process serving both halves. On
// Vercel the built client is served as static files and never reaches here.
const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

// An unmatched /api path answers in JSON and says which path it actually saw.
// A 404 is otherwise indistinguishable between "the host never routed this to
// the app" and "the app got it but under a different path than it expects",
// and those have completely different fixes.
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'No such API route',
    method: req.method,
    seenPath: req.originalUrl,
    hint: 'This came from the application, so routing to it is working.',
  });
});

// Last, so it also catches failures thrown by the middleware above it.
//
// The message stays out of the response — it can carry host names and query
// text — but the error *code* goes in. Codes are short and non-sensitive
// (ENOENT, ENOTFOUND, 28P01 for a bad password, 42P01 for a missing table) and
// turn "internal server error" into something you can act on without hunting
// through logs. The full error is logged either way.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error', code: err.code ?? null });
});

module.exports = app;
