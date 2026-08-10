const authService = require('../services/authService');

const COOKIE_NAME = 'budget_session';

// One cookie is all this app sets, so parsing it by hand avoids pulling in a
// dependency just to split a string.
function readSessionToken(req) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === COOKIE_NAME) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function setSessionCookie(res, token, expiresAt) {
  const attrs = [
    `${COOKIE_NAME}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly', // not readable from JavaScript, so a script injection can't steal it
    'SameSite=Lax',
    `Expires=${new Date(expiresAt).toUTCString()}`,
  ];
  // Only send over HTTPS once deployed; over plain http on the home network the
  // Secure flag would stop the cookie being set at all.
  if (process.env.COOKIE_SECURE === 'true') attrs.push('Secure');
  res.setHeader('Set-Cookie', attrs.join('; '));
}

function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
  );
}

// Attaches req.user when the request carries a valid session; never rejects.
function attachUser(req, res, next) {
  req.user = authService.getSessionUser(readSessionToken(req));
  next();
}

function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not signed in' });
  next();
}

module.exports = { attachUser, requireAuth, setSessionCookie, clearSessionCookie, COOKIE_NAME };
