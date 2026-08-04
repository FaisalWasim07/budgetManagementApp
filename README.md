# Household Monthly Budget

A monthly budget tracker for two people sharing a household.

Each person has a **primary account** that receives their salary and transfers a
portion to a **rent/savings account** and a **monthly expense account**, keeping
whatever is left. Each person can optionally add a **multi-currency account**
(e.g. PKR) that accumulates monthly contributions and is converted into the
primary currency (AED) using a live exchange rate, so it counts toward total
household net worth.

The dashboard shows per-person accounts side by side, a combined household
summary, and charts for income vs expenses, net worth trend, account balances,
and currency composition.

- Primary currency: **AED**
- Secondary currency: **PKR** (more can be added — see [Adding another currency](#adding-another-currency))
- No login — it's a single shared app, with data tagged per person

## Prerequisites

You need **Node.js** and **Git**. Check whether you already have them:

```
node -v
git --version
```

If either is missing:

- **Node.js** — install the **LTS** version from [nodejs.org](https://nodejs.org).
  Use LTS specifically: the database library ships prebuilt binaries for LTS
  releases, so you won't need a C++ compiler. `node -v` should show an **even**
  major version (22, 24) — odd ones (23, 25) are short-lived "Current" builds
  that native libraries often skip, and `npm install` will fail on them.
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

## Exchange rates

Rates come from [Frankfurter](https://frankfurter.dev), a free API that needs no
key or account. A rate is fetched at most once per day and cached in the
database; the **Refresh rate** button in the household summary forces an update.

If the API can't be reached, the app falls back to the last cached rate (labelled
"cached") or shows "rate unavailable" — it won't break the dashboard.

Note that conversion uses the *current* rate against the whole accumulated
balance, not a historical rate per contribution. That's fine for a household
dashboard, but it means past months' converted values shift as the rate moves.

### Adding another currency

Currencies aren't hardcoded to PKR. Adding one needs no schema change — create
another `multi_currency` account with a different `currency` code, and the rate
lookup and AED conversion follow automatically.

## Troubleshooting

**`'vite' is not recognized` / `'nodemon' is not recognized`**

Dependencies weren't installed. Run `npm run install:all`, then try again.

**`npm install` fails with `node-gyp`, `Could not find any Python installation`, `MSBuild`, or `Visual Studio` errors**

Look near the top of the output for a line like:

```
prebuild-install warn install No prebuilt binaries found (target=25.9.0 ...)
```

You're on a Node version that `better-sqlite3` has no prebuilt binary for, so it
fell back to compiling from source — which needs Python and C++ build tools.

**Don't install Python or a compiler.** Install an **LTS** version of Node
instead. Run `node -v`: the major version should be an **even** number (22, 24).
Odd-numbered releases (23, 25) are short-lived "Current" builds that native
libraries frequently skip.

Fix: install the LTS build from [nodejs.org](https://nodejs.org), then delete the
`node_modules` folders and run `npm install` again.

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

React + Vite, Express, SQLite (`better-sqlite3`), Recharts.

```
client/   React frontend — components, charts, API wrappers
server/   Express API — routes, services, SQLite schema and seed
```

Balances are never stored; they're computed by summing entries up to the
selected month. A person's primary balance is always
`salary − transfer_to_savings − transfer_to_expense`, so the displayed remainder
can't drift out of sync with the numbers it comes from.
