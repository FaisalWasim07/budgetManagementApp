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

- Households: each is a separate budget with its own people, accounts and
  history. You can have several, and be invited into other people's
- Money is never stored as a balance; every total is derived from the entries
  behind it, so nothing can silently drift out of sync

## Prerequisites

You need **Node.js** and **Git**. Check whether you already have them:

```
node -v
git --version
```

If either is missing:

- **Node.js 20 or newer** — install the **LTS** build from
  [nodejs.org](https://nodejs.org). Nothing here compiles native code, so you do
  **not** need Python, Visual Studio, or any build tools.
- **Git** — [git-scm.com](https://git-scm.com/downloads).

Reopen your terminal after installing, then re-run the checks above.

You also need a **PostgreSQL database**. The free tier of
[Supabase](https://supabase.com) is enough; so is a local Postgres if you
prefer. See [Database](#database) below.

## Setup

Run these once:

```
git clone https://github.com/FaisalWasim07/budgetManagementApp.git
cd budgetManagementApp
npm install
```

`npm install` installs the frontend and backend dependencies too, via a
`postinstall` hook — you don't need a second install command.

Then create a `.env` file in the project root, copying `.env.example`:

```
DATABASE_URL=postgresql://user:password@host:5432/database
```

and prepare the database:

```
npm run db:init
```

That creates the tables and seeds two people ("Husband" and "Wife", both
renamable in the app) with two default accounts each. It's safe to run again —
it won't overwrite anything that's already there.

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

## Households

A **household** is one budget: its own people, accounts, transactions,
subscriptions and currency settings. Nothing is shared between households, and
which one you are looking at is always shown in the top bar.

You can belong to several — your own, and any you have been invited into — and
switch between them from that menu.

### Who can do what

| Role | Can |
| --- | --- |
| Owner | Everything, including inviting people, changing roles and deleting the household |
| Can edit | Record and change money |
| View only | See everything, change nothing |

A household always keeps at least one owner: the last one cannot demote or
remove themselves.

### Adding someone

From the household menu → **People & sharing**, two ways, for two situations:

- **Add someone directly** — you set up their username and password for them.
  They are added to the household *and* created as a person with their own main
  account, so their money has somewhere to go the moment they sign in. This is
  the husband-and-wife case.
- **Invite with a code** — a one-time code you send however you like. They sign
  up themselves, paste it in, and land in the household with the role you chose.
  Codes expire after 14 days and can be revoked.

Note the difference between **people** and **members**. A person is whose money
an account holds; a member is someone who can open the app. They usually line up
but the app never assumes it — a household can track a child's savings without
that child having a login.

### Giving the app to someone else

Anyone with an account on the same deployment can create their own household,
and it is completely separate from yours. If you'd rather they were fully
independent, they can deploy their own copy — the database would then be theirs
too.

**Registration is open by default**, so anyone who finds the address can create
an account. Set `SIGNUP_CODE` to a secret of your choosing and only people you
give it to can sign up. Existing accounts are unaffected.

## Signing in

The first time you open the app it asks you to choose a username and password,
then to create your first household. The password is stored (hashed with scrypt)
in your own database.

- **Settings → Change my password** replaces yours and signs every device out,
  so a password change actually locks out anything you've forgotten about.
- Staying signed in lasts 30 days per device.
- Ten wrong passwords in a row locks further attempts from that device for 15
  minutes.

Every API route except signing in requires a session, and every one that touches
a budget is scoped to a household you are confirmed to belong to. Both checks are
declared once, centrally, so a route added later cannot forget either.

**There is no password reset** — nothing knows your email address, so there is
nowhere to send one. If you lock yourself out completely, clear the logins
directly and the app will offer first-run setup again next time you open it:

```
node -e "require('./server/src/db/pool').exec('DELETE FROM sessions; DELETE FROM users')"
```

Your budget data is untouched by that; only the logins are.

## Database

The app keeps everything in PostgreSQL, pointed at by one environment variable:

```
DATABASE_URL=postgresql://user:password@host:5432/database
```

With [Supabase](https://supabase.com), take the connection string from
Project Settings → Database. Which one depends on where the app is running:

| Connection | Port | Use it for |
| --- | --- | --- |
| Transaction pooler | 6543 | the deployed app — serverless opens a connection per request and would exhaust a direct limit |
| Direct connection | 5432 | migrations and one-off scripts run from your own machine |

Replace the `[YOUR-PASSWORD]` placeholder with the database password.

### Passwords with punctuation in them

A password inside a URL is percent-decoded on the way out, so `@ : / # ?` have
to be encoded — and a literal **`%`** is worse: it's read as the start of an
escape, and the database silently receives a different password from the one
you were given. `28P01` with everything apparently correct is usually this.

Keep the password out of the URL instead, and it's used exactly as written:

```
DATABASE_URL=postgresql://postgres.abcdefgh@aws-0-eu-central-1.pooler.supabase.com:6543/postgres
DATABASE_PASSWORD=whatever it is, verbatim
```

Note the string has no `:password` in it at all. Both go in `.env` locally and
as environment variables on a host. `npm run db:test` detects this case and says
so rather than leaving you to guess.

`.env` is gitignored and must stay that way — it is the one file in the project
that holds a credential.

### TLS

Supabase's poolers present a certificate signed by their own authority rather
than a publicly trusted one, so verifying against the usual root certificates
fails with `SELF_SIGNED_CERT_IN_CHAIN`. Pick one of two answers — neither is the
default, because quietly skipping verification is how an encrypted connection
becomes an interceptable one:

| Setting | Effect |
| --- | --- |
| `DATABASE_CA_CERT` | Encrypted **and** verified. Download the certificate from Supabase under Settings → Database → SSL Configuration and paste its contents in. |
| `DATABASE_SSL_NO_VERIFY=true` | Encrypted, server not verified. Simpler, and what most deployments settle for. |

Both are set the same way locally (in `.env`) and on a host (as an environment
variable). Newlines in the certificate may be written either literally or as
`\n`. Local connections don't use TLS at all and need neither.

### Use a separate database for development

`npm run dev` talks to whatever `DATABASE_URL` names. If that's the same
database the deployed app uses, then testing locally edits your real budget.
Point your local `.env` at a second database — a second free Supabase project
does fine — and keep the live one only in the host's environment variables.

### Coming from the SQLite version

Earlier versions kept everything in `server/src/data/budget.sqlite3` on one
machine. To carry that data across:

```
npm run migrate:sqlite
```

or, if the file is somewhere else:

```
npm run migrate:sqlite -- "D:\path\to\budget.sqlite3"
```

It copies people, accounts, transactions, subscriptions, settings and cached
rates, keeping every id so the links between them survive.

Because ids are preserved, the target has to be empty — and a database that has
been started up once is not, since it seeds itself with two people and their
default accounts. To clear those and import over the top:

```
npm run migrate:sqlite -- --replace
```

That deletes the existing budget, so it refuses to happen by accident: without
the flag the script stops and tells you what is in the way. Logins are left
alone by both paths, and aren't copied either — password hashes stay with the
machine that made them, so the app will ask you to create one.

The whole import runs in a single transaction. If anything fails, nothing is
written.

Nothing about your figures is ever committed to Git: the database is remote, and
`.env`, which is the only thing that can reach it, is ignored. To confirm:

```
git ls-files | grep -E "\.env$|sqlite"    # should print nothing
```

## Exchange rates

Rates are tried against several free, no-key providers in turn, and the first
one that answers wins:

1. **open.er-api.com** — 160+ currencies
2. **currency-api** — static JSON on a CDN, 200+ currencies, with its own mirror
3. **Frankfurter** — European Central Bank rates

Frankfurter is last deliberately. It was the original and only source, and it
publishes ECB reference rates, which cover about 30 major currencies —
**neither AED nor PKR among them**. It could never price the pair this app was
built around, which is why live rates appeared broken regardless of the network.
It stays in the list because it is a good source for the majors it does cover.

Each currency pair is fetched at most once per day and cached; **Refresh now** in
Settings forces an update, and **Test connection** reports what each provider
returned, so a missing rate can be traced rather than guessed at.

If the API can't be reached, the app falls back to the last cached rate (shown as
"cached"). With no cached rate at all, those accounts are listed as unconverted
and left out of the household totals rather than silently counted as zero — a
banner on the dashboard says which currencies are affected.

Each provider gets **2.5 seconds** and a failure is remembered for a minute, so
unreachable services slow a page load slightly instead of hanging it. If a
currency matters to you, set a **fallback rate** for it in Settings — that value
is used whenever no live rate can be had, so your totals still add up.

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

**`DATABASE_URL is not set`**

There's no `.env` file, or it doesn't have the line in it. Copy `.env.example`
to `.env` in the project root and put your connection string in it.

**`password authentication failed` or `getaddrinfo ENOTFOUND`**

The connection string is wrong. The most common cause by far is leaving the
`[YOUR-PASSWORD]` placeholder in it, or a password containing characters that
need URL-encoding — see [Database](#database).

**`SELF_SIGNED_CERT_IN_CHAIN` / `UNABLE_TO_VERIFY_LEAF_SIGNATURE`**

The database's certificate can't be verified against the usual roots, which is
normal for Supabase. See [TLS](#tls) — set either `DATABASE_CA_CERT` or
`DATABASE_SSL_NO_VERIFY=true`.

**A 500 with a code in brackets**

Errors show a short code so you don't have to read the host's logs to find out
what broke:

| Code | Meaning |
| --- | --- |
| `ENOTFOUND` / `ECONNREFUSED` | wrong host in `DATABASE_URL`, or the database is unreachable |
| `28P01` | password rejected. Through a Supabase pooler the username must be `postgres.<project-ref>`, not plain `postgres` — mixing a direct-connection username with a pooler host fails exactly like a wrong password |
| `PLACEHOLDER_PASSWORD` | `[YOUR-PASSWORD]` is still in the connection string |
| `NO_DATABASE_URL` | the variable isn't set at all |
| `3D000` | that database name doesn't exist |
| `42P01` | a table is missing; run `npm run db:init` |
| `SELF_SIGNED_CERT_IN_CHAIN` | see [TLS](#tls) |

`GET /api/health` reports the same codes and needs no login, so it's the
quickest way to tell "the app isn't running" from "the app can't reach the
database".

To check a connection string without deploying anything:

```
npm run db:test                        # uses DATABASE_URL from .env
npm run db:test -- "postgresql://..."  # tries the one you pass
```

It reports which `.env` files were found and what came out of them, connects
once, and prints what the driver said with a note on what the common failures
actually mean. The password is never printed.

The `.env` goes in the repository root, next to `package.json`. On Windows two
things routinely go wrong with it, and both leave a file that looks perfectly
correct in Explorer:

- **Notepad appends `.txt`.** With known extensions hidden, `.env.txt` is
  indistinguishable from `.env`. `Get-ChildItem -Force .env*` shows the truth.
- **PowerShell's `>` and `Out-File` write UTF-16.** The file contains exactly
  the right text and yields nothing. This one is handled — UTF-16 and a UTF-8
  BOM are both decoded — but older checkouts will simply see no settings.

That matters most for `28P01`, which Supabase's pooler returns both for a
genuinely wrong password (*"password authentication failed"*) and for
**"Tenant or user not found"** — which is not about the password at all. That
one means the pooler couldn't match the project: usually the region in the host
is wrong, the project reference after `postgres.` belongs to another project, or
the project is paused.

To see which connection the deployed app is using, set `DEBUG_CONNECTION=true`
and call `/api/health` again — it then also returns the username, host, port and
database name, the driver's own error message, and the password's length and
whether it picked up stray quotes or whitespace. The password itself is never
included.
The same detail always goes to the logs, so the variable is only needed when
reading logs is inconvenient. **Turn it off once you're done** — the endpoint is
public, and the username and host are infrastructure detail.

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

## Deploying

The repository is set up for Vercel with a Supabase database, and needs no
manual configuration in the dashboard beyond three environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | the Supabase **transaction pooler** string, port 6543 |
| `COOKIE_SECURE` | `true` — the session cookie then only travels over HTTPS |
| `TRUST_PROXY` | `true` — so the login rate limit sees the real client address |

`vercel.json` supplies the rest: the build produces `client/dist`, which is
served as static files, and everything under `/api/` goes to a single serverless
function that runs the Express app (`api/[[...path]].js`). One function rather
than one per endpoint, so a request doesn't pay for its own cold start and its
own connection pool.

The schema is applied on boot, guarded by an advisory lock so simultaneous cold
starts can't collide, which means a release that adds a table needs no separate
migration step. Changing an *existing* table still does.

To deploy: push. Vercel builds the branch, publishes it if the build succeeds,
and leaves the previous version up if it doesn't. Any branch other than the
production one gets its own preview URL instead.

## Tech stack

React + Vite, Express, Recharts, and PostgreSQL via `pg`.

```
api/      Vercel entry point — hands requests to the Express app
client/   React frontend — components, charts, API wrappers
server/   Express API — routes, services, schema, seed and migrations
```

The SQL is written with `?` placeholders and rewritten to `$1`-style in
`server/src/db/pool.js`. Balances are never stored: every total is derived from
the ledger, and the whole ledger is read in two pre-aggregated queries so the
number of round trips doesn't grow with the number of accounts or months shown.

Balances are never stored. An account's balance is computed as its opening
balance, plus income and incoming transfers, minus spending, outgoing transfers
and any subscriptions charged to it, over every month up to the one selected. So
a figure on screen can't drift away from the entries behind it — correcting an
entry corrects every total that depends on it.
