const express = require('express');
const db = require('../db/connection');
const settingsService = require('../services/settingsService');

const router = express.Router();

router.get('/', (req, res) => {
  const settings = settingsService.getAll();
  const currencies = db
    .prepare('SELECT DISTINCT currency FROM accounts ORDER BY currency')
    .all()
    .map((r) => r.currency);
  res.json({ ...settings, currenciesInUse: currencies });
});

router.put('/', (req, res) => {
  const { primary_currency: primaryCurrency } = req.body;
  if (primaryCurrency != null) {
    const code = String(primaryCurrency).trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(code)) {
      return res.status(400).json({ error: 'primary_currency must be a 3-letter code, e.g. AED' });
    }
    settingsService.set('primary_currency', code);
  }
  res.json(settingsService.getAll());
});

module.exports = router;
