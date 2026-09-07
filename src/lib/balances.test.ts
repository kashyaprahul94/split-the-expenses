import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  type LedgerInput,
  balancesReconcile,
  computeBalances,
  directDebts,
  groupTotals,
} from "./balances";
import { computeShares } from "./split";

const members = (count: number) =>
  Array.from({ length: count }, (_, i) => ({
    id: `m${String(i).padStart(2, "0")}`,
  }));

const expense = (
  id: string,
  paid_by: string,
  amount_minor: number,
  deleted_at: string | null = null,
) => ({ id, paid_by, amount_minor, deleted_at });

const share = (expense_id: string, member_id: string, share_minor: number) => ({
  expense_id,
  member_id,
  share_minor,
});

const settlement = (
  from_member: string,
  to_member: string,
  amount_minor: number,
  deleted_at: string | null = null,
) => ({ from_member, to_member, amount_minor, deleted_at });

const net = (input: LedgerInput) =>
  Object.fromEntries(
    computeBalances(input).map((balance) => [balance.member_id, balance.net_minor]),
  );

describe("computeBalances", () => {
  it("credits the payer and debits the consumers", () => {
    const input: LedgerInput = {
      members: members(2),
      expenses: [expense("e1", "m00", 1_000)],
      shares: [share("e1", "m00", 500), share("e1", "m01", 500)],
      settlements: [],
    };
    // m00 put down 1000 and consumed 500, so the group owes them 500.
    expect(net(input)).toEqual({ m00: 500, m01: -500 });
  });

  it("shows a member at zero when they have neither paid nor consumed", () => {
    const input: LedgerInput = {
      members: members(3),
      expenses: [expense("e1", "m00", 1_000)],
      shares: [share("e1", "m00", 500), share("e1", "m01", 500)],
      settlements: [],
    };
    expect(net(input).m02).toBe(0);
  });

  it("excludes soft-deleted expenses and their shares", () => {
    const input: LedgerInput = {
      members: members(2),
      expenses: [expense("e1", "m00", 1_000, "2026-09-07T00:00:00Z")],
      shares: [share("e1", "m00", 500), share("e1", "m01", 500)],
      settlements: [],
    };
    expect(net(input)).toEqual({ m00: 0, m01: 0 });
  });

  it("moves the balance when a settlement is recorded, and back when it is deleted", () => {
    const base: LedgerInput = {
      members: members(2),
      expenses: [expense("e1", "m00", 1_000)],
      shares: [share("e1", "m00", 500), share("e1", "m01", 500)],
      settlements: [settlement("m01", "m00", 500)],
    };
    expect(net(base)).toEqual({ m00: 0, m01: 0 });

    const deleted: LedgerInput = {
      ...base,
      settlements: [settlement("m01", "m00", 500, "2026-09-07T00:00:00Z")],
    };
    expect(net(deleted)).toEqual({ m00: 500, m01: -500 });
  });

  it("breaks the net down into its parts", () => {
    const [balance] = computeBalances({
      members: members(1),
      expenses: [expense("e1", "m00", 1_000)],
      shares: [share("e1", "m00", 400)],
      settlements: [settlement("m00", "m01", 100)],
    });
    expect(balance).toMatchObject({
      paid_minor: 1_000,
      owed_minor: 400,
      settled_out_minor: 100,
      settled_in_minor: 0,
      net_minor: 700,
    });
  });
});

describe("directDebts", () => {
  it("points every consumer at the person who actually paid", () => {
    expect(
      directDebts({
        members: members(3),
        expenses: [expense("e1", "m00", 900)],
        shares: [
          share("e1", "m00", 300),
          share("e1", "m01", 300),
          share("e1", "m02", 300),
        ],
        settlements: [],
      }),
    ).toEqual([
      { from: "m01", to: "m00", amount_minor: 300 },
      { from: "m02", to: "m00", amount_minor: 300 },
    ]);
  });

  it("nets two people who owe each other", () => {
    // m01 owes m00 500 from e1; m00 owes m01 200 from e2. Only 300 moves.
    expect(
      directDebts({
        members: members(2),
        expenses: [expense("e1", "m00", 1_000), expense("e2", "m01", 400)],
        shares: [
          share("e1", "m00", 500),
          share("e1", "m01", 500),
          share("e2", "m00", 200),
          share("e2", "m01", 200),
        ],
        settlements: [],
      }),
    ).toEqual([{ from: "m01", to: "m00", amount_minor: 300 }]);
  });

  it("drops a debt that has been settled in full", () => {
    expect(
      directDebts({
        members: members(2),
        expenses: [expense("e1", "m00", 1_000)],
        shares: [share("e1", "m00", 500), share("e1", "m01", 500)],
        settlements: [settlement("m01", "m00", 500)],
      }),
    ).toEqual([]);
  });

  it("reverses the arrow when someone overpays a settlement", () => {
    expect(
      directDebts({
        members: members(2),
        expenses: [expense("e1", "m00", 1_000)],
        shares: [share("e1", "m00", 500), share("e1", "m01", 500)],
        settlements: [settlement("m01", "m00", 700)],
      }),
    ).toEqual([{ from: "m00", to: "m01", amount_minor: 200 }]);
  });

  it("never has anyone owing themselves", () => {
    const debts = directDebts({
      members: members(2),
      expenses: [expense("e1", "m00", 1_000)],
      shares: [share("e1", "m00", 500), share("e1", "m01", 500)],
      settlements: [],
    });
    expect(debts.every((debt) => debt.from !== debt.to)).toBe(true);
  });
});

describe("groupTotals", () => {
  it("counts only live expenses", () => {
    expect(
      groupTotals({
        members: members(4),
        expenses: [
          expense("e1", "m00", 1_000),
          expense("e2", "m01", 2_000),
          expense("e3", "m01", 5_000, "2026-09-07T00:00:00Z"),
        ],
        shares: [],
        settlements: [],
      }),
    ).toEqual({
      total_minor: 3_000,
      expense_count: 2,
      member_count: 4,
      per_head_minor: 750,
    });
  });

  it("does not divide by zero in an empty group", () => {
    expect(
      groupTotals({ members: [], expenses: [], shares: [], settlements: [] })
        .per_head_minor,
    ).toBe(0);
  });
});

/**
 * A generated ledger: random expenses, each split equally over a random subset
 * of members, plus random settlements. Shares always come from computeShares,
 * so they reconcile with their expense by construction — which is what makes
 * the zero-sum property below a test of the balance maths rather than of luck.
 */
const ledgerArbitrary = fc
  .integer({ min: 1, max: 8 })
  .chain((memberCount) => {
    const memberIds = members(memberCount).map((member) => member.id);
    return fc.record({
      memberIds: fc.constant(memberIds),
      expenses: fc.array(
        fc.record({
          amount: fc.integer({ min: 1, max: 5_000_000 }),
          payerIndex: fc.integer({ min: 0, max: memberCount - 1 }),
          participants: fc
            .subarray(memberIds, { minLength: 1 })
            .map((subset) => (subset.length === 0 ? [memberIds[0]] : subset)),
          deleted: fc.boolean(),
        }),
        { maxLength: 12 },
      ),
      settlements: fc.array(
        fc.record({
          fromIndex: fc.integer({ min: 0, max: memberCount - 1 }),
          toIndex: fc.integer({ min: 0, max: memberCount - 1 }),
          amount: fc.integer({ min: 1, max: 500_000 }),
          deleted: fc.boolean(),
        }),
        { maxLength: 6 },
      ),
    });
  })
  .map((spec): LedgerInput => {
    const expenses: LedgerInput["expenses"] = [];
    const shares: LedgerInput["shares"] = [];

    spec.expenses.forEach((row, index) => {
      const id = `e${index}`;
      expenses.push(
        expense(
          id,
          spec.memberIds[row.payerIndex],
          row.amount,
          row.deleted ? "2026-09-07T00:00:00Z" : null,
        ),
      );
      const computed = computeShares(
        row.amount,
        { mode: "equal", member_ids: row.participants },
        id,
      );
      if (computed.ok) {
        for (const item of computed.value) {
          shares.push(share(id, item.member_id, item.share_minor));
        }
      }
    });

    return {
      members: members(spec.memberIds.length),
      expenses,
      shares,
      settlements: spec.settlements.map((row) =>
        settlement(
          spec.memberIds[row.fromIndex],
          spec.memberIds[row.toIndex],
          row.amount,
          row.deleted ? "2026-09-07T00:00:00Z" : null,
        ),
      ),
    };
  });

describe("invariant: a group's balances sum to zero", () => {
  it("holds for any ledger", () => {
    // Money only moves between members; it is never created or destroyed. A
    // non-zero sum means a share row does not reconcile with its expense.
    fc.assert(
      fc.property(ledgerArbitrary, (input) => {
        expect(balancesReconcile(computeBalances(input))).toBe(true);
      }),
      { numRuns: 400 },
    );
  });

  it("agrees with the direct debt list", () => {
    // Each member's net must equal what they are owed minus what they owe,
    // summed over the pairwise view. The two views cannot disagree.
    fc.assert(
      fc.property(ledgerArbitrary, (input) => {
        const balances = computeBalances(input);
        const debts = directDebts(input);

        for (const balance of balances) {
          const incoming = debts
            .filter((debt) => debt.to === balance.member_id)
            .reduce((sum, debt) => sum + debt.amount_minor, 0);
          const outgoing = debts
            .filter((debt) => debt.from === balance.member_id)
            .reduce((sum, debt) => sum + debt.amount_minor, 0);
          expect(incoming - outgoing).toBe(balance.net_minor);
        }
      }),
      { numRuns: 400 },
    );
  });
});
