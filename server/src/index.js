const path = require('path');
const express = require('express');
const cors = require('cors');

// Before any router touches the database, so pulling an update that adds a
// table doesn't need a separate migrate step.
require('./db/ensureSchema')();

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
const PORT = process.env.PORT || 5000;

// Session cookies only travel same-origin, so credentialed cross-origin
// requests are refused rather than allowed from anywhere.
app.use(cors({ origin: false }));
app.use(express.json());

// Behind a proxy (any real deployment) req.ip is the proxy's address unless
// Express is told to read X-Forwarded-For, which would make the login rate
// limit count every household as one client.
if (process.env.TRUST_PROXY === 'true') app.set('trust proxy', 1);

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

const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(clientDist, 'index.html'), (err) => {
    if (err) next();
  });
});

app.listen(PORT, () => {
  console.log(`Budget server listening on http://localhost:${PORT}`);
});
