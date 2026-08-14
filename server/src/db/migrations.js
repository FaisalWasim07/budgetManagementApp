const db = require('./pool');

// Changes that CREATE ... IF NOT EXISTS cannot express: reshaping a table that
// already holds data. Each one checks the database's current shape rather than
// keeping a version number, so running it twice is a no-op and a database at
// any earlier point catches up in one go.
//
// Run inside the same advisory lock as the schema, so simultaneous cold starts
// can't attempt the same reshaping at once.

const columnExists = async (table, column) =>
  Boolean(
    await db.get(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = ? AND column_name = ?`,
      [table, column]
    )
  );

const tableExists = async (table) =>
  Boolean(
    await db.get(
      `SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = ?`,
      [table]
    )
  );

// Before households existed there was exactly one budget, implicitly shared by
// everyone who could sign in. That becomes a real household, owned by the
// earliest user, with everyone else a member of it — which is what they
// effectively already were.
async function adoptExistingDataIntoAHousehold(t) {
  const orphans = await t.get('SELECT COUNT(*) AS count FROM persons WHERE household_id IS NULL');
  const strayAccounts = await t.get(
    'SELECT COUNT(*) AS count FROM accounts WHERE household_id IS NULL'
  );
  const straySettings = (await tableExists('settings'))
    ? await t.get('SELECT COUNT(*) AS count FROM settings WHERE household_id IS NULL')
    : { count: 0 };

  if (orphans.count === 0 && strayAccounts.count === 0 && straySettings.count === 0) return null;

  const household = await t.get(
    'INSERT INTO households (name) VALUES (?) RETURNING id',
    ['Our household']
  );

  await t.run('UPDATE persons SET household_id = ? WHERE household_id IS NULL', [household.id]);
  await t.run('UPDATE accounts SET household_id = ? WHERE household_id IS NULL', [household.id]);
  await t.run('UPDATE settings SET household_id = ? WHERE household_id IS NULL', [household.id]);

  // Everyone who could already sign in keeps the access they had. The first
  // account created becomes the owner, being the one that set the app up.
  const users = await t.all('SELECT id FROM users ORDER BY id');
  for (const [index, user] of users.entries()) {
    await t.run(
      `INSERT INTO household_members (household_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT (household_id, user_id) DO NOTHING`,
      [household.id, user.id, index === 0 ? 'owner' : 'editor']
    );
  }

  return { household: household.id, people: orphans.count, users: users.length };
}

async function run() {
  const notes = [];

  // The columns arrive nullable so existing rows survive the addition, are
  // filled in below, and only then become NOT NULL.
  const additions = [
    ['persons', 'household_id'],
    ['accounts', 'household_id'],
    ['settings', 'household_id'],
  ];

  const added = [];
  for (const [table, column] of additions) {
    if (!(await tableExists(table))) continue;
    if (await columnExists(table, column)) continue;
    await db.exec(
      `ALTER TABLE ${table} ADD COLUMN ${column} integer REFERENCES households(id) ON DELETE CASCADE`
    );
    added.push(table);
  }

  if ((await tableExists('users')) && !(await columnExists('users', 'email'))) {
    await db.exec('ALTER TABLE users ADD COLUMN email text');
    notes.push('accounts can now hold an email address');
  }

  // Recurring items gained a direction when salary joined subscriptions.
  // Everything that existed before was money going out.
  if ((await tableExists('subscriptions')) && !(await columnExists('subscriptions', 'direction'))) {
    await db.exec(
      `ALTER TABLE subscriptions ADD COLUMN direction text NOT NULL DEFAULT 'expense'
         CHECK (direction IN ('expense','income'))`
    );
    notes.push('recurring items can now be income as well as spending');
  }

  // Who recorded a transaction. Stays nullable: entries made before this
  // existed genuinely have no author, and guessing at one would be a lie.
  if ((await tableExists('transactions')) && !(await columnExists('transactions', 'created_by'))) {
    await db.exec(
      'ALTER TABLE transactions ADD COLUMN created_by integer REFERENCES users(id) ON DELETE SET NULL'
    );
    notes.push('transactions now record who added them');
  }

  // settings used to be keyed by `key` alone. Once it is per-household the
  // primary key has to include the household, or two households cannot each
  // have their own primary currency.
  if (await tableExists('settings')) {
    const pk = await db.get(
      `SELECT COUNT(*) AS columns
       FROM information_schema.key_column_usage k
       JOIN information_schema.table_constraints c
         ON c.constraint_name = k.constraint_name AND c.table_schema = k.table_schema
       WHERE c.table_schema = 'public' AND c.table_name = 'settings'
         AND c.constraint_type = 'PRIMARY KEY'`
    );
    if (pk.columns === 1) {
      await db.exec('ALTER TABLE settings DROP CONSTRAINT IF EXISTS settings_pkey');
      notes.push('settings is now keyed per household');
    }
  }

  const adopted = await db.tx(adoptExistingDataIntoAHousehold);
  if (adopted) {
    notes.push(
      `moved ${adopted.people} existing people into a household and gave ${adopted.users} login(s) access to it`
    );
  }

  // Safe now that every row has one: anything inserted from here on must say
  // which household it belongs to.
  for (const table of added) {
    const nulls = await db.get(`SELECT COUNT(*) AS count FROM ${table} WHERE household_id IS NULL`);
    if (nulls.count === 0) {
      await db.exec(`ALTER TABLE ${table} ALTER COLUMN household_id SET NOT NULL`);
    }
  }

  if (await tableExists('settings')) {
    await db.exec(
      `DO $$ BEGIN
         ALTER TABLE settings ADD CONSTRAINT settings_pkey PRIMARY KEY (household_id, key);
       EXCEPTION WHEN duplicate_table OR invalid_table_definition THEN NULL;
       END $$`
    );
  }

  // ── Passkeys ───────────────────────────────────────────────────────────
  // A second factor after the password. Three tables rather than columns on
  // `users`, because each is a list: a person has several devices, ten recovery
  // codes, and one sign-in in flight at a time.
  //
  // The public key is exactly that — public. Losing the database to someone
  // gives them nothing they can sign with, which is the point of the whole
  // exercise and the reason this is worth more than a shared secret.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS credentials (
      id            integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id       integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      credential_id text NOT NULL UNIQUE,
      public_key    text NOT NULL,
      -- Bumped by the authenticator on every use. A count that goes backwards
      -- means the credential has been cloned.
      counter       bigint NOT NULL DEFAULT 0,
      transports    text,
      label         text NOT NULL,
      created_at    timestamptz NOT NULL DEFAULT now(),
      last_used_at  timestamptz
    )`);

  // Hashed with the same scrypt the passwords use: a recovery code is a
  // password that happens to be machine-generated and single use.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS recovery_codes (
      id        integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
      user_id   integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      code_hash text NOT NULL,
      used_at   timestamptz
    )`);

  // The half-authenticated state: password accepted, second factor still
  // owed. `attempts` lives here rather than in the in-memory map the password
  // limiter uses — on a serverless host that map is per instance and resets
  // constantly, which is tolerable for a password and not for six digits.
  await db.exec(`
    CREATE TABLE IF NOT EXISTS login_challenges (
      id         text PRIMARY KEY,
      user_id    integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind       text NOT NULL CHECK (kind IN ('register','login')),
      challenge  text NOT NULL,
      attempts   integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL
    )`);

  await db.exec('CREATE INDEX IF NOT EXISTS idx_credentials_user ON credentials(user_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_recovery_codes_user ON recovery_codes(user_id)');
  await db.exec(
    'CREATE INDEX IF NOT EXISTS idx_login_challenges_expiry ON login_challenges(expires_at)'
  );

  // Indexes over columns added above, rather than in schema.sql. That file is
  // applied first, and would be indexing a column that does not exist yet on
  // any database predating the migration that adds it.
  await db.exec('CREATE INDEX IF NOT EXISTS idx_persons_household ON persons(household_id)');
  await db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_household ON accounts(household_id)');
  await db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
       ON users (lower(email)) WHERE email IS NOT NULL`
  );

  return notes;
}

module.exports = { run };
