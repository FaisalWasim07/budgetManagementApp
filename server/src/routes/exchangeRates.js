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

// Asks every provider directly and reports what each one did, so a failing
// rate can be traced to the provider rather than guessed at.
router.get('/diagnose', async (req, res) => {
  const primary = settingsService.primaryCurrency();
  const bases = currenciesInUse().filter((c) => c !== primary);
  const results = await Promise.all(
    bases.map(async (base) => ({
      base,
      target: primary,
      providers: await exchangeRateService.diagnose(base, primary),
    }))
  );
  res.json({ primaryCurrency: primary, results });
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
