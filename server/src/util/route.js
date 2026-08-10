// Express 4 does not catch a rejected promise returned by a handler: the
// request would hang until it timed out, with the real error surfacing only as
// an unhandled rejection. Every async handler is wrapped in this so failures
// reach the error middleware and the client gets a 500 instead of silence.
const h = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { h };
