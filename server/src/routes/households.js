const express = require('express');
const db = require('../db/pool');
const householdService = require('../services/householdService');
const authService = require('../services/authService');
const { h } = require('../util/route');

const router = express.Router();

// These sit outside the household-scoped middleware on purpose: you have to be
// able to list your households before one can be chosen, create your first,
// and accept an invite into one you are not yet a member of.

router.get(
  '/',
  h(async (req, res) => {
    res.json(await householdService.listForUser(req.user.id));
  })
);

router.post(
  '/',
  h(async (req, res) => {
    const { name, people = [] } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Give the household a name.' });
    }
    const names = (Array.isArray(people) ? people : [])
      .map((p) => String(p).trim())
      .filter(Boolean);

    const household = await householdService.create(req.user.id, name, names);
    res.status(201).json({ ...household, role: 'owner' });
  })
);

// Everything below is about one household, so membership is established first.
async function withMembership(req, res, next) {
  const role = await householdService.roleOf(req.user.id, req.params.id);
  // Same answer for "no such household" and "not yours", so this can't be used
  // to find out which households exist.
  if (!role) return res.status(404).json({ error: 'Household not found.' });
  req.membership = { id: Number(req.params.id), role };
  next();
}

const requireOwner = (req, res, next) =>
  req.membership.role === 'owner'
    ? next()
    : res.status(403).json({ error: 'Only an owner of this household can do that.' });

router.get(
  '/:id/members',
  h(withMembership),
  h(async (req, res) => {
    res.json(await householdService.members(req.membership.id));
  })
);

router.patch(
  '/:id',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    const { name } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Give the household a name.' });
    }
    res.json(
      await db.get('UPDATE households SET name = ? WHERE id = ? RETURNING *', [
        String(name).trim(),
        req.membership.id,
      ])
    );
  })
);

router.get(
  '/:id/invites',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    res.json(await householdService.openInvites(req.membership.id));
  })
);

router.post(
  '/:id/invites',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    const role = req.body.role || 'editor';
    if (!householdService.ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${householdService.ROLES.join(', ')}` });
    }
    res.status(201).json(await householdService.createInvite(req.membership.id, req.user.id, role));
  })
);

router.delete(
  '/:id/invites/:code',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    await householdService.revokeInvite(req.membership.id, req.params.code);
    res.status(204).end();
  })
);

// Accepting is done by the invitee, who is not yet a member — so this one is
// keyed by the code alone rather than by a household id.
router.post(
  '/accept',
  h(async (req, res) => {
    const code = String(req.body.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Paste the invite code.' });

    const result = await householdService.acceptInvite(code, req.user.id);
    if (result.error) return res.status(400).json(result);
    res.json(result);
  })
);

// Adding someone directly, rather than by invite code: the owner sets up their
// login for them. This is the household-member case — a partner sitting next to
// you — where sending a code to redeem is ceremony for its own sake. It also
// creates them as a person with a main account, so their money has somewhere
// to go the moment they sign in.
router.post(
  '/:id/members',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    const { username, password, role = 'editor', add_person: addPerson = true } = req.body;

    if (!householdService.ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${householdService.ROLES.join(', ')}` });
    }
    if (!username || !String(username).trim()) {
      return res.status(400).json({ error: 'Choose a username for them.' });
    }

    let user = await authService.findUser(username);
    if (user) {
      // An existing account is added as-is; their password is theirs, and this
      // must never be a way to set it.
      if (await householdService.roleOf(user.id, req.membership.id)) {
        return res.status(409).json({ error: 'They are already in this household.' });
      }
    } else {
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters.' });
      }
      user = await authService.createUser(username, password);
    }

    await db.run(
      `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (household_id, user_id) DO NOTHING`,
      [req.membership.id, user.id, role]
    );

    if (addPerson) {
      const existing = await db.get(
        'SELECT id, user_id FROM persons WHERE household_id = ? AND lower(name) = lower(?)',
        [req.membership.id, user.username]
      );
      // A person by that name already here and unclaimed is this login: adding
      // them directly is exactly the moment the app knows the two are the same
      // human, so it never has to guess later.
      if (existing) {
        if (!existing.user_id) {
          await db.run('UPDATE persons SET user_id = ? WHERE id = ?', [user.id, existing.id]);
        }
      } else {
        await db.tx(async (t) => {
          const person = await t.get(
            'INSERT INTO persons (household_id, name, user_id) VALUES (?, ?, ?) RETURNING id',
            [req.membership.id, user.username, user.id]
          );
          const { next } = await t.get(
            'SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM accounts WHERE household_id = ?',
            [req.membership.id]
          );
          await t.run(
            `INSERT INTO accounts (household_id, person_id, name, currency, type, sort_order)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [req.membership.id, person.id, 'Main Account', 'AED', 'current', next]
          );
        });
      }
    }

    res.status(201).json({ user_id: user.id, username: user.username, role });
  })
);

// An owner setting a member's password for them. There is no email anywhere in
// this app, so there is no reset link to send — and for a household, the person
// who set the account up in the first place is the right person to fix it.
//
// Not permitted against another owner: co-owners would otherwise be able to
// lock each other out of a shared budget, which is a fight the app shouldn't
// hand anyone the tools for. The member's sessions all end, so a reset they
// didn't ask for cannot pass unnoticed.
router.post(
  '/:id/members/:userId/password',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    const target = Number(req.params.userId);
    const { new_password: newPassword } = req.body;

    const role = await householdService.roleOf(target, req.membership.id);
    if (!role) return res.status(404).json({ error: 'That person is not in this household.' });
    if (target === req.user.id) {
      return res.status(400).json({
        error: 'Use Settings to change your own password — it asks for your current one.',
      });
    }
    if (role === 'owner') {
      return res.status(403).json({
        error: 'You cannot reset another owner’s password. Ask them to change it themselves.',
      });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    }

    await authService.setPassword(target, newPassword);
    res.json({ ok: true, signedOut: true });
  })
);

router.patch(
  '/:id/members/:userId',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    const { role } = req.body;
    if (!householdService.ROLES.includes(role)) {
      return res.status(400).json({ error: `role must be one of ${householdService.ROLES.join(', ')}` });
    }

    // A household with no owner could never be administered again, so the last
    // one cannot demote themselves.
    const target = Number(req.params.userId);
    if (role !== 'owner' && (await householdService.ownerCount(req.membership.id)) === 1) {
      const current = await householdService.roleOf(target, req.membership.id);
      if (current === 'owner') {
        return res.status(400).json({ error: 'A household needs at least one owner.' });
      }
    }

    const updated = await db.get(
      `UPDATE household_members SET role = ? WHERE household_id = ? AND user_id = ?
       RETURNING household_id, user_id, role`,
      [role, req.membership.id, target]
    );
    if (!updated) return res.status(404).json({ error: 'That person is not in this household.' });
    res.json(updated);
  })
);

router.delete(
  '/:id/members/:userId',
  h(withMembership),
  h(async (req, res) => {
    const target = Number(req.params.userId);
    const leavingSelf = target === req.user.id;

    // You can always show yourself out; removing anyone else is an owner's job.
    if (!leavingSelf && req.membership.role !== 'owner') {
      return res.status(403).json({ error: 'Only an owner of this household can do that.' });
    }

    const role = await householdService.roleOf(target, req.membership.id);
    if (!role) return res.status(404).json({ error: 'That person is not in this household.' });
    if (role === 'owner' && (await householdService.ownerCount(req.membership.id)) === 1) {
      return res.status(400).json({
        error: 'A household needs at least one owner. Make someone else an owner first.',
      });
    }

    await db.run('DELETE FROM household_members WHERE household_id = ? AND user_id = ?', [
      req.membership.id,
      target,
    ]);
    res.status(204).end();
  })
);

// Deleting a household takes its people, accounts and ledger with it, which is
// why it asks for the name back rather than a yes/no.
router.delete(
  '/:id',
  h(withMembership),
  requireOwner,
  h(async (req, res) => {
    const household = await db.get('SELECT * FROM households WHERE id = ?', [req.membership.id]);
    if (String(req.body?.confirm || '').trim() !== household.name) {
      return res.status(400).json({
        error: `To delete this household, send its name (“${household.name}”) as confirmation.`,
      });
    }
    await db.run('DELETE FROM households WHERE id = ?', [req.membership.id]);
    res.status(204).end();
  })
);

module.exports = router;
