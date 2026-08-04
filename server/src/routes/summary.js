const express = require('express');
const summaryService = require('../services/summaryService');

const router = express.Router();

router.get('/trend', async (req, res) => {
  const months = req.query.months ? Number(req.query.months) : 12;
  res.json(await summaryService.getTrend(months, req.query.endMonth));
});

router.get('/categories/:month', async (req, res) => {
  res.json(await summaryService.getCategoryBreakdown(req.params.month));
});

router.get('/:month', async (req, res) => {
  res.json(await summaryService.getSummary(req.params.month));
});

module.exports = router;
