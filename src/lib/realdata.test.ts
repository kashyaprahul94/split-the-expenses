import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { type GroupExport, parseGroupCsv, parseGroupJson, toGroupCsv, toGroupJson } from "./portable";

/**
 * The round trip, run against a real backup rather than a fixture.
 *
 * Fixtures only contain the cases someone thought of. This reads whatever the
 * last 
> split-the-expenses@0.1.0 backup
> node --env-file=.env.local scripts/backup.mjs

✓ groups               1 rows
✓ members             10 rows
✓ member_devices       2 rows
✓ expenses             3 rows
✓ expense_shares      27 rows
✓ settlements         12 rows
✓ activity            28 rows

83 rows written to backups/2026-09-07T14-53-16/
everything.json is the faithful copy — keep it. produced, so it exercises real titles, real notes and
 * real amounts. Skipped when there is no backup on disk.
 */
const backupPath = "backups/2026-09-07T14-42-16/everything.json";

describe("a real backup survives export and import", () => {
  it.skipIf(!existsSync(backupPath))("round-trips through both formats", () => {
    // Shapes straight off a backup file: unknown until read, which is the point.
    interface Row { [key: string]: unknown }
    const raw = JSON.parse(readFileSync(backupPath, "utf8")) as {
      groups: Row[];
      members: Row[];
      expenses: Row[];
      expense_shares: Row[];
      settlements: Row[];
    };
    const text = (value: unknown) => (value === null ? null : String(value));
    const group = raw.groups[0];

    const data: GroupExport = {
      group: {
        id: String(group.id),
        slug: String(group.slug),
        name: String(group.name),
        currency: group.currency as "INR",
        simplify_payments: Boolean(group.simplify_payments),
      },
      members: raw.members.map((m) => ({ id: String(m.id), name: String(m.name) })),
      expenses: raw.expenses.map((e) => ({
        id: String(e.id),
        title: String(e.title),
        description: text(e.description),
        amount_minor: Number(e.amount_minor),
        category: text(e.category),
        paid_by: String(e.paid_by),
        spent_on: String(e.spent_on),
        split_mode: e.split_mode as "equal" | "exact" | "percent",
        deleted_at: text(e.deleted_at),
      })),
      shares: raw.expense_shares.map((s) => ({
        expense_id: String(s.expense_id),
        member_id: String(s.member_id),
        share_minor: Number(s.share_minor),
      })),
      settlements: raw.settlements.map((s) => ({
        id: String(s.id),
        from_member: String(s.from_member),
        to_member: String(s.to_member),
        amount_minor: Number(s.amount_minor),
        settled_on: String(s.settled_on),
        note: text(s.note),
        deleted_at: text(s.deleted_at),
      })),
    };

    const viaJson = parseGroupJson(toGroupJson(data));
    expect(viaJson.ok).toBe(true);
    if (viaJson.ok) expect(viaJson.value).toEqual(data);

    const viaCsv = parseGroupCsv(toGroupCsv(data));
    expect(viaCsv.ok).toBe(true);
    if (viaCsv.ok) expect(viaCsv.value).toEqual(data);

    // And the totals a person would actually check.
    if (viaCsv.ok) {
      const total = viaCsv.value.expenses
        .filter((e) => !e.deleted_at)
        .reduce((sum, e) => sum + e.amount_minor, 0);
      expect(total).toBe(8_043_600);
      expect(viaCsv.value.members).toHaveLength(9);
    }
  });
});
