const express = require('express');
const summaryService = require('../services/summaryService');

const router = express.Router();

router.get('/trend', async (req, res) => {
  const months = req.query.months ? Number(req.query.months) : 12;
  const trend = await summaryService.getTrend(months, req.query.endMonth);
  res.json(trend);
});

router.get('/:month', async (req, res) => {
  const summary = await summaryService.getSummary(req.params.month);
  res.json(summary);
});

module.exports = router;
