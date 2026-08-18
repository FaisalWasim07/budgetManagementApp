const express = require('express');
const crypto = require('crypto');
const notifyService = require('../services/notifyService');
const { h } = require('../util/route');

const router = express.Router();

// The scheduled job, reached by Vercel Cron rather than by a person.
//
// It cannot require a session — the scheduler has no login — so it is guarded
// by a shared secret instead. Without one set the route refuses everything
// rather than defaulting to open: a publicly callable endpoint that sends
// notifications to every registered device is a thing somebody would find.
//
// Vercel sends the secret as `Authorization: Bearer <CRON_SECRET>`.
const SECRET = process.env.CRON_SECRET || '';

// Compared without leaking how much of the prefix was right. Overkill for a
// value this long, and free.
function matches(given) {
  if (!SECRET || !given) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(SECRET);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const daily = h(async (req, res) => {
  if (!SECRET) {
    return res.status(503).json({ error: 'No CRON_SECRET is set, so this route is closed.' });
  }
  const header = req.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!matches(token)) return res.status(401).json({ error: 'Not authorised.' });

  const result = await notifyService.runDaily();
  res.json(result);
});

// Vercel Cron issues GET; POST is here for triggering it by hand. One handler
// registered twice rather than a redirect between them, which is how a route
// ends up calling into itself.
router.get('/daily', daily);
router.post('/daily', daily);

module.exports = router;
