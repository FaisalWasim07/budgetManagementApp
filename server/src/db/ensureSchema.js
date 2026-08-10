const fs = require('fs');
const path = require('path');
const db = require('./connection');

// Every statement in schema.sql is CREATE ... IF NOT EXISTS, so running it is a
// no-op against an up-to-date database and creates anything a new version of
// the app added. The server calls this on start, which is what makes "git pull
// and run" work — otherwise a release that adds a table crashes on the first
// query until `npm run db:init` is run by hand.
//
// Reshaping an existing table is a different job and stays in init.js. This is
// deliberately not done inside connection.js: init.js has to be able to open
// the database in order to migrate it, so opening must never depend on the
// schema already being right.
module.exports = function ensureSchema() {
  db.exec(fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8'));
};
