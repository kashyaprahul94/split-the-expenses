# Split the Expenses — Working Notes

## What this is

A web app for splitting shared costs with a group — a trip, a flat, a dinner
series. Someone creates a group, others join by link or QR, anyone can add an
expense and say how it splits, and the app tracks who owes whom.

A Splitwise alternative for a friend group, with **no accounts and no logins**.
Identity is a name you type once, stored on your device.

## Current state

**Nothing is built.** This file is the plan. `README.md` and an initial commit
are all that exist.

## The one thing missing from the original brief

An expense needs a **payer** — the person who actually put money down. The brief
lists amount, title, description, date, split and currency, but without a payer
there is no debt to track: the split says who *consumed* the expense, and the
payer says who *funded* it. A debt is the gap between the two.

So every expense has `paid_by`. The UI must default it to the current member
(the common case is "I paid for this") but let it be changed, because people
routinely enter an expense on someone else's behalf.

Multiple payers on one expense (two people splitting a bill at the counter) is
real but rare. **Deferred** — model it as two expenses until someone asks.

## Money: integers only, always

Every amount is stored as an **integer in the currency's minor unit** —
`amount_minor`, paise for INR. There is no floating-point money anywhere in this
codebase, not in the database, not in TypeScript, not in transit.

This is not fussiness. `0.1 + 0.2 !== 0.3` in IEEE 754, and an expense app that
drifts by fractions of a paisa across fifty expenses produces balances that
don't zero out, which destroys the only thing the app is for. Format to decimal
at the very edge, for display only.

## Splitting, and the remainder problem

Three split modes:

| Mode | Input | Notes |
|---|---|---|
| `equal` | which members are in | The default |
| `exact` | an amount per member | Must sum to the total, to the paisa |
| `percent` | a percentage per member | Derived to exact amounts on save |

**₹100 split equally three ways is 3333 / 3333 / 3334 paise, not 33.33 each.**
The remainder has to land on somebody, deterministically, and the app must not
silently lose or invent a paisa.

Rule: distribute the base amount to everyone, then hand the remaining `n` paise
one each to the first `n` members in a stable order. The order is seeded from
the expense id, so across many expenses the extra paise spread out rather than
always landing on whoever sorts first alphabetically.

For `exact`, the sum must equal the total exactly. Off-by-one-paisa is
frustrating to fix by hand, so the UI needs an explicit affordance — show the
running difference, and a one-tap "put the remaining ₹0.01 on me".

**Invariant to test, not assume:** for any expense, the split shares sum exactly
to `amount_minor`. This should be a property test over random amounts and member
counts, because it is the single assertion that keeps the whole ledger honest.

## Balances are derived, never stored

Balances are computed from expenses and settlements on read. There is no
`balance` column.

A stored balance is a cache, and a cache that can disagree with its source
eventually does — one failed update mid-edit and the group is looking at numbers
that don't reconcile with the expense list, with no way to tell which is wrong.
The dataset here is tiny (a heavy group might reach a few hundred expenses), so
recomputing is free.

Net balance for a member: `sum(what they paid) - sum(what they owe)`. Positive
means the group owes them.

## Payment simplification

Off by default, a per-group toggle.

**Off** — debts are shown as they arose. If Priya paid for dinner, everyone who
ate owes Priya. Direct, traceable, matches what people remember happening.

**On** — the app nets everyone out and proposes the smallest set of transfers
that settles the group. Classic case: A owes B ₹500, B owes C ₹500, so A pays C
₹500 directly and B is done.

Algorithm: net every member to a single number, then greedily match the largest
creditor against the largest debtor, settling `min(|debt|, credit)` each time
and repeating. Terminates in at most `n - 1` transfers.

Two things to be honest about in the UI:

- **It never changes what anyone is owed in net**, only who they hand it to.
  That needs saying on screen, because seeing "you owe Sam ₹500" when you never
  transacted with Sam reads as a bug.
- Greedy is near-optimal, not provably minimal (minimising transfer count in
  general is NP-hard). Nobody at a dinner table will notice the difference, but
  don't document it as "minimal".

This is why it defaults to **off**: the direct view is what people can verify
against their own memory, and trust matters more than tidiness.

## Currency — decided: one per group

**Decision (2026-09-07): option (1) below.** A group has a single `currency`,
`INR` by default, chosen at creation and changeable only while the group has no
expenses. Every expense in the group uses it. A trip abroad means a second
group. No exchange rates anywhere in the codebase.

Because the group owns the currency, `expenses` carries **no** `currency`
column — a per-expense copy is a cache of the group's value and could disagree
with it. Read it from the group.

The reasoning, kept for when this bites:

Netting across currencies requires exchange rates, and rates have a date, a
source, and a spread. Three options, in order of how much I'd recommend them:

1. **One currency per group**, chosen at creation. Every expense uses it. Simple,
   honest, and correct. A trip abroad means a second group.
2. **Per-expense currency, with the rate frozen at entry.** Store both the
   original amount and its converted value. Correct, but needs a rate source and
   a UI for "what rate?" that nobody wants to fill in.
3. **Per-currency balances, never netted.** "You owe Sam ₹500 and $12." Honest,
   but settling gets awkward.

(2) and (3) stay available if a real mixed-currency group turns up, but neither
is built.

## Editing, deleting, and the audit trail

Expenses get typos, wrong amounts, wrong payers. They must be editable and
deletable — unlike a game round, this data is meant to last.

But there are no logins, and anyone with the link can edit anything. So:

- **Soft delete.** `deleted_at`, excluded from balances, recoverable.
- **An activity log.** Every create, edit, delete and settlement records what
  changed and which member did it. Not for security — it can't be, there is no
  auth — but so a group can answer "why did this number change?" without
  guessing. At this scale the log is cheap and it is the difference between a
  disagreement being resolvable and not.

## Members, and joining an existing group

Two ways someone becomes a member, and they have to reconcile:

1. **Added by someone else.** One person sets up the group and types in five
   names. Those members exist with no device attached.
2. **Joins via link or QR.** They arrive and need to say who they are.

A joiner must be able to **claim an existing member** rather than create a
duplicate — otherwise the group ends up with "Sam" (who has all the expenses)
and "Sam (2)" (who has the phone). The join screen shows unclaimed members to
pick from, plus "I'm someone else".

Claiming writes a `device_key` (client-generated, localStorage) onto the member
row. That key is how the app knows which member "you" are on later visits.

A member with expenses attached **cannot be deleted**, only renamed — deleting
them would orphan splits and break every balance. Offer rename, and explain why.

## Data model (draft)

```
groups
  id, slug unique, name, currency, simplify_payments bool default false,
  created_at

members
  id, group_id → groups on delete cascade, name,
  device_key nullable,        -- set when a device claims this member
  created_at,
  unique (group_id, name)     -- names are the identity here; keep them unique

expenses
  id, group_id → groups on delete cascade,
  title, description nullable, amount_minor bigint,
  category nullable,          -- free text, from a suggested list; no lookup table
  paid_by → members, spent_on date, split_mode ('equal'|'exact'|'percent'),
  created_at, updated_at, deleted_at nullable
                              -- no currency column: the group owns it

expense_shares
  id, expense_id → expenses on delete cascade, member_id → members,
  share_minor bigint          -- what this member owes for this expense
  unique (expense_id, member_id)

settlements                   -- "I paid these people back"
  id, group_id → groups on delete cascade,
  from_member → members, to_member → members,
  amount_minor bigint, settled_on date, note nullable,
  created_at, deleted_at nullable

activity
  id, group_id → groups on delete cascade, actor_member → members nullable,
  kind, subject_id, summary, created_at
```

A payment to several people at once is recorded as several `settlements` rows
sharing a timestamp — one row per payee keeps the balance maths uniform.

**Categories** are a nullable free-text column, not a table. The form offers a
short suggested list (food, travel, stay, groceries, other) and accepts anything
typed. They exist for the report breakdown only — they never touch balances, so
a wrong or missing category can't corrupt anything.

## Reports

**The expense table**: one row per expense, one column per member, cells showing
debit and credit. This is the view that makes the group trust the app, so it
gets real care:

- The member axis can reach 20 columns. Horizontal scroll in its own container,
  with the expense title as a sticky first column.
- Right-align amounts and use `font-variant-numeric: tabular-nums`, or columns
  of digits won't line up and the table becomes unreadable.
- Column totals per member, and a grand total that must equal the sum of
  expenses — a visible reconciliation check.
- **CSV export.** Cheap to build, and the first thing anyone asks for when they
  want to check the app's arithmetic against their own.

Plus: total spent, per-head average, each member's net position, and — when
simplification is on — the proposed transfer list.

## Stack

Same as the `find-the-imposter` project next door, for the obvious reason that
it is known to work on free tiers:

- **Next.js 15 (App Router)** + React 19, TypeScript 5.x, Tailwind v4, Vercel.
- **Supabase Postgres** for storage, reached **only from the server**.
- `nanoid` for ids and slugs, `qrcode.react` for the join QR.

### Where this differs from find-the-imposter, architecturally

That app is a live game: state is ephemeral, broadcast is the source of truth,
and the database holds a disposable history. **This is the opposite.** The
ledger is the point, it must survive months, and it must be consistent. So:

- **The database is the source of truth.** Every read comes from it.
- **Realtime is a nicety, not the mechanism.** Two people rarely add expenses in
  the same second. Refetch on focus and after any write; consider Supabase
  realtime later, but don't build the app around it.
- **The browser never touches Supabase.** This is the sharpest break from the
  sibling, which hands the publishable key to the client and relies on
  permissive policies. That works there because a room code and two revealed
  words are not secrets and the data is disposable. Here the ledger holds
  names and amounts and lasts months.

  A publishable key ships in the JS bundle, so it is public. Permissive
  policies plus a public key means anyone can enumerate and read *every*
  group — at which point "the link is the password" is simply false. So:

  - **RLS on every table with no policies at all.** `anon` and
    `authenticated` can read nothing and write nothing.
  - **All access goes through the Next.js server**, which holds
    `SUPABASE_SECRET_KEY` and connects as `service_role`. `src/lib/supabase.ts`
    imports `server-only`, so pulling it into a client component fails the
    build rather than leaking the key.
  - The slug from the URL is checked by our own server code before any query.

  Consequence: **no Supabase realtime**, since that needs a browser key. The
  plan already called realtime a nicety rather than the mechanism, so this
  costs nothing — refetch on focus and after writes.

- **Writes that span rows go through SQL functions**, not multiple REST calls.
  An expense and its shares are one transaction (`save_expense`), because two
  HTTP calls are two transactions and a half-written expense is a corrupt
  ledger. Same for multi-payee settlements (`save_settlements`) and for soft
  deletes, which write their activity row in the same transaction.

- **The share-sum invariant is enforced by the database too**, as a deferred
  constraint trigger, not only by `src/lib/split.ts`.

## Locked decisions

- **No logins.** A name per group, a device key in localStorage. Anyone with the
  link can read and edit — the same trust model as a shared spreadsheet, which
  is what this replaces.
- **Integer minor units everywhere.** No floats.
- **Balances derived, never stored.**
- **Splits must sum to the total exactly**, enforced in code and property-tested.
- **Simplification off by default**, and never silently changes net balances.
- **A member with expenses can be renamed, never deleted.**
- **Soft delete plus an activity log**, because many people can edit with no auth.
- **Group-level currency**, `INR` default, locked once the group has an expense.
  No per-expense currency, no exchange rates.
- **Settlements are recorded**, in the `settlements` table. A transfer proposed
  by simplification is recordable in one tap — the proposal writes a real row.
- **No group PIN.** The link is the password, matching the shared-spreadsheet
  trust model. Additive later if it's ever needed.
- **Categories on expenses**: nullable free text, report-only.
- **No recurring expenses.** Deferred — it changes the data model, so if the
  flatmate case turns up it gets designed then, not bolted on now.

## Traps carried over from the sibling project

These cost time there and will again:

- **TypeScript must stay on 5.x.** `npm i -D typescript` resolves TS 7, and Next
  15.5's config loader dies with
  `Cannot read properties of undefined (reading 'fileExists')`.
- **Never run two Next processes against the same `.next`.** A `next build`
  while `next dev` is running serves the browser chunks from another
  compilation, and the symptoms are baffling. There is one build directory, so
  stop the dev server before building, or check against the running one.
- **Heredocs break under this shell wrapper.** Write scripts with the file tools,
  not `cat <<EOF`.
- **BSD `sed` has no `\b`.** Use `perl -pi -e` for word-boundary rewrites.
- **RLS denies reads by returning zero rows, not an error.** To prove a table is
  protected, count rows with a privileged key and compare.
- **Inputs must be ≥16px** or iOS Safari zooms the page on focus.
- **`.env.example` is committed; `.env.local` is gitignored.** Real values only
  in the latter. Note the default `.gitignore` line `.env*` swallows
  `.env.example` too, so it needs an explicit `!.env.example`.

## Traps found in this project

- **`create-next-app@latest` now scaffolds Next 16.** Several things it emits
  are invalid on 15: `LayoutProps<"/">` as a global, `eslint-config-next`
  subpath exports (15 needs the `FlatCompat` form), and a
  `.next/dev/types` tsconfig include. Pin `typescript` to `~5.9`, not `^5`.
- **A `CASE` expression in plpgsql resolves *both* arms against the row type.**
  A trigger shared between two tables must use separate `IF` branches, or
  `new.expense_id` fails when it fired on `expenses`. Cost one round trip.
- **`create table if not exists` does nothing to an existing table**, so a
  constraint expected to grow (the activity `kind` list) must be re-applied
  with `alter table ... drop constraint if exists` / `add constraint` for a
  re-run of `schema.sql` to converge.
- **Foreign keys to `members` are `deferrable initially deferred`.** Deleting
  a group cascades to members and expenses in one statement with no ordering
  guarantee, so an immediately-checked reference fails halfway through.
  Deferred, deleting a member who has paid for something still fails, which is
  the rule we want.
- **Next's dev overlay serialises `cookies()` results into the RSC payload.**
  So in `npm run dev` the httpOnly device cookie appears in the page source.
  It is only ever the reader's own key, never another member's, and production
  does not do it — but check leaks against a production build, not dev.

## Questions resolved (2026-09-07) — nothing blocking the build

1. **Currency policy** → one currency per group, `INR` default. See above.
2. **Settling** → recorded, and simplification's proposed transfers are
   one-tap recordable.
3. **Group protection** → none. The link is the password.
4. **Categories** → yes, nullable free text, report-only.
5. **Recurring expenses** → no. Deferred rather than retrofitted.

## Layout (planned)

```
src/lib/          money (integer maths + formatting), split (share calculation),
                  balances (net positions), simplify (transfer routing),
                  groups/expenses/settlements (Supabase queries),
                  session, types, slug, constants, supabase
src/hooks/        useGroup, useExpenses, useBalances
src/components/   group setup, member list, expense form + list,
                  settle-up flow, balance summary, report table, share panel
src/app/          / (create or join), /g/[slug] (group), /g/[slug]/report
supabase/         schema.sql
```

`src/lib/split.ts` and `src/lib/simplify.ts` are pure, have no Supabase
dependency, and are where the correctness lives — they get tests before anything
else does.

## Commands (once scaffolded)

```bash
npm run dev
npm run dev -- -H 0.0.0.0                 # real phones over LAN
npm run typecheck
npm test                                  # pure libs, incl. property tests

npm run db:smoke      # what only a real database can prove: the constraints
npm run verify:rls    # that anon can read and write nothing
npm run smoke:http    # that the pages render it (needs a server running)
```

`smoke:http` takes `SMOKE_BASE` to point at a production server instead of
dev — worth doing, because dev and production genuinely differ (see below).

## Identity is a cookie, not localStorage

The plan said `device_key` in localStorage. Once every page became
server-rendered that stopped working: the server has to know who you are
*while* it renders, and it cannot read localStorage. So middleware issues an
**httpOnly `ste_device` cookie**, and `src/lib/device.ts` is the only place
identity comes from.

Two consequences worth keeping:

- **Server actions never take a device key or an actor id as a parameter.**
  They read the cookie. If the client could name the actor, anyone could pin
  their edits on someone else and the activity log would be worse than
  useless.
- **`getGroupBundle` strips `device_key` from every member** and exposes only
  `claimed: boolean`. A device key is a capability — whoever holds it *is*
  that member — so shipping raw member rows would hand everyone in a group the
  means to impersonate everyone else. `smoke:http` asserts this directly.

localStorage still holds the recently-opened list, which is a shortcut and
nothing more.
