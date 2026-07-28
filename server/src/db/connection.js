const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, 'budget.sqlite3');
const db = new Database(dbPath);
db.pragma('foreign_keys = ON');

module.exports = db;
