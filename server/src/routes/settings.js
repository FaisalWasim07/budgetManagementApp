const express = require('express');
const db = require('../db/connection');
const settingsService = require('../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => {
  const primary = settingsService.primaryCurrency();
  const currencies = db
    .prepare('SELECT DISTINCT currency FROM accounts WHERE is_active = 1 ORDER BY currency')
    .all()
    .map((r) => r.currency);

  res.json({
    primary_currency: primary,
    currenciesInUse: currencies,
    manualRates: settingsService.manualRates(primary),
  });
});

router.put('/', (req, res) => {
  const { primary_currency: primaryCurrency, manualRates } = req.body;

  if (primaryCurrency != null) {
    const code = String(primaryCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: 'primary_currency must be a 3-letter code, e.g. AED' });
    }
    settingsService.set('primary_currency', code);
  }

  // { PKR: 0.0128 } — a blank or zero value clears the override.
  if (manualRates && typeof manualRates === 'object') {
    const target = settingsService.primaryCurrency();
    for (const [base, raw] of Object.entries(manualRates)) {
      const code = String(base).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) continue;
      const key = settingsService.manualRateKey(code, target);
      const value = Number(raw);
      if (raw === '' || raw === null || !Number.isFinite(value) || value <= 0) {
        settingsService.remove(key);
      } else {
        settingsService.set(key, value);
      }
    }
  }

  const primary = settingsService.primaryCurrency();
  res.json({
    primary_currency: primary,
    manualRates: settingsService.manualRates(primary),
  });
});

module.exports = router;
