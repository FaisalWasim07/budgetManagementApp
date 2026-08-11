const express = require('express');
const db = require('../db/pool');
const exchangeRateService = require('../services/exchangeRateService');
const settingsService = require('../services/settingsService');
const { h } = require('../util/route');

const router = express.Router();

const currenciesInUse = async (householdId) =>
  (
    await db.all('SELECT DISTINCT currency FROM accounts WHERE household_id = ? AND is_active = 1', [
      householdId,
    ])
  ).map((r) => r.currency);

// Every rate the app currently needs, keyed by currency.
router.get(
  '/',
  h(async (req, res) => {
    const primary = await settingsService.primaryCurrency(req.household.id);
    res.json({
      primaryCurrency: primary,
      rates: await exchangeRateService.getRateMap(await currenciesInUse(req.household.id), primary, {
        householdId: req.household.id,
      }),
    });
  })
);

// Asks every provider directly and reports what each one did, so a failing
// rate can be traced to the provider rather than guessed at.
router.get(
  '/diagnose',
  h(async (req, res) => {
    const primary = await settingsService.primaryCurrency(req.household.id);
    const bases = (await currenciesInUse(req.household.id)).filter((c) => c !== primary);
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
    res.json(
      await exchangeRateService.getRate(base.toUpperCase(), target.toUpperCase(), {
        householdId: req.household.id,
      })
    );
  })
);

// Forces a refetch of every in-use currency, ignoring the daily cache.
router.post(
  '/refresh',
  h(async (req, res) => {
    const primary = await settingsService.primaryCurrency(req.household.id);
    res.json({
      primaryCurrency: primary,
      rates: await exchangeRateService.refreshAll(
        await currenciesInUse(req.household.id),
        primary,
        req.household.id
      ),
    });
  })
);

module.exports = router;
