-- Key/value app settings. Holds primary_currency, which every balance is
-- converted into for the household totals and charts.
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Free-form accounts: any number per person, each in its own currency.
-- `type` only distinguishes money set aside from money to spend, so the
-- dashboard can report savings separately; it does not constrain what the
-- account can do.
CREATE TABLE IF NOT EXISTS accounts (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id       INTEGER NOT NULL REFERENCES persons(id),
  name            TEXT NOT NULL,
  currency        TEXT NOT NULL DEFAULT 'AED',
  type            TEXT NOT NULL DEFAULT 'current' CHECK (type IN ('current','savings')),
  opening_balance REAL NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Single ledger for every movement of money. `amount` is always positive;
-- `kind` carries the direction. A transfer is two rows sharing a transfer_id
-- (one transfer_out, one transfer_in), which lets the two legs hold different
-- amounts when the accounts are in different currencies.
CREATE TABLE IF NOT EXISTS transactions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  month       TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income','expense','transfer_in','transfer_out')),
  amount      REAL NOT NULL,
  category    TEXT,
  description TEXT,
  transfer_id TEXT,
  entry_date  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Recurring charges. These are NOT written into `transactions`; they are
-- applied on the fly for every month in range, so editing or ending a
-- subscription immediately corrects past and future months alike.
CREATE TABLE IF NOT EXISTS subscriptions (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id    INTEGER NOT NULL REFERENCES accounts(id),
  name          TEXT NOT NULL,
  amount        REAL NOT NULL,
  cycle         TEXT NOT NULL DEFAULT 'monthly' CHECK (cycle IN ('monthly','yearly')),
  billing_month INTEGER,
  start_month   TEXT NOT NULL,
  end_month     TEXT,
  category      TEXT,
  notes         TEXT,
  is_active     INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS exchange_rates (
  base_currency   TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate            REAL NOT NULL,
  fetched_at      TEXT NOT NULL,
  PRIMARY KEY (base_currency, target_currency)
);

CREATE INDEX IF NOT EXISTS idx_accounts_person ON accounts(person_id);
CREATE INDEX IF NOT EXISTS idx_transactions_account_month ON transactions(account_id, month);
CREATE INDEX IF NOT EXISTS idx_transactions_month ON transactions(month);
CREATE INDEX IF NOT EXISTS idx_transactions_transfer ON transactions(transfer_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_account ON subscriptions(account_id);
