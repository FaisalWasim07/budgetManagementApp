# Household Monthly Budget

A monthly budget tracker for two people sharing a household.

Each person can have **any number of accounts, each in its own currency**. You
record salary as income into an account, then log spending against it and move
money between accounts; every account keeps a running total. Balances in other
currencies are converted to your **primary currency** (AED by default, changed
in Settings) using live exchange rates, so the household totals cover everything
in one number.

**Subscriptions** are defined once on their own page and then charged
automatically every month from the account you choose — monthly or yearly —
without re-entering them. That account can be a **credit card**, whose balance
goes negative to show what you owe; paying the card off is just a transfer into
it.

You can only move money you actually have — transfers are blocked if the source
account doesn't cover them. Credit cards are the exception, since going negative
there is the point.

The **Dashboard** gives the household view first (net worth, income, spending,
subscriptions, what's left over, anything owed on cards), then each person's
accounts, then every transaction for the month as a filterable table. **Stats**
is a separate tab with charts for money in vs out, net worth over time,
per-account balances, and where the money actually went.

- No login — a single shared app, with data recorded per person
- Money is never stored as a balance; every total is derived from the entries
  behind it, so nothing can silently drift out of sync

## Prerequisites

You need **Node.js** and **Git**. Check whether you already have them:

```
node -v
git --version
```

If either is missing:

- **Node.js 24 or newer** — install the **LTS** build from
  [nodejs.org](https://nodejs.org). The app stores data using Node's own
  built-in SQLite, which needs Node 24+. Nothing here compiles native code, so
  you do **not** need Python, Visual Studio, or any build tools.
- **Git** — [git-scm.com](https://git-scm.com/downloads).

Reopen your terminal after installing, then re-run the checks above.

## Setup

Run these once:

```
git clone https://github.com/FaisalWasim07/budgetManagementApp.git
cd budgetManagementApp
npm install
npm run db:init
```

`npm install` installs the frontend and backend dependencies too, via a
`postinstall` hook — you don't need a second install command.

`npm run db:init` creates the database and seeds two people ("Husband" and
"Wife", both renamable in the app) with their three default accounts each. Run
it **once**; it won't overwrite existing data if you run it again.

## Running it

For everyday use:

```
npm run dev
```

Then open **http://localhost:5173**.

This starts the API on port 5000 and the frontend on port 5173, which proxies
`/api` to the backend. Stop it with `Ctrl + C`. To start it again later, just
`npm run dev` — the setup steps are one-time.

### Single-port mode

To run it as one process on one port (useful on an always-on machine):

```
npm run build
npm start
```

Then open **http://localhost:5000**. Express serves the built frontend and the
API together.

## Opening it from your phone

With `npm run dev` running, look for the **Network** line in the output:

```
➜  Local:   http://localhost:5173/
➜  Network: http://192.168.1.42:5173/     ← use this on your phone
```

Type that Network URL into your phone's browser. Requirements:

- Both devices on the **same WiFi** (not cellular)
- The computer running `npm run dev` stays awake
- On Windows, allow the firewall prompt for Node.js — tick **Private networks**

Guest and public WiFi networks often isolate devices from each other, which
blocks this.

## Your data

Everything lives in a single file: **`server/src/data/budget.sqlite3`**

This file is gitignored on purpose — it's your financial data and shouldn't go
to GitHub. It's also your **only backup**, so copy it somewhere safe from time
to time. To start completely fresh, delete it and re-run `npm run db:init`.

If you're coming from an older version of the app, `npm run db:init` notices the
previous database layout, saves a copy next to it as
`budget.sqlite3.old-<timestamp>`, and builds a fresh one. Nothing is deleted, but
the old data isn't carried across — the structure changed too much.

## Exchange rates

Rates come from [Frankfurter](https://frankfurter.dev), a free API that needs no
key or account. Each currency pair is fetched at most once per day and cached in
the database; **Refresh** in Settings forces an update.

If the API can't be reached, the app falls back to the last cached rate (shown as
"cached"). With no cached rate at all, those accounts are listed as unconverted
and left out of the household totals rather than silently counted as zero — a
banner on the dashboard says which currencies are affected.

A lookup gives up after **4 seconds** and a failure is remembered for a minute,
so an unreachable rate service slows a page load slightly instead of hanging it.
If a currency matters to you, set a **fallback rate** for it in Settings — that
value is used whenever the live one can't be had, so your totals still add up.

Two things worth knowing:

- Conversion uses the *current* rate against the whole balance, not a historical
  rate per entry. Fine for a household dashboard, but past months' converted
  figures shift as rates move.
- **Transfers between accounts in different currencies ask for both amounts** —
  what left one account and what arrived in the other. That records what your
  bank actually did, including its spread and fees, instead of an estimate.

### Adding another currency

Pick it from the currency list when creating or editing an account. No schema
change and no configuration — the rate lookup and conversion follow
automatically, and you can change which currency is "primary" in Settings at any
time.

## Troubleshooting

**`'vite' is not recognized` / `'nodemon' is not recognized`**

Dependencies weren't installed. Run `npm run install:all`, then try again.

**`This app needs Node.js 24 or newer`**

Run `node -v`. If it's below 24, install the LTS build from
[nodejs.org](https://nodejs.org), close and reopen your terminal, and check
again.

**`npm install` fails with `node-gyp`, `Could not find any Python installation`, `MSBuild`, or `Visual Studio` errors**

This shouldn't happen any more — nothing in the project compiles native code.
If you see it, you're on an old checkout that still used `better-sqlite3`. Run
`git pull`, delete the `node_modules` folders, and run `npm install` again.
Don't install Python or a compiler.

**PowerShell: `running scripts is disabled on this system`**

```
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```

Answer `Y`, then retry.

**Phone can't load the Network URL**

Check the phone is on WiFi rather than cellular, that you allowed the Windows
firewall prompt, and that you're not on a guest network.

**Port already in use**

Something else is on port 5000 or 5173. Stop it, or set a different API port
with `PORT=5001 npm start`.

## Tech stack

React + Vite, Express, Recharts, and Node's built-in `node:sqlite` for storage
(chosen over `better-sqlite3` so there is no native compilation step, which was
a recurring setup failure on Windows).

```
client/   React frontend — components, charts, API wrappers
server/   Express API — routes, services, SQLite schema and seed
```

Balances are never stored; they're computed by summing entries up to the
selected month. A person's primary balance is always
`salary − transfer_to_savings − transfer_to_expense`, so the displayed remainder
can't drift out of sync with the numbers it comes from.
