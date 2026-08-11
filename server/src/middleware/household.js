const householdService = require('../services/householdService');

const HEADER = 'x-household-id';

// Resolves which household this request is about and confirms the signed-in
// user belongs to it. Every household-scoped route sits behind this, so no
// handler has to remember to check — and req.household.id is the only value
// they may scope a query by. Anything a client sends is a claim, not a fact.
async function resolveHousehold(req, res, next) {
  try {
    const asked = req.get(HEADER) || req.query.household;
    const memberships = await householdService.listForUser(req.user.id);

    if (memberships.length === 0) {
      return res.status(409).json({
        error: 'You are not in a household yet.',
        code: 'NO_HOUSEHOLD',
      });
    }

    // Without an explicit choice, the first one they joined. New clients and
    // old bookmarks then still work.
    const chosen = asked
      ? memberships.find((m) => String(m.id) === String(asked))
      : memberships[0];

    if (!chosen) {
      // Deliberately the same answer whether the household does not exist or
      // merely isn't theirs, so the header can't be used to discover which
      // households exist.
      return res.status(404).json({ error: 'Household not found.' });
    }

    req.household = { id: chosen.id, name: chosen.name, role: chosen.role };
    next();
  } catch (err) {
    next(err);
  }
}

// Read-only members may read. Everything else needs a role that can write.
function blockViewerWrites(req, res, next) {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.household.role === 'viewer') {
    return res.status(403).json({
      error: 'You have view-only access to this household.',
      code: 'VIEW_ONLY',
    });
  }
  next();
}

function requireOwner(req, res, next) {
  if (req.household.role !== 'owner') {
    return res.status(403).json({ error: 'Only an owner of this household can do that.' });
  }
  next();
}

module.exports = { resolveHousehold, blockViewerWrites, requireOwner, HEADER };
