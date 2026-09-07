import { BASIS_POINTS_TOTAL } from "./money";
import { type Result, type SplitMode, err, ok } from "./types";

/**
 * Share calculation. This file and simplify.ts are where the correctness of
 * the whole app lives, so both are pure: no Supabase, no React, no clock.
 *
 * The invariant everything else depends on:
 *
 *     the shares of an expense sum to exactly its amount_minor
 *
 * ₹100 split three ways is 3333 / 3333 / 3334 paise, not 33.33 each. The
 * remainder must land on somebody, deterministically, and the app must not
 * silently lose or invent a paisa.
 */

export interface Share {
  member_id: string;
  share_minor: number;
}

export interface ExactEntry {
  member_id: string;
  share_minor: number;
}

export interface PercentEntry {
  member_id: string;
  percent_bp: number;
}

export type SplitInput =
  | { mode: "equal"; member_ids: string[] }
  | { mode: "exact"; entries: ExactEntry[] }
  | { mode: "percent"; entries: PercentEntry[] };

/**
 * FNV-1a. Not cryptographic and does not need to be — it exists only to turn
 * an expense id into a stable starting offset, so that the leftover paise
 * land on different people across expenses instead of always on whoever sorts
 * first alphabetically.
 */
export function hashString(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Distribute `totalMinor` across weighted members so the parts sum to exactly
 * the total. Largest-remainder (Hamilton) apportionment: everyone gets the
 * floor of their exact entitlement, then the leftover units go one each to
 * whoever was cut by most.
 *
 * Ties — which is *every* member in an equal split, since their remainders are
 * identical — are broken by a rotation seeded from `seed`.
 *
 * Arithmetic is BigInt because `totalMinor * weight` can exceed
 * Number.MAX_SAFE_INTEGER at the top of the allowed amount range. The returned
 * shares are each <= totalMinor, so converting back to number is exact.
 */
function allocateByWeight(
  totalMinor: number,
  weighted: { member_id: string; weight: number }[],
  seed: string,
): Share[] {
  const count = weighted.length;
  const ordered = [...weighted].sort((a, b) =>
    a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0,
  );

  const totalWeight = ordered.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0) {
    return ordered.map((entry) => ({ member_id: entry.member_id, share_minor: 0 }));
  }

  const total = BigInt(totalMinor);
  const weightSum = BigInt(totalWeight);
  const offset = count === 0 ? 0 : hashString(seed) % count;

  const rows = ordered.map((entry, index) => {
    const product = total * BigInt(entry.weight);
    const base = product / weightSum;
    return {
      member_id: entry.member_id,
      base: Number(base),
      remainder: product - base * weightSum,
      // Rotating the tie-break order is what spreads the odd paise around.
      rank: (index - offset + count) % count,
    };
  });

  const distributed = rows.reduce((sum, row) => sum + row.base, 0);
  let leftover = totalMinor - distributed;

  const queue = [...rows].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    return a.rank - b.rank;
  });

  const extra = new Map<string, number>();
  for (const row of queue) {
    if (leftover <= 0) break;
    extra.set(row.member_id, 1);
    leftover -= 1;
  }

  return rows.map((row) => ({
    member_id: row.member_id,
    share_minor: row.base + (extra.get(row.member_id) ?? 0),
  }));
}

export function sumShares(shares: { share_minor: number }[]): number {
  return shares.reduce((sum, share) => sum + share.share_minor, 0);
}

function findDuplicate(ids: string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/**
 * Turn what the form collected into the rows that go in `expense_shares`.
 *
 * `seed` is the expense id. An expense being created does not have one yet —
 * generate the id client-side first (nanoid) and pass it here, so the shares
 * saved are the shares that were previewed.
 *
 * Members with a zero share are kept rather than dropped: the report shows who
 * was considered part of a split, and "in the split for nothing" is different
 * information from "not in the split".
 */
export function computeShares(
  totalMinor: number,
  input: SplitInput,
  seed: string,
): Result<Share[]> {
  if (!Number.isSafeInteger(totalMinor)) {
    return err("Amount must be a whole number of minor units");
  }
  if (totalMinor <= 0) return err("Amount must be more than zero");

  switch (input.mode) {
    case "equal": {
      const ids = input.member_ids;
      if (ids.length === 0) return err("Pick at least one person");
      const duplicate = findDuplicate(ids);
      if (duplicate) return err("The same person is listed twice");

      return ok(
        allocateByWeight(
          totalMinor,
          ids.map((member_id) => ({ member_id, weight: 1 })),
          seed,
        ),
      );
    }

    case "exact": {
      const entries = input.entries;
      if (entries.length === 0) return err("Pick at least one person");
      const duplicate = findDuplicate(entries.map((entry) => entry.member_id));
      if (duplicate) return err("The same person is listed twice");

      for (const entry of entries) {
        if (!Number.isSafeInteger(entry.share_minor)) {
          return err("Every share must be a whole number of minor units");
        }
        if (entry.share_minor < 0) return err("A share cannot be negative");
      }

      const sum = sumShares(entries);
      if (sum !== totalMinor) {
        // The caller renders the shortfall with exactRemainder(); this message
        // is the fallback for a submit that slipped past the live check.
        return err(
          sum < totalMinor
            ? "The shares add up to less than the total"
            : "The shares add up to more than the total",
        );
      }

      return ok(
        [...entries]
          .map((entry) => ({
            member_id: entry.member_id,
            share_minor: entry.share_minor,
          }))
          .sort((a, b) => (a.member_id < b.member_id ? -1 : 1)),
      );
    }

    case "percent": {
      const entries = input.entries;
      if (entries.length === 0) return err("Pick at least one person");
      const duplicate = findDuplicate(entries.map((entry) => entry.member_id));
      if (duplicate) return err("The same person is listed twice");

      for (const entry of entries) {
        if (!Number.isSafeInteger(entry.percent_bp)) {
          return err("That is not a valid percentage");
        }
        if (entry.percent_bp < 0) return err("A percentage cannot be negative");
      }

      const sum = entries.reduce((acc, entry) => acc + entry.percent_bp, 0);
      if (sum !== BASIS_POINTS_TOTAL) {
        return err(
          sum < BASIS_POINTS_TOTAL
            ? "The percentages add up to less than 100%"
            : "The percentages add up to more than 100%",
        );
      }

      return ok(
        allocateByWeight(
          totalMinor,
          entries.map((entry) => ({
            member_id: entry.member_id,
            weight: entry.percent_bp,
          })),
          seed,
        ),
      );
    }
  }
}

/**
 * How far an `exact` split is from adding up, for the live affordance in the
 * form. Positive means the shares fall short by this much — the amount the
 * "put the remaining ₹0.01 on me" button would assign.
 */
export function exactRemainder(
  totalMinor: number,
  entries: { share_minor: number }[],
): number {
  return totalMinor - sumShares(entries);
}

/**
 * The safety net. Anything that writes `expense_shares` calls this first, so
 * a bug in a caller cannot put a ledger-breaking row in the database.
 */
export function sharesReconcile(
  totalMinor: number,
  shares: { share_minor: number }[],
): boolean {
  return sumShares(shares) === totalMinor;
}

export const SPLIT_MODES: SplitMode[] = ["equal", "exact", "percent"];

export const SPLIT_MODE_LABELS: Record<SplitMode, string> = {
  equal: "Equally",
  exact: "Exact amounts",
  percent: "Percentages",
};
