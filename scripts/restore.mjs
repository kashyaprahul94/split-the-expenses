// Put a backup back, exactly as it was.
//
//   npm run restore -- backups/2026-09-07T14-42-16
//   npm run restore -- backups/2026-09-07T14-42-16 --force
//
// Unlike the in-app import, which deliberately creates a *new* group, this
// restores the original ids, slugs and timestamps — it is for the case where
// something ate the data and you want it back where it was. It refuses to
// touch a group that still exists unless you pass --force.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;
const directory = process.argv[2];
const force = process.argv.includes("--force");

if (!url || !secretKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}
if (!directory) {
  console.error("Usage: npm run restore -- backups/<timestamp> [--force]");
  process.exit(1);
}

const db = createClient(url, secretKey, { auth: { persistSession: false } });
const backup = JSON.parse(readFileSync(join(directory, "everything.json"), "utf8"));

const rowsOf = (table) => backup[table] ?? [];

async function insert(table, rows) {
  if (rows.length === 0) return;
  for (let from = 0; from < rows.length; from += 500) {
    const { error } = await db.from(table).insert(rows.slice(from, from + 500));
    if (error) throw new Error(`${table}: ${error.message}`);
  }
}

let restored = 0;

for (const group of rowsOf("groups")) {
  const existing = await db.from("groups").select("id").eq("id", group.id).maybeSingle();

  if (existing.data && !force) {
    console.log(`· ${group.name} already exists — skipped (use --force to replace)`);
    continue;
  }
  if (existing.data && force) {
    // Cascades to everything below it.
    await db.from("groups").delete().eq("id", group.id);
    console.log(`  ${group.name}: removed the existing copy`);
  }

  await insert("groups", [group]);

  const members = rowsOf("members").filter((row) => row.group_id === group.id);
  // Old backups carry device_key on the member row; new ones have a separate
  // table. Accept either, so a backup taken before the migration still works.
  await insert(
    "members",
    members.map((row) => ({
      id: row.id,
      group_id: row.group_id,
      name: row.name,
      created_at: row.created_at,
    })),
  );

  const devices = rowsOf("member_devices").filter((row) => row.group_id === group.id);
  const legacyDevices = members
    .filter((row) => row.device_key)
    .map((row) => ({
      group_id: row.group_id,
      member_id: row.id,
      device_key: row.device_key,
    }));
  await insert("member_devices", devices.length > 0 ? devices : legacyDevices);

  // Expenses go through save_expense: writing the rows directly would trip the
  // deferred reconcile trigger, because an expense and its shares would arrive
  // in two separate transactions with nothing in between to balance it.
  const expenses = rowsOf("expenses").filter((row) => row.group_id === group.id);
  for (const expense of expenses) {
    const shares = rowsOf("expense_shares")
      .filter((row) => row.expense_id === expense.id)
      .map((row) => ({
        member_id: row.member_id,
        share_minor: Number(row.share_minor),
      }));

    const { error } = await db.rpc("save_expense", {
      p_id: expense.id,
      p_group_id: expense.group_id,
      p_title: expense.title,
      p_description: expense.description,
      p_amount_minor: Number(expense.amount_minor),
      p_category: expense.category,
      p_paid_by: expense.paid_by,
      p_spent_on: expense.spent_on,
      p_split_mode: expense.split_mode,
      p_shares: shares,
      p_actor_member: null,
    });
    if (error) throw new Error(`expense ${expense.title}: ${error.message}`);

    // save_expense stamps its own timestamps, so the originals go back on
    // afterwards. The shares balance by now, so the trigger is happy.
    const { error: stampError } = await db
      .from("expenses")
      .update({
        created_at: expense.created_at,
        updated_at: expense.updated_at,
        deleted_at: expense.deleted_at,
      })
      .eq("id", expense.id);
    if (stampError) throw new Error(`expense ${expense.title}: ${stampError.message}`);
  }

  await insert(
    "settlements",
    rowsOf("settlements").filter((row) => row.group_id === group.id),
  );

  // Written last: the activity rows reference members, and save_expense has
  // been adding its own entries along the way. Restoring the originals on top
  // keeps the group's real history rather than a log of the restore.
  await db.from("activity").delete().eq("group_id", group.id);
  await insert(
    "activity",
    rowsOf("activity").filter((row) => row.group_id === group.id),
  );

  restored += 1;
  console.log(
    `✓ ${group.name}: ${members.length} people, ${expenses.length} expenses`,
  );
}

console.log(`\n${restored} group${restored === 1 ? "" : "s"} restored from ${directory}`);
