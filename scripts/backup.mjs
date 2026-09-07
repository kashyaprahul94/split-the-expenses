// Dump every group to disk, as JSON and as CSV.
//
//   npm run backup
//
// Run this before any schema change. It reads with the secret key, writes
// nothing to the database, and is the thing that makes a bad migration
// survivable. The JSON is the faithful copy; the CSVs are for reading in a
// spreadsheet and for `npm run restore`.

import { createClient } from "@supabase/supabase-js";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const url = process.env.SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SECRET_KEY in .env.local");
  process.exit(1);
}

const db = createClient(url, secretKey, { auth: { persistSession: false } });

const TABLES = [
  "groups",
  "members",
  "member_devices",
  "expenses",
  "expense_shares",
  "settlements",
  "activity",
];

function toCsv(rows) {
  if (rows.length === 0) return "";
  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const escape = (value) => {
    if (value === null || value === undefined) return "";
    const text = String(value);
    return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => escape(row[column])).join(",")),
  ].join("\n");
}

const stamp = new Date()
  .toISOString()
  .replaceAll(":", "-")
  .replace(/\..+$/, "");
const directory = join("backups", stamp);
mkdirSync(directory, { recursive: true });

const everything = {};
let total = 0;

for (const table of TABLES) {
  // Paged, because a `select()` with no range caps out at 1000 rows and a
  // silently truncated backup is worse than no backup.
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await db
      .from(table)
      .select("*")
      .range(from, from + pageSize - 1);

    if (error) {
      console.log(`· ${table.padEnd(16)} skipped: ${error.message.slice(0, 70)}`);
      break;
    }
    rows.push(...data);
    if (data.length < pageSize) break;
  }

  everything[table] = rows;
  total += rows.length;
  writeFileSync(join(directory, `${table}.csv`), toCsv(rows));
  console.log(`✓ ${table.padEnd(16)} ${String(rows.length).padStart(5)} rows`);
}

writeFileSync(
  join(directory, "everything.json"),
  JSON.stringify(everything, null, 2),
);

console.log(`\n${total} rows written to ${directory}/`);
console.log("everything.json is the faithful copy — keep it.");
