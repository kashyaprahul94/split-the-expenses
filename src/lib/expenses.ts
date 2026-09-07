import { sharesReconcile, type Share } from "./split";
import { db } from "./supabase";
import type { SplitMode } from "./types";

/**
 * Expense writes. Server-only.
 *
 * An expense and its shares go in one call because they are one transaction:
 * two HTTP requests are two transactions, and a half-written expense is a
 * corrupt ledger. The database enforces this too, with a deferred trigger that
 * rejects any expense whose shares do not sum to it.
 */

export interface SaveExpenseInput {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  amountMinor: number;
  category: string | null;
  paidBy: string;
  spentOn: string;
  splitMode: SplitMode;
  shares: Share[];
  actorMemberId: string | null;
}

export async function saveExpense(input: SaveExpenseInput): Promise<void> {
  // The last check before the wire. The database would catch this anyway, but
  // failing here names the numbers instead of surfacing a constraint violation
  // from three layers down.
  if (!sharesReconcile(input.amountMinor, input.shares)) {
    throw new Error(
      "The shares do not add up to the expense total. Nothing was saved.",
    );
  }

  const { error } = await db.rpc("save_expense", {
    p_id: input.id,
    p_group_id: input.groupId,
    p_title: input.title,
    p_description: input.description,
    p_amount_minor: input.amountMinor,
    p_category: input.category,
    p_paid_by: input.paidBy,
    p_spent_on: input.spentOn,
    p_split_mode: input.splitMode,
    p_shares: input.shares,
    p_actor_member: input.actorMemberId,
  });

  if (error) throw new Error(error.message);
}

/**
 * Soft delete, and its exact inverse. The row stays, excluded from balances
 * and recoverable, because anyone with the link can delete anything and there
 * is no auth to appeal to when they get it wrong.
 */
export async function setExpenseDeleted(input: {
  id: string;
  deleted: boolean;
  actorMemberId: string | null;
}): Promise<void> {
  const { error } = await db.rpc("set_expense_deleted", {
    p_id: input.id,
    p_deleted: input.deleted,
    p_actor_member: input.actorMemberId,
  });
  if (error) throw new Error(error.message);
}
