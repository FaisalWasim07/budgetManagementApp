require('./config/env');

const path = require('path');
const express = require('express');
const cors = require('cors');

const ensureSchema = require('./db/ensureSchema');
const authRouter = require('./routes/auth');
const personsRouter = require('./routes/persons');
const accountsRouter = require('./routes/accounts');
const transactionsRouter = require('./routes/transactions');
const subscriptionsRouter = require('./routes/subscriptions');
const settingsRouter = require('./routes/settings');
const exchangeRatesRouter = require('./routes/exchangeRates');
const summaryRouter = require('./routes/summary');
const { attachUser, requireAuth } = require('./middleware/auth');

const app = express();

// Session cookies only travel same-origin, so credentialed cross-origin
// requests are refused rather than allowed from anywhere.
app.use(cors({ origin: false }));
app.use(express.json());

// Behind a proxy (any real deployment) req.ip is the proxy's address unless
// Express is told to read X-Forwarded-For, which would make the login rate
// limit count every household as one client.
if (process.env.TRUST_PROXY === 'true' || process.env.VERCEL) app.set('trust proxy', 1);

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

app.use('/api/persons', personsRouter);
app.use('/api/accounts', accountsRouter);
app.use('/api/transactions', transactionsRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/exchange-rates', exchangeRatesRouter);
app.use('/api/summary', summaryRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'internal server error' });
});

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

module.exports = app;
