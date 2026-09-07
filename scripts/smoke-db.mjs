// Exercises the guarantees supabase/schema.sql claims to make.
//
//   npm run db:smoke
//
// This is not a unit test of the split maths — src/lib has property tests for
// that. It checks the things only a real database can prove: that the deferred
// reconcile trigger rejects an unbalanced expense, that the currency lock
// holds, that cross-group references are impossible, that a member who has
// paid for something cannot be deleted, and that a group still deletes cleanly
// despite all of those constraints.
//
// It creates two throwaway groups and deletes them again, including on
// failure. Safe to run against the real project.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, secretKey, { auth: { persistSession: false } });

const id = (prefix) => `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const today = new Date().toISOString().slice(0, 10);

let passed = 0;
let failed = 0;
const createdGroups = [];

function pass(what) {
  passed += 1;
  console.log(`✓ ${what}`);
}

function fail(what, detail) {
  failed += 1;
  console.log(`✗ ${what}\n    ${detail}`);
}

/** Asserts the call succeeded. */
async function must(what, promise) {
  const { data, error } = await promise;
  if (error) {
    fail(what, error.message);
    return null;
  }
  pass(what);
  return data;
}

/** Asserts the database refused. A silent success here is the real failure —
 * it means a constraint we are relying on does not exist. */
async function mustReject(what, promise, expected) {
  const { error } = await promise;
  if (!error) {
    fail(what, "the database ALLOWED it");
    return;
  }
  if (expected && !error.message.toLowerCase().includes(expected.toLowerCase())) {
    fail(what, `rejected, but for the wrong reason: ${error.message}`);
    return;
  }
  pass(`${what} — rejected: ${error.message.split("\n")[0].slice(0, 80)}`);
}

async function makeGroup(name, currency = "INR") {
  const groupId = id("g");
  const slug = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
  const { error } = await db
    .from("groups")
    .insert({ id: groupId, slug, name, currency });
  if (error) throw new Error(`could not create group: ${error.message}`);
  createdGroups.push(groupId);
  return { groupId, slug };
}

async function makeMember(groupId, name) {
  const memberId = id("m");
  const { error } = await db
    .from("members")
    .insert({ id: memberId, group_id: groupId, name });
  if (error) throw new Error(`could not create member: ${error.message}`);
  return memberId;
}

async function run() {
  // ---------------------------------------------------------------- setup ---
  const { groupId, slug } = await makeGroup("Smoke trip");
  const [priya, sam, alex] = [
    await makeMember(groupId, "Priya"),
    await makeMember(groupId, "Sam"),
    await makeMember(groupId, "Alex"),
  ];
  pass("created a group with three members");

  // ------------------------------------------------- the happy path first ---
  const expenseId = id("e");
  // ₹100 split three ways: 3333 / 3333 / 3334. The odd paisa must land.
  await must(
    "save_expense wrote an expense, its shares and its activity row",
    db.rpc("save_expense", {
      p_id: expenseId,
      p_group_id: groupId,
      p_title: "Dinner",
      p_description: null,
      p_amount_minor: 10000,
      p_category: "food",
      p_paid_by: priya,
      p_spent_on: today,
      p_split_mode: "equal",
      p_shares: [
        { member_id: priya, share_minor: 3333 },
        { member_id: sam, share_minor: 3333 },
        { member_id: alex, share_minor: 3334 },
      ],
      p_actor_member: priya,
    }),
  );

  const bundle = await must("group_bundle returned the group", db.rpc("group_bundle", { p_slug: slug }));

  if (bundle) {
    const shareTotal = bundle.shares.reduce((sum, s) => sum + Number(s.share_minor), 0);
    if (shareTotal === 10000) pass("bundle shares reconcile with the expense");
    else fail("bundle shares reconcile with the expense", `shares total ${shareTotal}, expected 10000`);

    if (bundle.group.currency === "INR") pass("bundle carries the group currency");
    else fail("bundle carries the group currency", `got ${bundle.group.currency}`);

    if (bundle.members.length === 3) pass("bundle carries all three members");
    else fail("bundle carries all three members", `got ${bundle.members.length}`);

    // The expense carries no currency of its own — the group owns it.
    if (bundle.expenses.length === 0) {
      fail("expenses carry no currency column", "no expense was written to inspect");
    } else if (!("currency" in bundle.expenses[0])) {
      pass("expenses carry no currency column");
    } else {
      fail("expenses carry no currency column", "an expense currency column exists");
    }
  }

  const activity = await must(
    "group_activity returned the log",
    db.rpc("group_activity", { p_group_id: groupId, p_limit: 10 }),
  );
  if (activity && activity.some((row) => row.kind === "expense_added")) {
    pass("adding an expense logged expense_added");
  } else if (activity) {
    fail("adding an expense logged expense_added", `kinds: ${activity.map((r) => r.kind).join(", ")}`);
  }

  // ------------------------------------------- now the things that matter ---
  // THE invariant. If this is allowed, every balance in the app is wrong.
  await mustReject(
    "an expense whose shares do not sum to the total",
    db.rpc("save_expense", {
      p_id: id("e"),
      p_group_id: groupId,
      p_title: "Bad split",
      p_description: null,
      p_amount_minor: 10000,
      p_category: null,
      p_paid_by: priya,
      p_spent_on: today,
      p_split_mode: "equal",
      p_shares: [
        { member_id: priya, share_minor: 3333 },
        { member_id: sam, share_minor: 3333 },
        { member_id: alex, share_minor: 3333 },
      ],
      p_actor_member: priya,
    }),
  );

  // Writing shares directly, bypassing save_expense, must still be caught —
  // this is the deferred constraint trigger rather than the RPC's own check.
  await mustReject(
    "deleting a share directly, leaving the expense unbalanced",
    db.from("expense_shares").delete().eq("expense_id", expenseId).eq("member_id", sam),
  );

  await mustReject(
    "changing the currency of a group that already has expenses",
    db.from("groups").update({ currency: "USD" }).eq("id", groupId),
    "currency",
  );

  await mustReject(
    "deleting a member who has paid for something",
    db.from("members").delete().eq("id", priya),
  );

  // Cross-group contamination: the composite foreign keys should make a share
  // pointing at another group's member impossible.
  const other = await makeGroup("Other group");
  const outsider = await makeMember(other.groupId, "Outsider");

  await mustReject(
    "a share pointing at a member of another group",
    db.from("expense_shares").insert({
      id: id("s"),
      group_id: groupId,
      expense_id: expenseId,
      member_id: outsider,
      share_minor: 0,
    }),
  );

  await mustReject(
    "an expense paid by a member of another group",
    db.rpc("save_expense", {
      p_id: id("e"),
      p_group_id: groupId,
      p_title: "Foreign payer",
      p_description: null,
      p_amount_minor: 500,
      p_category: null,
      p_paid_by: outsider,
      p_spent_on: today,
      p_split_mode: "equal",
      p_shares: [{ member_id: priya, share_minor: 500 }],
      p_actor_member: priya,
    }),
  );

  await mustReject(
    "a settlement between a member and themselves",
    db.from("settlements").insert({
      id: id("t"),
      group_id: groupId,
      from_member: sam,
      to_member: sam,
      amount_minor: 100,
      settled_on: today,
    }),
  );

  await mustReject(
    "an expense with a zero amount",
    db.from("expenses").insert({
      id: id("e"),
      group_id: groupId,
      title: "Free",
      amount_minor: 0,
      paid_by: priya,
      spent_on: today,
      split_mode: "equal",
    }),
  );

  // -------------------------------------------------------- soft deleting ---
  await must(
    "set_expense_deleted soft-deleted the expense",
    db.rpc("set_expense_deleted", {
      p_id: expenseId,
      p_deleted: true,
      p_actor_member: sam,
    }),
  );

  const afterDelete = await db.from("expenses").select("deleted_at").eq("id", expenseId).single();
  if (afterDelete.data?.deleted_at) pass("the row is still there, just flagged");
  else fail("the row is still there, just flagged", "deleted_at was not set");

  await must(
    "set_expense_deleted restored it again",
    db.rpc("set_expense_deleted", {
      p_id: expenseId,
      p_deleted: false,
      p_actor_member: sam,
    }),
  );

  // -------------------------------------------------------- settling up ----
  const settlementId = id("t");
  await must(
    "save_settlements recorded a payment",
    db.rpc("save_settlements", {
      p_group_id: groupId,
      p_rows: [
        { id: settlementId, from_member: sam, to_member: priya, amount_minor: 3333 },
      ],
      p_actor_member: sam,
      p_settled_on: today,
      p_note: "settled up",
    }),
  );

  await must(
    "save_settlement corrected the amount",
    db.rpc("save_settlement", {
      p_id: settlementId,
      p_from_member: sam,
      p_to_member: priya,
      p_amount_minor: 3000,
      p_settled_on: today,
      p_note: "actually paid a bit less",
      p_actor_member: sam,
    }),
  );

  const edited = await db
    .from("settlements")
    .select("amount_minor")
    .eq("id", settlementId)
    .single();
  if (Number(edited.data?.amount_minor) === 3000) pass("the edit stuck");
  else fail("the edit stuck", `amount is ${edited.data?.amount_minor}, expected 3000`);

  await mustReject(
    "editing a payment that does not exist",
    db.rpc("save_settlement", {
      p_id: "no-such-payment",
      p_from_member: sam,
      p_to_member: priya,
      p_amount_minor: 100,
      p_settled_on: today,
      p_note: null,
      p_actor_member: sam,
    }),
  );

  await must(
    "set_settlement_deleted soft-deleted the payment",
    db.rpc("set_settlement_deleted", {
      p_id: settlementId,
      p_deleted: true,
      p_actor_member: sam,
    }),
  );

  await must(
    "set_settlement_deleted restored it",
    db.rpc("set_settlement_deleted", {
      p_id: settlementId,
      p_deleted: false,
      p_actor_member: sam,
    }),
  );

  // The log has to say what actually happened. Restoring a payment used to be
  // recorded as a deletion, which would make the history claim the opposite.
  const log = await db.rpc("group_activity", { p_group_id: groupId, p_limit: 50 });
  const kinds = (log.data ?? []).map((row) => row.kind);
  for (const expected of [
    "settlement_added",
    "settlement_edited",
    "settlement_deleted",
    "settlement_restored",
  ]) {
    if (kinds.includes(expected)) pass(`the log recorded ${expected}`);
    else fail(`the log recorded ${expected}`, `kinds seen: ${kinds.join(", ")}`);
  }
}

try {
  await run();
} catch (problem) {
  fail("the smoke run itself", problem.message);
} finally {
  // Deleting the group cascades to everything. It is also a test in its own
  // right: the member-referencing foreign keys are deferrable precisely so
  // that this cascade does not trip over its own ordering.
  for (const groupId of createdGroups) {
    const { error } = await db.from("groups").delete().eq("id", groupId);
    if (error) fail(`cleanup: deleting group ${groupId}`, error.message);
  }
  if (createdGroups.length > 0 && failed === 0) pass("deleting a group cascades cleanly");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
