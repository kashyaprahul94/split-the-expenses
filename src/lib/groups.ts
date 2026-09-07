import { db } from "./supabase";
import type {
  CurrencyCode,
  Expense,
  ExpenseShare,
  Group,
  Member,
  Settlement,
} from "./types";

/**
 * Reads and group/member writes. Server-only: importing ./supabase pulls in
 * `server-only`, so any client component that reaches for this fails the build.
 */

/**
 * A member as the browser is allowed to see them.
 *
 * Deliberately not `Member`: that has `device_key`, and a device key is a
 * capability — whoever holds it *is* that member. Sending the whole member row
 * to every person in the group would hand everyone the means to impersonate
 * everyone else. `claimed` is all the UI actually needs, to show who is still
 * free to pick on the join screen.
 */
export interface MemberView {
  id: string;
  group_id: string;
  name: string;
  claimed: boolean;
  created_at: string;
}

export interface GroupView {
  group: Group;
  members: MemberView[];
  expenses: Expense[];
  shares: ExpenseShare[];
  settlements: Settlement[];
  /** Which member this device is, if it has claimed one. */
  you: string | null;
}

/**
 * PostgREST can hand back a bigint as either a JSON number or a string
 * depending on the path it took. A string would make `a + b` concatenate
 * instead of add, which is exactly the class of bug the integer-money rule
 * exists to prevent, so every amount is coerced on the way in.
 */
const toMinor = (value: unknown): number => {
  const parsed = typeof value === "string" ? Number(value) : (value as number);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Amount is not a safe integer: ${String(value)}`);
  }
  return parsed;
};

interface RawBundle {
  group: Group;
  members: Member[];
  expenses: (Omit<Expense, "amount_minor"> & { amount_minor: unknown })[];
  shares: (Omit<ExpenseShare, "share_minor"> & { share_minor: unknown })[];
  settlements: (Omit<Settlement, "amount_minor"> & { amount_minor: unknown })[];
}

/**
 * One consistent snapshot of a group. Six separate queries can interleave with
 * someone else's write and produce a report whose column totals disagree with
 * its own grand total; a single function call cannot.
 */
export async function getGroupBundle(
  slug: string,
  deviceKey: string | null,
): Promise<GroupView | null> {
  const { data, error } = await db.rpc("group_bundle", { p_slug: slug });

  if (error) throw new Error(`Could not load group: ${error.message}`);
  if (!data) return null;

  const raw = data as RawBundle;

  const you =
    deviceKey === null
      ? null
      : (raw.members.find((member) => member.device_key === deviceKey)?.id ?? null);

  return {
    group: raw.group,
    members: raw.members.map((member) => ({
      id: member.id,
      group_id: member.group_id,
      name: member.name,
      claimed: member.device_key !== null,
      created_at: member.created_at,
    })),
    expenses: raw.expenses.map((expense) => ({
      ...expense,
      amount_minor: toMinor(expense.amount_minor),
    })),
    shares: raw.shares.map((share) => ({
      ...share,
      share_minor: toMinor(share.share_minor),
    })),
    settlements: raw.settlements.map((settlement) => ({
      ...settlement,
      amount_minor: toMinor(settlement.amount_minor),
    })),
    you,
  };
}

export async function getActivity(
  groupId: string,
  limit = 100,
  before: string | null = null,
) {
  const { data, error } = await db.rpc("group_activity", {
    p_group_id: groupId,
    p_limit: limit,
    p_before: before,
  });
  if (error) throw new Error(`Could not load activity: ${error.message}`);
  return data ?? [];
}

/** True if a slug is already taken. Used to retry generation, which will
 * essentially never happen at 60 bits but costs one query to be sure. */
export async function slugExists(slug: string): Promise<boolean> {
  const { count, error } = await db
    .from("groups")
    .select("slug", { count: "exact", head: true })
    .eq("slug", slug);
  if (error) throw new Error(`Could not check slug: ${error.message}`);
  return (count ?? 0) > 0;
}

export async function createGroup(input: {
  id: string;
  slug: string;
  name: string;
  currency: CurrencyCode;
  memberId: string;
  memberName: string;
  deviceKey: string;
}): Promise<void> {
  const { error } = await db.rpc("create_group", {
    p_id: input.id,
    p_slug: input.slug,
    p_name: input.name,
    p_currency: input.currency,
    p_member_id: input.memberId,
    p_member_name: input.memberName,
    p_device_key: input.deviceKey,
  });
  if (error) throw new Error(error.message);
}

export async function addMember(input: {
  id: string;
  groupId: string;
  name: string;
  deviceKey: string | null;
  actorMemberId: string | null;
}): Promise<void> {
  const { error } = await db.rpc("add_member", {
    p_id: input.id,
    p_group_id: input.groupId,
    p_name: input.name,
    p_device_key: input.deviceKey,
    p_actor_member: input.actorMemberId,
  });
  if (error) throw new Error(error.message);
}

export async function renameMember(input: {
  id: string;
  name: string;
  actorMemberId: string | null;
}): Promise<void> {
  const { error } = await db.rpc("rename_member", {
    p_id: input.id,
    p_name: input.name,
    p_actor_member: input.actorMemberId,
  });
  if (error) throw new Error(error.message);
}

export async function claimMember(input: {
  id: string;
  deviceKey: string;
}): Promise<void> {
  const { error } = await db.rpc("claim_member", {
    p_id: input.id,
    p_device_key: input.deviceKey,
  });
  if (error) throw new Error(error.message);
}

export async function setGroupSettings(input: {
  id: string;
  name: string;
  simplifyPayments: boolean;
  actorMemberId: string | null;
}): Promise<void> {
  const { error } = await db.rpc("set_group_settings", {
    p_id: input.id,
    p_name: input.name,
    p_simplify_payments: input.simplifyPayments,
    p_actor_member: input.actorMemberId,
  });
  if (error) throw new Error(error.message);
}
