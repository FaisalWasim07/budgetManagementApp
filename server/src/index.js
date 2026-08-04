const path = require('path');
const express = require('express');
const cors = require('cors');

const personsRouter = require('./routes/persons');
const accountsRouter = require('./routes/accounts');
const transactionsRouter = require('./routes/transactions');
const subscriptionsRouter = require('./routes/subscriptions');
const settingsRouter = require('./routes/settings');
const exchangeRatesRouter = require('./routes/exchangeRates');
const summaryRouter = require('./routes/summary');

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

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
