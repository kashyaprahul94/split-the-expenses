import { db } from "./supabase";

/**
 * Payment writes. Server-only.
 *
 * Payments are recorded, not merely suggested — including the ones the
 * simplification view proposes, which are meant to be settleable in one tap.
 */

export interface SettlementRow {
  id: string;
  from_member: string;
  to_member: string;
  amount_minor: number;
}

/**
 * Record one or several payments as a single transaction. Paying three people
 * at once is three rows sharing a date, because one row per payee keeps the
 * balance maths uniform — and either all of them land or none do.
 */
export async function saveSettlements(input: {
  groupId: string;
  rows: SettlementRow[];
  settledOn: string;
  note: string | null;
  actorMemberId: string | null;
}): Promise<void> {
  if (input.rows.length === 0) {
    throw new Error("There are no payments to record.");
  }

  for (const row of input.rows) {
    if (row.from_member === row.to_member) {
      throw new Error("A payment cannot be from someone to themselves.");
    }
    if (!Number.isSafeInteger(row.amount_minor) || row.amount_minor <= 0) {
      throw new Error("A payment must be more than zero.");
    }
  }

  const { error } = await db.rpc("save_settlements", {
    p_group_id: input.groupId,
    p_rows: input.rows,
    p_actor_member: input.actorMemberId,
    p_settled_on: input.settledOn,
    p_note: input.note,
  });

  if (error) throw new Error(error.message);
}

/**
 * Correct one recorded payment. Edited singly even though they are written in
 * batches: a wrong amount on one row should not disturb the others it happened
 * to be recorded alongside.
 */
export async function saveSettlement(input: {
  id: string;
  fromMember: string;
  toMember: string;
  amountMinor: number;
  settledOn: string;
  note: string | null;
  actorMemberId: string | null;
}): Promise<void> {
  if (input.fromMember === input.toMember) {
    throw new Error("A payment cannot be from someone to themselves.");
  }
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) {
    throw new Error("A payment must be more than zero.");
  }

  const { error } = await db.rpc("save_settlement", {
    p_id: input.id,
    p_from_member: input.fromMember,
    p_to_member: input.toMember,
    p_amount_minor: input.amountMinor,
    p_settled_on: input.settledOn,
    p_note: input.note,
    p_actor_member: input.actorMemberId,
  });

  if (error) throw new Error(error.message);
}

export async function setSettlementDeleted(input: {
  id: string;
  deleted: boolean;
  actorMemberId: string | null;
}): Promise<void> {
  const { error } = await db.rpc("set_settlement_deleted", {
    p_id: input.id,
    p_deleted: input.deleted,
    p_actor_member: input.actorMemberId,
  });
  if (error) throw new Error(error.message);
}
