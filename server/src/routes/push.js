const express = require('express');
const pushService = require('../services/pushService');
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

// Proves the whole chain in one tap: key, subscription, push service, service
// worker, and the phone's own notification settings. Without it the first real
// notification is days away and there is nothing to debug against.
router.post(
  '/test',
  h(async (req, res) => {
    const result = await pushService.sendTo(req.user.id, {
      title: 'Bayt',
      body: 'Notifications are working. This is the only one you asked for.',
      tag: 'bayt-test',
      renotify: true,
      url: '/',
    });
    if (result.skipped) return res.status(503).json({ error: 'Notifications are not set up yet.' });
    if (result.sent === 0) {
      return res.status(409).json({
        error:
          'No device accepted it. If this browser was registered a while ago its subscription may have expired — turn notifications off and on again.',
      });
    }
    res.json(result);
  })
);

module.exports = router;
