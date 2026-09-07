import { describe, expect, it } from "vitest";
import fc from "fast-check";
import type { MemberBalance } from "./balances";
import { applyTransfers, simplifyTransfers, transfersSettle } from "./simplify";

const balances = (nets: Record<string, number>): MemberBalance[] =>
  Object.entries(nets).map(([member_id, net_minor]) => ({
    member_id,
    paid_minor: 0,
    owed_minor: 0,
    settled_out_minor: 0,
    settled_in_minor: 0,
    net_minor,
  }));

describe("simplifyTransfers", () => {
  it("routes a chain of debts into one payment", () => {
    // The classic case: A owes B ₹500, B owes C ₹500. A pays C, B is done.
    const result = simplifyTransfers(
      balances({ a: -500, b: 0, c: 500 }),
    );
    expect(result).toEqual([{ from: "a", to: "c", amount_minor: 500 }]);
  });

  it("proposes nothing when everyone is square", () => {
    expect(simplifyTransfers(balances({ a: 0, b: 0, c: 0 }))).toEqual([]);
    expect(simplifyTransfers([])).toEqual([]);
  });

  it("splits one debtor across several creditors", () => {
    const result = simplifyTransfers(balances({ a: -300, b: 100, c: 200 }));
    expect(transfersSettle(balances({ a: -300, b: 100, c: 200 }), result)).toBe(
      true,
    );
    expect(result).toHaveLength(2);
  });

  it("is deterministic, so the settle-up list does not reshuffle on refresh", () => {
    const nets = { a: -700, b: -300, c: 400, d: 600 };
    expect(simplifyTransfers(balances(nets))).toEqual(
      simplifyTransfers(balances(nets)),
    );
  });

  it("does not depend on the order the balances arrive in", () => {
    const forward = simplifyTransfers(
      balances({ a: -700, b: -300, c: 400, d: 600 }),
    );
    const reversed = simplifyTransfers(
      balances({ d: 600, c: 400, b: -300, a: -700 }),
    );
    expect(forward).toEqual(reversed);
  });

  it("never asks anyone to pay themselves", () => {
    const result = simplifyTransfers(balances({ a: -500, b: 500 }));
    expect(result.every((transfer) => transfer.from !== transfer.to)).toBe(true);
  });
});

/**
 * Random zero-sum balances. Every real group's balances sum to zero (see
 * balances.test.ts), so that is the only shape worth generating.
 */
const zeroSumBalances = fc
  .array(fc.integer({ min: -1_000_000, max: 1_000_000 }), {
    minLength: 1,
    maxLength: 20,
  })
  .map((nets) => {
    const head = nets.slice(0, -1);
    const sum = head.reduce((total, value) => total + value, 0);
    // `-sum` is -0 when sum is 0, and Object.is(-0, 0) is false. Real balances
    // are computed as `paid - owed + out - in` and never produce -0, so this
    // is a generator artefact to normalise away rather than a case to handle.
    return balances(
      Object.fromEntries(
        [...head, sum === 0 ? 0 : -sum].map((net_minor, i) => [
          `m${String(i).padStart(2, "0")}`,
          net_minor,
        ]),
      ),
    );
  });

describe("invariants: simplification is a routing change, not a maths change", () => {
  it("leaves everyone at zero", () => {
    fc.assert(
      fc.property(zeroSumBalances, (input) => {
        expect(transfersSettle(input, simplifyTransfers(input))).toBe(true);
      }),
      { numRuns: 500 },
    );
  });

  it("never changes what anyone is owed in net", () => {
    // This is the promise the UI makes on screen. Applying the proposal must
    // move every member from their net position to exactly zero — no more, no
    // less — which means nobody ends up better or worse off than they were.
    fc.assert(
      fc.property(zeroSumBalances, (input) => {
        const settled = applyTransfers(input, simplifyTransfers(input));
        for (const balance of input) {
          expect(settled.get(balance.member_id)).toBe(0);
        }
      }),
      { numRuns: 500 },
    );
  });

  it("needs at most n - 1 transfers", () => {
    fc.assert(
      fc.property(zeroSumBalances, (input) => {
        expect(simplifyTransfers(input).length).toBeLessThanOrEqual(
          Math.max(0, input.length - 1),
        );
      }),
      { numRuns: 500 },
    );
  });

  it("never proposes more transfers than the direct view would need", () => {
    fc.assert(
      fc.property(zeroSumBalances, (input) => {
        const debtors = input.filter((balance) => balance.net_minor < 0).length;
        const creditors = input.filter((balance) => balance.net_minor > 0).length;
        // Worst case for greedy is one transfer per debtor-creditor pairing
        // that zeroes somebody; it can never exceed debtors + creditors - 1.
        const ceiling = debtors === 0 || creditors === 0 ? 0 : debtors + creditors - 1;
        expect(simplifyTransfers(input).length).toBeLessThanOrEqual(ceiling);
      }),
      { numRuns: 500 },
    );
  });

  it("moves every transfer from a debtor to a creditor", () => {
    fc.assert(
      fc.property(zeroSumBalances, (input) => {
        const netOf = new Map(
          input.map((balance) => [balance.member_id, balance.net_minor]),
        );
        for (const transfer of simplifyTransfers(input)) {
          expect(netOf.get(transfer.from)!).toBeLessThan(0);
          expect(netOf.get(transfer.to)!).toBeGreaterThan(0);
          expect(transfer.amount_minor).toBeGreaterThan(0);
        }
      }),
      { numRuns: 500 },
    );
  });
});
