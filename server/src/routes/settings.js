const express = require('express');
const db = require('../db/pool');
const settingsService = require('../services/settingsService');
const { h } = require('../util/route');

const router = express.Router();

router.get(
  '/',
  h(async (req, res) => {
    const primary = await settingsService.primaryCurrency();
    const rows = await db.all(
      'SELECT DISTINCT currency FROM accounts WHERE is_active = 1 ORDER BY currency'
    );

    res.json({
      primary_currency: primary,
      currenciesInUse: rows.map((r) => r.currency),
      manualRates: await settingsService.manualRates(primary),
    });
  })
);

router.put(
  '/',
  h(async (req, res) => {
    const { primary_currency: primaryCurrency, manualRates } = req.body;

    if (primaryCurrency != null) {
      const code = String(primaryCurrency).trim().toUpperCase();
      if (!/^[A-Z]{3}$/.test(code)) {
        return res.status(400).json({ error: 'primary_currency must be a 3-letter code, e.g. AED' });
      }
      await settingsService.set('primary_currency', code);
    }

    // { PKR: 0.0128 } — a blank or zero value clears the override.
    if (manualRates && typeof manualRates === 'object') {
      const target = await settingsService.primaryCurrency();
      for (const [base, raw] of Object.entries(manualRates)) {
        const code = String(base).trim().toUpperCase();
        if (!/^[A-Z]{3}$/.test(code)) continue;
        const key = settingsService.manualRateKey(code, target);
        const value = Number(raw);
        if (raw === '' || raw === null || !Number.isFinite(value) || value <= 0) {
          await settingsService.remove(key);
        } else {
          await settingsService.set(key, value);
        }
      }
    }

    const primary = await settingsService.primaryCurrency();
    res.json({
      primary_currency: primary,
      manualRates: await settingsService.manualRates(primary),
    });
  })
);

module.exports = router;
