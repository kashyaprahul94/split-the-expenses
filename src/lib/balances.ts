import type { Expense, ExpenseShare, Member, Settlement } from "./types";

/**
 * Balances are computed from expenses and settlements on every read. There is
 * no `balance` column and there must never be one.
 *
 * A stored balance is a cache, and a cache that can disagree with its source
 * eventually does — one failed update mid-edit and the group is looking at
 * numbers that do not reconcile with the expense list, with no way to tell
 * which is wrong. The dataset is tiny (a heavy group reaches a few hundred
 * expenses), so recomputing costs nothing.
 */

export interface Transfer {
  from: string;
  to: string;
  amount_minor: number;
}

export interface MemberBalance {
  member_id: string;
  /** Expenses this member funded. */
  paid_minor: number;
  /** This member's shares of expenses, whoever funded them. */
  owed_minor: number;
  /** Settlement money handed to other people. */
  settled_out_minor: number;
  /** Settlement money received from other people. */
  settled_in_minor: number;
  /** Positive means the group owes them. Always sums to zero across a group. */
  net_minor: number;
}

export interface LedgerInput {
  members: Pick<Member, "id">[];
  expenses: Pick<Expense, "id" | "amount_minor" | "paid_by" | "deleted_at">[];
  shares: Pick<ExpenseShare, "expense_id" | "member_id" | "share_minor">[];
  settlements: Pick<
    Settlement,
    "from_member" | "to_member" | "amount_minor" | "deleted_at"
  >[];
}

/** Soft-deleted rows are excluded from every calculation, never filtered out at
 * the database layer — the group can still see and restore them. */
function activeExpenses(expenses: LedgerInput["expenses"]) {
  return expenses.filter((expense) => expense.deleted_at === null);
}

function activeSettlements(settlements: LedgerInput["settlements"]) {
  return settlements.filter((settlement) => settlement.deleted_at === null);
}

export function computeBalances(input: LedgerInput): MemberBalance[] {
  const live = activeExpenses(input.expenses);
  const liveIds = new Set(live.map((expense) => expense.id));

  const rows = new Map<string, MemberBalance>();
  const row = (member_id: string): MemberBalance => {
    let existing = rows.get(member_id);
    if (!existing) {
      existing = {
        member_id,
        paid_minor: 0,
        owed_minor: 0,
        settled_out_minor: 0,
        settled_in_minor: 0,
        net_minor: 0,
      };
      rows.set(member_id, existing);
    }
    return existing;
  };

  // Seed every member, so someone who has neither paid nor consumed still
  // appears at zero rather than vanishing from the group.
  for (const member of input.members) row(member.id);

  for (const expense of live) {
    row(expense.paid_by).paid_minor += expense.amount_minor;
  }

  for (const share of input.shares) {
    // A share whose expense is deleted is dead weight, not a debt.
    if (!liveIds.has(share.expense_id)) continue;
    row(share.member_id).owed_minor += share.share_minor;
  }

  for (const settlement of activeSettlements(input.settlements)) {
    row(settlement.from_member).settled_out_minor += settlement.amount_minor;
    row(settlement.to_member).settled_in_minor += settlement.amount_minor;
  }

  for (const balance of rows.values()) {
    balance.net_minor =
      balance.paid_minor -
      balance.owed_minor +
      balance.settled_out_minor -
      balance.settled_in_minor;
  }

  return [...rows.values()].sort((a, b) =>
    a.member_id < b.member_id ? -1 : a.member_id > b.member_id ? 1 : 0,
  );
}

/** NUL separates the two ids because it cannot appear inside one, so the key
 * stays unambiguous and splitting it back apart is safe. */
function pairKey(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

/**
 * Debts as they actually arose: if Priya paid for dinner, everyone who ate
 * owes Priya. This is the default view because it is the one people can check
 * against their own memory of the evening.
 *
 * Opposing debts between the same two people are netted (owing each other ₹100
 * is owing nobody anything), and settlements are applied on top.
 */
export function directDebts(input: LedgerInput): Transfer[] {
  const live = activeExpenses(input.expenses);
  const payerOf = new Map(live.map((expense) => [expense.id, expense.paid_by]));

  const owed = new Map<string, number>();
  const add = (from: string, to: string, amount: number) => {
    if (from === to || amount === 0) return;
    owed.set(pairKey(from, to), (owed.get(pairKey(from, to)) ?? 0) + amount);
  };

  for (const share of input.shares) {
    const payer = payerOf.get(share.expense_id);
    if (payer === undefined) continue; // deleted expense
    add(share.member_id, payer, share.share_minor);
  }

  // A settlement is the debtor handing money over, so it cancels debt in the
  // same direction it flows.
  for (const settlement of activeSettlements(input.settlements)) {
    add(settlement.from_member, settlement.to_member, -settlement.amount_minor);
  }

  const transfers: Transfer[] = [];
  const done = new Set<string>();

  for (const key of owed.keys()) {
    if (done.has(key)) continue;
    const [from, to] = key.split("\u0000");
    const reverseKey = pairKey(to, from);
    done.add(key);
    done.add(reverseKey);

    const net = (owed.get(key) ?? 0) - (owed.get(reverseKey) ?? 0);
    if (net > 0) transfers.push({ from, to, amount_minor: net });
    else if (net < 0) transfers.push({ from: to, to: from, amount_minor: -net });
  }

  return sortTransfers(transfers);
}

/** Largest debts first; ties broken by id so the list never reshuffles between
 * renders of identical data. */
export function sortTransfers(transfers: Transfer[]): Transfer[] {
  return [...transfers].sort(
    (a, b) =>
      b.amount_minor - a.amount_minor ||
      (a.from < b.from ? -1 : a.from > b.from ? 1 : 0) ||
      (a.to < b.to ? -1 : a.to > b.to ? 1 : 0),
  );
}

export interface GroupTotals {
  total_minor: number;
  expense_count: number;
  member_count: number;
  /** Floor of the true average; the remainder is not attributable to anyone. */
  per_head_minor: number;
}

export function groupTotals(input: LedgerInput): GroupTotals {
  const live = activeExpenses(input.expenses);
  const total = live.reduce((sum, expense) => sum + expense.amount_minor, 0);
  const memberCount = input.members.length;

  return {
    total_minor: total,
    expense_count: live.length,
    member_count: memberCount,
    per_head_minor: memberCount === 0 ? 0 : Math.floor(total / memberCount),
  };
}

/**
 * Every group's net balances sum to zero — money only moves between members,
 * it is never created. A non-zero sum means a share row does not reconcile
 * with its expense, so this is worth asserting rather than assuming.
 */
export function balancesReconcile(balances: MemberBalance[]): boolean {
  return balances.reduce((sum, balance) => sum + balance.net_minor, 0) === 0;
}
