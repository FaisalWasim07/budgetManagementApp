// Vercel entry point. Plainly named on purpose: bracketed catch-all filenames
// are a framework routing convention, and vercel.json routes every /api request
// here explicitly instead, so Express does all the routing itself.
//
// One function rather than one per endpoint, so a request doesn't pay for its
// own cold start and its own database pool.
const app = require('../server/src/app');

module.exports = (req, res) => {
  // The routers are mounted under /api. If a rewrite ever hands the path over
  // with that prefix stripped, put it back; harmless when it was never removed.
  if (!req.url.startsWith('/api')) {
    req.url = `/api${req.url.startsWith('/') ? '' : '/'}${req.url}`;
  }
  return app(req, res);
};
