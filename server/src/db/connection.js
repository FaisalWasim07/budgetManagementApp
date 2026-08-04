const path = require('path');
const fs = require('fs');

// Node's built-in SQLite. Deliberately not better-sqlite3: that one compiles
// native code at install time, which needs Python and a C++ toolchain on any
// machine without a matching prebuilt binary. This has no build step at all.
let DatabaseSync;
try {
  ({ DatabaseSync } = require('node:sqlite'));
} catch (err) {
  throw new Error(
    `This app needs Node.js 24 or newer — it uses Node's built-in SQLite. ` +
      `You are running ${process.version}. ` +
      `Install the LTS build from https://nodejs.org, then run the app again.`
  );
}

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'budget.sqlite3');
const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON');

module.exports = db;
