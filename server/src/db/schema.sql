CREATE TABLE IF NOT EXISTS persons (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id   INTEGER NOT NULL REFERENCES persons(id),
  type        TEXT NOT NULL CHECK (type IN ('primary','savings','expense','multi_currency')),
  name        TEXT NOT NULL,
  currency    TEXT NOT NULL DEFAULT 'AED',
  is_active   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One row per person per month: salary plus the two outgoing transfers.
-- The primary account's remainder is intentionally NOT stored here — it is
-- always computed as salary_amount - transfer_to_savings - transfer_to_expense
-- so it can never drift out of sync with the source numbers.
CREATE TABLE IF NOT EXISTS monthly_entries (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  person_id           INTEGER NOT NULL REFERENCES persons(id),
  month               TEXT NOT NULL,
  salary_amount       REAL NOT NULL DEFAULT 0,
  transfer_to_savings REAL NOT NULL DEFAULT 0,
  transfer_to_expense REAL NOT NULL DEFAULT 0,
  notes               TEXT,
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(person_id, month)
);

CREATE TABLE IF NOT EXISTS expense_entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id  INTEGER NOT NULL REFERENCES accounts(id),
  month       TEXT NOT NULL,
  amount      REAL NOT NULL,
  description TEXT,
  entry_date  TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS multi_currency_contributions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id),
  month      TEXT NOT NULL,
  amount     REAL NOT NULL,
  notes      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- One cached row per currency pair, upserted on refresh rather than append-only.
CREATE TABLE IF NOT EXISTS exchange_rates (
  base_currency   TEXT NOT NULL,
  target_currency TEXT NOT NULL,
  rate            REAL NOT NULL,
  fetched_at      TEXT NOT NULL,
  PRIMARY KEY (base_currency, target_currency)
);

CREATE INDEX IF NOT EXISTS idx_accounts_person ON accounts(person_id);
CREATE INDEX IF NOT EXISTS idx_monthly_entries_month ON monthly_entries(month);
CREATE INDEX IF NOT EXISTS idx_expense_entries_account_month ON expense_entries(account_id, month);
CREATE INDEX IF NOT EXISTS idx_contributions_account_month ON multi_currency_contributions(account_id, month);
