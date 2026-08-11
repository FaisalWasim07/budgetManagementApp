require('../config/env');
const db = require('./pool');

// A starting household, so a brand new database isn't a screen with nothing on
// it. Skipped entirely once anything exists — in normal use a household is
// created by the first person to sign up, not by this.
const DEFAULT_PEOPLE = ['Husband', 'Wife'];

async function seed() {
  const { count } = await db.get('SELECT COUNT(*) AS count FROM households');
  if (count > 0) {
    console.log('Seed skipped: a household already exists.');
    return;
  }

  await db.tx(async (t) => {
    const household = await t.get('INSERT INTO households (name) VALUES (?) RETURNING id', [
      'Our household',
    ]);
    await t.run('INSERT INTO settings (household_id, key, value) VALUES (?, ?, ?)', [
      household.id,
      'primary_currency',
      'AED',
    ]);

    for (const [index, name] of DEFAULT_PEOPLE.entries()) {
      const person = await t.get(
        'INSERT INTO persons (household_id, name) VALUES (?, ?) RETURNING id',
        [household.id, name]
      );
      for (const [offset, account] of [
        { name: 'Main Account', type: 'current' },
        { name: 'Savings', type: 'savings' },
      ].entries()) {
        await t.run(
          `INSERT INTO accounts (household_id, person_id, name, currency, type, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [household.id, person.id, account.name, 'AED', account.type, index * 2 + offset]
        );
      }
    }

    // Anyone who can already sign in gets access to it, since there is nobody
    // else it could belong to.
    const users = await t.all('SELECT id FROM users ORDER BY id');
    for (const [index, user] of users.entries()) {
      await t.run(
        `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)
         ON CONFLICT (household_id, user_id) DO NOTHING`,
        [household.id, user.id, index === 0 ? 'owner' : 'editor']
      );
    }
  });

  console.log('Seeded a household with 2 people and 2 accounts each.');
}

module.exports = seed;

if (require.main === module) {
  seed()
    .then(() => db.end())
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
