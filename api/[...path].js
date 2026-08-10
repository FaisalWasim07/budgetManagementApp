// Vercel entry point. The filename is a catch-all, so every /api/* request is
// handled by this one function and Express does its own routing inside it —
// rather than one serverless function per endpoint, which would mean a
// separate cold start and a separate connection pool for each.
const app = require('../server/src/app');

module.exports = (req, res) => {
  // The routers are mounted under /api. Depending on how the platform rewrites
  // a catch-all it may hand over the path with that prefix already stripped, so
  // it's put back when missing. Harmless when it was never removed.
  if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  return app(req, res);
};
