#!/usr/bin/env node
// Makes the VAPID keypair that notifications are signed with.
//
//   npm run push:keys
//
// Run it yourself and paste the output into your host's environment settings.
// Nobody else needs to see the private half — not a collaborator, not an
// assistant, not a commit. Anyone holding it can push notifications into every
// device that ever subscribed to this app, and there is no way to tell those
// apart from real ones.
//
// It is printed rather than written to a file on purpose: a file is something
// that gets committed by accident, and this repository is public.
//
// Losing them is survivable but not free — every device has to be turned off
// and on again, because the public half is baked into each subscription.
const webpush = require('web-push');

const { publicKey, privateKey } = webpush.generateVAPIDKeys();

console.log(`
Add these three to your environment — on Vercel that is
Project → Settings → Environment Variables — and redeploy.

VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:you@example.com

VAPID_SUBJECT is how a push service reaches you if something is wrong with
what this app is sending; any address you read will do.

For local development, put the same three in .env — which is gitignored, and
must stay that way.
`);
