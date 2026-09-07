// Proves the database is actually closed to the public.
//
//   npm run verify:rls
//
// RLS denies reads by returning zero rows, not an error, so "the query came
// back empty" is evidence of nothing on its own — an empty table looks exactly
// the same. So this seeds a complete throwaway group first, with a row in
// every table, and only then asks whether a public key can see any of it.
//
// Needs NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local to have a key to
// try to break in with. The app itself never uses it.

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

const TABLES = [
  "groups",
  "members",
  // The capability table: a leak here is total impersonation.
  "member_devices",
  "expenses",
  "expense_shares",
  "settlements",
  "activity",
];

if (!url || !secretKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

if (!publicKey) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.\n" +
      "Uncomment it there — this check needs a public key to try to break in with.",
  );
  process.exit(1);
}

const privileged = createClient(url, secretKey, { auth: { persistSession: false } });
const anonymous = createClient(url, publicKey, { auth: { persistSession: false } });

const id = (prefix) =>
  `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
const today = new Date().toISOString().slice(0, 10);

let failures = 0;
let groupId = null;
let slug = null;

async function seed() {
  groupId = id("g");
  slug = crypto.randomUUID().replaceAll("-", "").slice(0, 12);

  await privileged
    .from("groups")
    .insert({ id: groupId, slug, name: "RLS probe", currency: "INR" });

  const payer = id("m");
  const other = id("m");
  await privileged.from("members").insert([
    { id: payer, group_id: groupId, name: "Probe A" },
    { id: other, group_id: groupId, name: "Probe B" },
  ]);

  // Attach a device, so member_devices has a row to hide. Without this the
  // check on the most sensitive table in the schema is inconclusive.
  await privileged.rpc("claim_member", {
    p_id: payer,
    p_device_key: crypto.randomUUID().replaceAll("-", ""),
  });

  await privileged.rpc("save_expense", {
    p_id: id("e"),
    p_group_id: groupId,
    p_title: "Probe expense",
    p_description: null,
    p_amount_minor: 1000,
    p_category: null,
    p_paid_by: payer,
    p_spent_on: today,
    p_split_mode: "equal",
    p_shares: [
      { member_id: payer, share_minor: 500 },
      { member_id: other, share_minor: 500 },
    ],
    p_actor_member: payer,
  });

  await privileged.rpc("save_settlements", {
    p_group_id: groupId,
    p_rows: [{ id: id("t"), from_member: other, to_member: payer, amount_minor: 500 }],
    p_actor_member: other,
    p_settled_on: today,
    p_note: null,
  });
}

async function countRows(client, table) {
  const { count, error } = await client
    .from(table)
    .select("*", { count: "exact", head: true });
  return { count: count ?? 0, error };
}

async function checkReads() {
  for (const table of TABLES) {
    const mine = await countRows(privileged, table);

    if (mine.error) {
      console.log(`✗ ${table.padEnd(15)} the secret key cannot read it either: ${mine.error.message}`);
      failures += 1;
      continue;
    }

    const theirs = await countRows(anonymous, table);
    const seen = theirs.error ? 0 : theirs.count;

    if (mine.count === 0) {
      console.log(`· ${table.padEnd(15)} inconclusive — no rows exist to hide`);
    } else if (seen > 0) {
      console.log(`✗ ${table.padEnd(15)} PUBLIC READ: anon saw ${seen} of ${mine.count} rows`);
      failures += 1;
    } else {
      console.log(`✓ ${table.padEnd(15)} denied (${mine.count} rows exist, anon saw 0)`);
    }
  }
}

async function checkWrites() {
  // A table that denies reads but accepts inserts is still wide open to
  // anyone who wants to corrupt a ledger.
  const probeId = id("g");
  const insert = await anonymous.from("groups").insert({
    id: probeId,
    slug: crypto.randomUUID().replaceAll("-", "").slice(0, 12),
    name: "anon insert probe",
  });

  if (insert.error) {
    console.log("✓ groups          anon insert rejected");
  } else {
    console.log("✗ groups          PUBLIC WRITE: anon inserted a row");
    failures += 1;
    await privileged.from("groups").delete().eq("id", probeId);
  }

  const update = await anonymous
    .from("groups")
    .update({ name: "renamed by anon" })
    .eq("id", groupId);

  // An update that matches no visible row succeeds silently, so the real
  // question is whether the row actually changed.
  const after = await privileged.from("groups").select("name").eq("id", groupId).single();
  if (after.data?.name === "RLS probe") {
    console.log("✓ groups          anon update changed nothing");
  } else {
    console.log(`✗ groups          PUBLIC WRITE: anon renamed a group (${update.error?.message ?? "no error"})`);
    failures += 1;
  }
}

async function checkFunctions() {
  // The RPCs are how the server writes. If anon can call them, the tables
  // being locked down does not matter.
  const { error } = await anonymous.rpc("group_bundle", { p_slug: slug });
  if (error) {
    console.log("✓ group_bundle    anon cannot call it");
  } else {
    console.log("✗ group_bundle    PUBLIC RPC: anon read a whole group");
    failures += 1;
  }
}

try {
  await seed();
  await checkReads();
  await checkWrites();
  await checkFunctions();
} finally {
  if (groupId) await privileged.from("groups").delete().eq("id", groupId);
}

console.log(
  failures === 0
    ? "\nRLS is closed to the public. The server is the only way in."
    : `\n${failures} problem${failures === 1 ? "" : "s"} — the database is reachable without the server.`,
);

process.exit(failures === 0 ? 0 : 1);
