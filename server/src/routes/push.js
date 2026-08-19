const express = require('express');
const db = require('../db/pool');
const pushService = require('../services/pushService');
const notifyService = require('../services/notifyService');
const { h } = require('../util/route');

const router = express.Router();

// Notifications belong to a person and a browser, not to a household — which
// is why this router is mounted before the household-scoping middleware. A
// viewer should still be able to be told things about the household they can
// see, and blockViewerWrites would otherwise refuse them the POST that turns
// notifications on.

// What the browser needs to subscribe. Public by design — it is baked into
// every subscription and is worth nothing without the private half.
router.get(
  '/key',
  h(async (req, res) => {
    res.json({ configured: pushService.isConfigured(), key: pushService.publicKey() || null });
  })
);

router.get(
  '/devices',
  h(async (req, res) => {
    const devices = await pushService.list(req.user.id);
    // The endpoint is a capability: anyone holding it can be pushed to. It is
    // never sent back out, so the list carries only what a person needs to
    // recognise their own devices.
    res.json({
      configured: pushService.isConfigured(),
      devices: devices.map(({ endpoint, ...rest }) => rest),
    });
  })
);

router.post(
  '/subscribe',
  h(async (req, res) => {
    if (!pushService.isConfigured()) {
      return res.status(503).json({ error: 'Notifications are not set up on this server yet.' });
    }
    const { endpoint, keys, label } = req.body ?? {};
    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return res.status(400).json({ error: 'A complete push subscription is required.' });
    }
    await pushService.save(req.user.id, { endpoint, keys, label });
    res.status(201).json({ ok: true });
  })
);

router.post(
  '/unsubscribe',
  h(async (req, res) => {
    const { endpoint } = req.body ?? {};
    if (!endpoint) return res.status(400).json({ error: 'endpoint is required' });
    await pushService.remove(req.user.id, endpoint);
    res.json({ ok: true });
  })
);

// What today would actually send, delivered for real.
//
// This replaced a fixed "send a test" message, which proved the delivery chain
// but told you nothing about what the app would ever say. This proves the same
// chain — key, subscription, push service, worker, and the phone's own
// settings — and shows the real words at the same time.
//
// Most days nothing is scheduled, and on those days a preview that sent
// nothing would be indistinguishable from a broken one. So when today has no
// message, the month opener is previewed anyway and flagged as not scheduled:
// still true text, still a real delivery, honestly labelled.
router.post(
  '/preview',
  h(async (req, res) => {
    // This router sits above the household middleware, since being notified
    // belongs to a person rather than a household. So membership is checked
    // here rather than assumed — a preview must never reach into a household
    // the caller is not in.
    const asked = Number(req.get('x-household-id')) || null;
    const mine = await db.all(
      'SELECT household_id FROM household_members WHERE user_id = ? ORDER BY household_id',
      [req.user.id]
    );
    if (mine.length === 0) {
      return res.status(400).json({ error: 'Join or create a household first.' });
    }
    const ids = mine.map((row) => row.household_id);
    const householdId = ids.includes(asked) ? asked : ids[0];

    const now = new Date();
    let messages = await notifyService.messagesFor(householdId, now);
    const scheduled = messages.length > 0;
    if (!scheduled) {
      messages = [await notifyService.monthOpener(householdId, notifyService.currentMonth())];
    }

    const results = [];
    for (const message of messages) {
      results.push(await pushService.sendTo(req.user.id, message));
    }
    const sent = results.reduce((total, r) => total + (r.sent ?? 0), 0);

    res.json({
      scheduled,
      // Returned as well as sent, so the panel can show the words even on a
      // desktop where the notification may be missed in the corner.
      messages: messages.map(({ title, body }) => ({ title, body })),
      sent,
      configured: pushService.isConfigured(),
    });
  })
);

module.exports = router;
