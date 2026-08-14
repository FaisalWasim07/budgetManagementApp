const express = require('express');
const summaryService = require('../services/summaryService');
const { h } = require('../util/route');

const router = express.Router();

router.get(
  '/trend',
  h(async (req, res) => {
    const months = req.query.months ? Number(req.query.months) : 12;
    res.json(await summaryService.getTrend(req.household.id, months, req.query.endMonth));
  })
);

router.get(
  '/categories/:month',
  h(async (req, res) => {
    res.json(await summaryService.getCategoryBreakdown(req.household.id, req.params.month));
  })
);

router.get(
  '/:month',
  h(async (req, res) => {
    res.json(await summaryService.getSummary(req.household.id, req.params.month, req.user.id));
  })
);

module.exports = router;
