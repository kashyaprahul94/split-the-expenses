import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { MAX_AMOUNT_MINOR } from "./money";
import {
  type Share,
  type SplitInput,
  computeShares,
  exactRemainder,
  sharesReconcile,
  sumShares,
} from "./split";

const ids = (count: number) =>
  Array.from({ length: count }, (_, i) => `m${String(i).padStart(2, "0")}`);

const shares = (
  totalMinor: number,
  input: SplitInput,
  seed = "seed",
): Share[] => {
  const result = computeShares(totalMinor, input, seed);
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
};

/** n-1 sorted cut points across [0, total] give n non-negative parts that sum
 * to exactly total — a way to generate valid `exact` splits. */
const partition = (total: number, cuts: number[]): number[] => {
  const points = [0, ...[...cuts].sort((a, b) => a - b), total];
  return points.slice(1).map((point, i) => point - points[i]);
};

describe("equal splits", () => {
  it("puts the odd paise somewhere rather than losing them", () => {
    // ₹100 three ways is 3333 / 3333 / 3334, never 33.33 each.
    const result = shares(10_000, { mode: "equal", member_ids: ids(3) });
    expect(sumShares(result)).toBe(10_000);
    expect(result.map((share) => share.share_minor).sort()).toEqual([
      3_333, 3_333, 3_334,
    ]);
  });

  it("divides cleanly when it can", () => {
    const result = shares(9_000, { mode: "equal", member_ids: ids(3) });
    expect(result.map((share) => share.share_minor)).toEqual([
      3_000, 3_000, 3_000,
    ]);
  });

  it("handles a total smaller than the group", () => {
    const result = shares(2, { mode: "equal", member_ids: ids(3) });
    expect(sumShares(result)).toBe(2);
    expect(result.map((share) => share.share_minor).sort()).toEqual([0, 1, 1]);
  });

  it("gives one person the whole thing", () => {
    expect(shares(777, { mode: "equal", member_ids: ids(1) })).toEqual([
      { member_id: "m00", share_minor: 777 },
    ]);
  });

  it("is deterministic for the same expense", () => {
    const input: SplitInput = { mode: "equal", member_ids: ids(7) };
    expect(shares(1_000, input, "expense-a")).toEqual(
      shares(1_000, input, "expense-a"),
    );
  });

  it("spreads the leftover paise across expenses instead of always the first member", () => {
    // The seeded rotation exists so that whoever sorts first alphabetically
    // does not silently absorb every extra paisa in the group's history.
    const members = ids(3);
    const winners = new Set<string>();
    for (let i = 0; i < 60; i++) {
      const result = shares(10_000, { mode: "equal", member_ids: members }, `e${i}`);
      for (const share of result) {
        if (share.share_minor === 3_334) winners.add(share.member_id);
      }
    }
    expect(winners.size).toBe(3);
  });
});

describe("exact splits", () => {
  it("accepts shares that add up", () => {
    const result = shares(10_000, {
      mode: "exact",
      entries: [
        { member_id: "m00", share_minor: 6_000 },
        { member_id: "m01", share_minor: 4_000 },
      ],
    });
    expect(sumShares(result)).toBe(10_000);
  });

  it("refuses shares that are a paisa out, in either direction", () => {
    const under = computeShares(
      10_000,
      {
        mode: "exact",
        entries: [
          { member_id: "m00", share_minor: 6_000 },
          { member_id: "m01", share_minor: 3_999 },
        ],
      },
      "seed",
    );
    expect(under.ok).toBe(false);
    if (!under.ok) expect(under.error).toMatch(/less than/);

    const over = computeShares(
      10_000,
      {
        mode: "exact",
        entries: [
          { member_id: "m00", share_minor: 6_000 },
          { member_id: "m01", share_minor: 4_001 },
        ],
      },
      "seed",
    );
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/more than/);
  });

  it("reports the shortfall for the 'put the rest on me' button", () => {
    expect(
      exactRemainder(10_000, [
        { share_minor: 6_000 },
        { share_minor: 3_999 },
      ]),
    ).toBe(1);
    expect(exactRemainder(10_000, [{ share_minor: 10_001 }])).toBe(-1);
  });

  it("rejects negative shares", () => {
    expect(
      computeShares(
        100,
        {
          mode: "exact",
          entries: [
            { member_id: "m00", share_minor: 200 },
            { member_id: "m01", share_minor: -100 },
          ],
        },
        "seed",
      ).ok,
    ).toBe(false);
  });
});

describe("percent splits", () => {
  it("derives exact amounts from percentages", () => {
    const result = shares(10_000, {
      mode: "percent",
      entries: [
        { member_id: "m00", percent_bp: 5_000 },
        { member_id: "m01", percent_bp: 2_500 },
        { member_id: "m02", percent_bp: 2_500 },
      ],
    });
    expect(result.map((share) => share.share_minor)).toEqual([
      5_000, 2_500, 2_500,
    ]);
  });

  it("still sums exactly when the percentages do not divide evenly", () => {
    // 33.33 / 33.33 / 33.34 of ₹100.01
    const result = shares(10_001, {
      mode: "percent",
      entries: [
        { member_id: "m00", percent_bp: 3_333 },
        { member_id: "m01", percent_bp: 3_333 },
        { member_id: "m02", percent_bp: 3_334 },
      ],
    });
    expect(sumShares(result)).toBe(10_001);
  });

  it("gives the leftover to whoever was cut by most, not just the first", () => {
    // 1/6, 1/3, 1/2 of 100 paise: exact entitlements 16.67, 33.33, 50.00.
    // Floors are 16 / 33 / 50 = 99, so one paisa is spare and belongs to the
    // largest fractional remainder — m00 at .67, not m01 at .33.
    const result = shares(100, {
      mode: "percent",
      entries: [
        { member_id: "m00", percent_bp: 1_667 },
        { member_id: "m01", percent_bp: 3_333 },
        { member_id: "m02", percent_bp: 5_000 },
      ],
    });
    expect(sumShares(result)).toBe(100);
    expect(result[0].share_minor).toBe(17);
  });

  it("refuses percentages that do not total 100", () => {
    for (const bps of [
      [5_000, 4_000],
      [5_000, 6_000],
    ]) {
      const result = computeShares(
        1_000,
        {
          mode: "percent",
          entries: bps.map((percent_bp, i) => ({
            member_id: `m0${i}`,
            percent_bp,
          })),
        },
        "seed",
      );
      expect(result.ok).toBe(false);
    }
  });

  it("gives a zero-percent member a zero share rather than dropping them", () => {
    const result = shares(1_000, {
      mode: "percent",
      entries: [
        { member_id: "m00", percent_bp: 10_000 },
        { member_id: "m01", percent_bp: 0 },
      ],
    });
    expect(result).toHaveLength(2);
    expect(result[1]).toEqual({ member_id: "m01", share_minor: 0 });
  });
});

describe("input validation", () => {
  it("refuses an empty member list", () => {
    expect(computeShares(100, { mode: "equal", member_ids: [] }, "s").ok).toBe(
      false,
    );
  });

  it("refuses a duplicated member", () => {
    expect(
      computeShares(100, { mode: "equal", member_ids: ["a", "a"] }, "s").ok,
    ).toBe(false);
  });

  it("refuses non-positive and non-integer totals", () => {
    expect(computeShares(0, { mode: "equal", member_ids: ["a"] }, "s").ok).toBe(
      false,
    );
    expect(computeShares(-1, { mode: "equal", member_ids: ["a"] }, "s").ok).toBe(
      false,
    );
    expect(
      computeShares(10.5, { mode: "equal", member_ids: ["a"] }, "s").ok,
    ).toBe(false);
  });
});

/**
 * The single assertion that keeps the whole ledger honest. If shares can fail
 * to sum to their expense, every balance in the app is quietly wrong, so this
 * is a property test over random inputs rather than a handful of examples.
 */
describe("invariant: shares sum to the expense total", () => {
  const memberCount = fc.integer({ min: 1, max: 20 });

  it("holds for equal splits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_AMOUNT_MINOR }),
        memberCount,
        fc.string({ minLength: 1, maxLength: 24 }),
        (total, count, seed) => {
          const result = shares(
            total,
            { mode: "equal", member_ids: ids(count) },
            seed,
          );
          expect(sharesReconcile(total, result)).toBe(true);
          expect(result).toHaveLength(count);
          expect(result.every((share) => share.share_minor >= 0)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("holds for percent splits", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_AMOUNT_MINOR }),
        memberCount.chain((count) =>
          fc.tuple(
            fc.constant(count),
            fc.array(fc.integer({ min: 0, max: 10_000 }), {
              minLength: count - 1,
              maxLength: count - 1,
            }),
          ),
        ),
        fc.string({ minLength: 1, maxLength: 24 }),
        (total, [count, cuts], seed) => {
          const parts = partition(10_000, cuts);
          const result = shares(
            total,
            {
              mode: "percent",
              entries: ids(count).map((member_id, i) => ({
                member_id,
                percent_bp: parts[i],
              })),
            },
            seed,
          );
          expect(sharesReconcile(total, result)).toBe(true);
          expect(result.every((share) => share.share_minor >= 0)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("holds for exact splits", () => {
    fc.assert(
      fc.property(
        fc
          .integer({ min: 1, max: MAX_AMOUNT_MINOR })
          .chain((total) =>
            memberCount.chain((count) =>
              fc.tuple(
                fc.constant(total),
                fc.constant(count),
                fc.array(fc.integer({ min: 0, max: total }), {
                  minLength: count - 1,
                  maxLength: count - 1,
                }),
              ),
            ),
          ),
        ([total, count, cuts]) => {
          const parts = partition(total, cuts);
          const result = shares(total, {
            mode: "exact",
            entries: ids(count).map((member_id, i) => ({
              member_id,
              share_minor: parts[i],
            })),
          });
          expect(sharesReconcile(total, result)).toBe(true);
        },
      ),
      { numRuns: 500 },
    );
  });

  it("never differs by more than one minor unit between equal-split members", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: MAX_AMOUNT_MINOR }),
        fc.integer({ min: 1, max: 20 }),
        (total, count) => {
          const amounts = shares(
            total,
            { mode: "equal", member_ids: ids(count) },
            "seed",
          ).map((share) => share.share_minor);
          expect(Math.max(...amounts) - Math.min(...amounts)).toBeLessThanOrEqual(
            1,
          );
        },
      ),
      { numRuns: 300 },
    );
  });
});
