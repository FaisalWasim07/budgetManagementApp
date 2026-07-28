const express = require('express');
const exchangeRateService = require('../services/exchangeRateService');

const router = express.Router();

router.get('/:base/:target', async (req, res) => {
  const { base, target } = req.params;
  const result = await exchangeRateService.getRate(base.toUpperCase(), target.toUpperCase());
  res.json(result);
});

router.post('/refresh', async (req, res) => {
  const { base, target } = req.body;
  if (!base || !target) {
    return res.status(400).json({ error: 'base and target are required' });
  }
  const result = await exchangeRateService.refreshRate(base.toUpperCase(), target.toUpperCase());
  res.json(result);
});

module.exports = router;
