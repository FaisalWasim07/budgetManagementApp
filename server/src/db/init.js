require('../config/env');
const db = require('./pool');
const ensureSchema = require('./ensureSchema');
const seed = require('./seed');

// The server applies the schema on start too, so this exists mainly to set a
// database up before the first run and to give a clear place to point at when
// something is wrong with the connection.
async function main() {
  await ensureSchema();
  console.log('Schema applied.');
  await seed();
  console.log('Database ready.');
}

main()
  .then(() => db.end())
  .catch((err) => {
    console.error('\nCould not prepare the database.\n');
    console.error(err.message);
    process.exit(1);
  });
