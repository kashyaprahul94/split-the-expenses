import { type MemberBalance, type Transfer, sortTransfers } from "./balances";

/**
 * Payment simplification: net everyone out and propose a small set of
 * transfers that settles the group. A owes B ₹500 and B owes C ₹500 becomes
 * A pays C ₹500, and B is done.
 *
 * Two honesty rules travel with this code and must survive into the UI:
 *
 * 1. It never changes what anyone is owed in net, only who they hand it to.
 *    That needs saying on screen, because "you owe Sam ₹500" when you never
 *    transacted with Sam reads as a bug.
 *
 * 2. Greedy is near-optimal, not minimal. Minimising transfer count is NP-hard
 *    in general. Nobody at a dinner table will notice, but do not describe the
 *    result as "the minimum number of payments" — it is not provably that.
 *
 * This is why simplification defaults to off: the direct view is what people
 * can verify against their own memory, and trust matters more than tidiness.
 */

/**
 * Greedily match the largest creditor against the largest debtor, settle
 * `min(|debt|, credit)`, and repeat. Each pass fully zeroes at least one
 * person, so this terminates in at most `n - 1` transfers.
 *
 * Ties are broken by member id, so the same balances always produce the same
 * proposal — a settle-up list that reshuffles between refreshes is one nobody
 * will trust.
 */
export function simplifyTransfers(balances: MemberBalance[]): Transfer[] {
  const creditors = balances
    .filter((balance) => balance.net_minor > 0)
    .map((balance) => ({ id: balance.member_id, amount: balance.net_minor }));

  const debtors = balances
    .filter((balance) => balance.net_minor < 0)
    .map((balance) => ({ id: balance.member_id, amount: -balance.net_minor }));

  const byAmountThenId = (
    a: { id: string; amount: number },
    b: { id: string; amount: number },
  ) => b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

  creditors.sort(byAmountThenId);
  debtors.sort(byAmountThenId);

  const transfers: Transfer[] = [];
  let c = 0;
  let d = 0;

  while (c < creditors.length && d < debtors.length) {
    const creditor = creditors[c];
    const debtor = debtors[d];
    const amount = Math.min(creditor.amount, debtor.amount);

    if (amount > 0) {
      transfers.push({ from: debtor.id, to: creditor.id, amount_minor: amount });
    }

    creditor.amount -= amount;
    debtor.amount -= amount;

    // Advance past whoever hit zero. When both do, both advance — that is the
    // case where the transfer count stays below n - 1.
    if (creditor.amount === 0) c += 1;
    if (debtor.amount === 0) d += 1;
  }

  return sortTransfers(transfers);
}

/**
 * Apply a proposed transfer list to a set of balances. Used by the tests to
 * assert the two properties that matter: everyone ends at zero, and nobody's
 * net position was altered along the way.
 */
export function applyTransfers(
  balances: MemberBalance[],
  transfers: Transfer[],
): Map<string, number> {
  const net = new Map(
    balances.map((balance) => [balance.member_id, balance.net_minor]),
  );

  for (const transfer of transfers) {
    // Paying out a debt moves the payer's net up toward zero.
    net.set(transfer.from, (net.get(transfer.from) ?? 0) + transfer.amount_minor);
    net.set(transfer.to, (net.get(transfer.to) ?? 0) - transfer.amount_minor);
  }

  return net;
}

/** Does this proposal actually settle the group? */
export function transfersSettle(
  balances: MemberBalance[],
  transfers: Transfer[],
): boolean {
  return [...applyTransfers(balances, transfers).values()].every(
    (value) => value === 0,
  );
}
