const fs = require('fs');
const path = require('path');
const db = require('./connection');
const seed = require('./seed');

const schemaPath = path.join(__dirname, 'schema.sql');
const schema = fs.readFileSync(schemaPath, 'utf8');

db.exec(schema);
console.log('Schema applied.');

seed();

console.log('Database ready.');
