const db = require('./connection');

const DEFAULT_ACCOUNTS = [
  { type: 'primary', name: 'Primary Account', currency: 'AED' },
  { type: 'savings', name: 'Rent/Savings', currency: 'AED' },
  { type: 'expense', name: 'Monthly Expense', currency: 'AED' },
];

function seed() {
  const personCount = db.prepare('SELECT COUNT(*) AS count FROM persons').get().count;
  if (personCount > 0) {
    console.log('Seed skipped: persons already exist.');
    return;
  }

  const insertPerson = db.prepare('INSERT INTO persons (name) VALUES (?)');
  const insertAccount = db.prepare(
    'INSERT INTO accounts (person_id, type, name, currency) VALUES (?, ?, ?, ?)'
  );

  const seedPerson = db.transaction((name) => {
    const { lastInsertRowid: personId } = insertPerson.run(name);
    for (const account of DEFAULT_ACCOUNTS) {
      insertAccount.run(personId, account.type, account.name, account.currency);
    }
  });

  seedPerson('Husband');
  seedPerson('Wife');

  console.log('Seeded 2 persons with 3 default accounts each.');
}

module.exports = seed;

if (require.main === module) {
  seed();
}
