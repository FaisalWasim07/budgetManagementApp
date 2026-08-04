const db = require('./connection');

const DEFAULT_PRIMARY_CURRENCY = 'AED';

// A minimal starting point: one spending account and one savings account each.
// Everything else (extra accounts, other currencies) is added from the UI.
const DEFAULT_ACCOUNTS = [
  { name: 'Main Account', currency: 'AED', type: 'current', sort_order: 0 },
  { name: 'Savings', currency: 'AED', type: 'savings', sort_order: 1 },
];

function seed() {
  db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING').run(
    'primary_currency',
    DEFAULT_PRIMARY_CURRENCY
  );

  const personCount = db.prepare('SELECT COUNT(*) AS count FROM persons').get().count;
  if (personCount > 0) {
    console.log('Seed skipped: persons already exist.');
    return;
  }

  const insertPerson = db.prepare('INSERT INTO persons (name) VALUES (?)');
  const insertAccount = db.prepare(
    'INSERT INTO accounts (person_id, name, currency, type, sort_order) VALUES (?, ?, ?, ?, ?)'
  );

  const seedPerson = (name) => {
    db.exec('BEGIN');
    try {
      const { lastInsertRowid: personId } = insertPerson.run(name);
      for (const a of DEFAULT_ACCOUNTS) {
        insertAccount.run(personId, a.name, a.currency, a.type, a.sort_order);
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
  };

  seedPerson('Husband');
  seedPerson('Wife');

  console.log('Seeded 2 persons with 2 default accounts each.');
}

module.exports = seed;

if (require.main === module) {
  seed();
}
