require('../config/env');
const db = require('./pool');

const DEFAULT_PRIMARY_CURRENCY = 'AED';

// A minimal starting point: one spending account and one savings account each.
// Everything else (extra accounts, other currencies) is added from the UI.
const DEFAULT_ACCOUNTS = [
  { name: 'Main Account', currency: 'AED', type: 'current', sort_order: 0 },
  { name: 'Savings', currency: 'AED', type: 'savings', sort_order: 1 },
];

async function seed() {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO NOTHING',
    ['primary_currency', DEFAULT_PRIMARY_CURRENCY]
  );

  const { count } = await db.get('SELECT COUNT(*) AS count FROM persons');
  if (count > 0) {
    console.log('Seed skipped: persons already exist.');
    return;
  }

  for (const name of ['Husband', 'Wife']) {
    await db.tx(async (t) => {
      const person = await t.get('INSERT INTO persons (name) VALUES (?) RETURNING id', [name]);
      for (const a of DEFAULT_ACCOUNTS) {
        await t.run(
          'INSERT INTO accounts (person_id, name, currency, type, sort_order) VALUES (?, ?, ?, ?, ?)',
          [person.id, a.name, a.currency, a.type, a.sort_order]
        );
      }
    });
  }

  console.log('Seeded 2 persons with 2 default accounts each.');
}

module.exports = seed;

if (require.main === module) {
  seed()
    .then(() => db.pool.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
