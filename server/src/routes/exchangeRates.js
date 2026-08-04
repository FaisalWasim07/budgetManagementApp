const express = require('express');
const db = require('../db/connection');
const exchangeRateService = require('../services/exchangeRateService');
const settingsService = require('../services/settingsService');

const router = express.Router();

const currenciesInUse = () =>
  db.prepare('SELECT DISTINCT currency FROM accounts WHERE is_active = 1').all().map((r) => r.currency);

// Every rate the app currently needs, keyed by currency.
router.get('/', async (req, res) => {
  const primary = settingsService.primaryCurrency();
  res.json({
    primaryCurrency: primary,
    rates: await exchangeRateService.getRateMap(currenciesInUse(), primary),
  });
});

router.get('/:base/:target', async (req, res) => {
  const { base, target } = req.params;
  res.json(await exchangeRateService.getRate(base.toUpperCase(), target.toUpperCase()));
});

// Forces a refetch of every in-use currency, ignoring the daily cache.
router.post('/refresh', async (req, res) => {
  const primary = settingsService.primaryCurrency();
  res.json({
    primaryCurrency: primary,
    rates: await exchangeRateService.refreshAll(currenciesInUse(), primary),
  });
});

module.exports = router;
