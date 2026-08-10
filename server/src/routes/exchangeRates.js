const express = require('express');
const db = require('../db/pool');
const exchangeRateService = require('../services/exchangeRateService');
const settingsService = require('../services/settingsService');
const { h } = require('../util/route');

const router = express.Router();

const currenciesInUse = async () =>
  (await db.all('SELECT DISTINCT currency FROM accounts WHERE is_active = 1')).map(
    (r) => r.currency
  );

// Every rate the app currently needs, keyed by currency.
router.get(
  '/',
  h(async (req, res) => {
    const primary = await settingsService.primaryCurrency();
    res.json({
      primaryCurrency: primary,
      rates: await exchangeRateService.getRateMap(await currenciesInUse(), primary),
    });
  })
);

// Asks every provider directly and reports what each one did, so a failing
// rate can be traced to the provider rather than guessed at.
router.get(
  '/diagnose',
  h(async (req, res) => {
    const primary = await settingsService.primaryCurrency();
    const bases = (await currenciesInUse()).filter((c) => c !== primary);
    const results = await Promise.all(
      bases.map(async (base) => ({
        base,
        target: primary,
        providers: await exchangeRateService.diagnose(base, primary),
      }))
    );
    res.json({ primaryCurrency: primary, results });
  })
);

router.get(
  '/:base/:target',
  h(async (req, res) => {
    const { base, target } = req.params;
    res.json(await exchangeRateService.getRate(base.toUpperCase(), target.toUpperCase()));
  })
);

// Forces a refetch of every in-use currency, ignoring the daily cache.
router.post(
  '/refresh',
  h(async (req, res) => {
    const primary = await settingsService.primaryCurrency();
    res.json({
      primaryCurrency: primary,
      rates: await exchangeRateService.refreshAll(await currenciesInUse(), primary),
    });
  })
);

module.exports = router;
