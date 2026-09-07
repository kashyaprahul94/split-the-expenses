"use server";

import { revalidatePath } from "next/cache";
import {
  addMember,
  claimMember,
  createGroup,
  getGroupBundle,
  renameMember,
  setGroupSettings,
  slugExists,
  type GroupView,
} from "@/lib/groups";
import { saveExpense, setExpenseDeleted } from "@/lib/expenses";
import {
  saveSettlement,
  saveSettlements,
  setSettlementDeleted,
} from "@/lib/settlements";
import { newId, newSlug } from "@/lib/ids";
import { getDeviceKey } from "@/lib/device";
import { parseAmountMinor, parsePercentBp, isCurrencyCode } from "@/lib/money";
import { computeShares, type SplitInput } from "@/lib/split";
import type {
  ActionResult,
  CreateGroupInput,
  EditSettlementInput,
  ExpenseFormInput,
  JoinGroupInput,
  SettlementFormInput,
} from "@/lib/forms";

/**
 * Every mutation the browser can trigger. This is the whole trust boundary:
 * the client holds no database credentials, so anything it wants done arrives
 * here as an argument and is validated before it touches Postgres.
 *
 * Two rules hold throughout:
 *
 * 1. **Amounts are parsed here**, from the raw string, using the group's
 *    currency. The client previews with the same functions but its arithmetic
 *    is never taken on trust.
 * 2. **The actor is derived from the device key**, never accepted as a
 *    parameter. Otherwise anyone could attribute their edits to someone else,
 *    and the activity log would be worse than useless.
 */

const MAX_TEXT = 200;
const MAX_NOTE = 500;

const clean = (value: string, limit = MAX_TEXT): string =>
  value.trim().slice(0, limit);

/** Errors from Postgres are not written for people. Map the ones a person can
 * actually cause onto something readable, and let the rest through. */
function readableError(problem: unknown): string {
  const message = problem instanceof Error ? problem.message : String(problem);

  if (message.includes("members_name_unique")) {
    return "Someone in this group already has that name.";
  }
  if (message.includes("Someone is already using this name")) {
    return "Someone is already using this name on another device.";
  }
  if (message.includes("groups_slug_shape") || message.includes("groups_slug_key")) {
    return "Could not create the group link. Try again.";
  }
  if (message.includes("does not reconcile") || message.includes("Shares total")) {
    return "The shares do not add up to the total. Nothing was saved.";
  }
  if (message.includes("already has expenses")) {
    return "The currency cannot change once a group has expenses.";
  }
  if (message.includes("violates foreign key constraint")) {
    return "That person is not in this group.";
  }
  return message;
}

/**
 * Loads the group and works out who is acting.
 *
 * The device key comes from the cookie, never from the caller. That is the
 * whole reason actions take no actor argument: a client that could name the
 * actor could pin its edits on somebody else.
 */
async function context(
  slug: string,
): Promise<{ view: GroupView } | { error: string }> {
  const deviceKey = await getDeviceKey();
  const view = await getGroupBundle(slug, deviceKey);
  if (!view) return { error: "That group no longer exists." };
  return { view };
}

// ------------------------------------------------------------- groups ---

export async function createGroupAction(
  input: CreateGroupInput,
): Promise<ActionResult<{ slug: string }>> {
  const name = clean(input.name);
  const yourName = clean(input.yourName, 60);

  if (!name) return { ok: false, error: "Give the group a name." };
  if (!yourName) return { ok: false, error: "Enter your name." };
  if (!isCurrencyCode(input.currency)) {
    return { ok: false, error: "Pick a currency." };
  }

  const deviceKey = await getDeviceKey();
  if (!deviceKey) return { ok: false, error: "Enable cookies to use this app." };

  try {
    // 60 bits of slug makes a collision essentially impossible, but a group
    // landing on someone else's URL is bad enough to be worth one query.
    let slug = newSlug();
    for (let attempt = 0; attempt < 5 && (await slugExists(slug)); attempt++) {
      slug = newSlug();
    }

    await createGroup({
      id: newId(),
      slug,
      name,
      currency: input.currency,
      memberId: newId(),
      memberName: yourName,
      deviceKey,
    });

    return { ok: true, value: { slug } };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

export async function joinGroupAction(
  input: JoinGroupInput,
): Promise<ActionResult> {
  const deviceKey = await getDeviceKey();
  if (!deviceKey) return { ok: false, error: "Enable cookies to use this app." };

  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };
  const { view } = found;

  try {
    if (input.memberId) {
      const target = view.members.find((member) => member.id === input.memberId);
      if (!target) return { ok: false, error: "That person is not in this group." };
      // Claiming an already-claimed member would take the group's history away
      // from whoever is actually using it.
      if (target.claimed && view.you !== target.id) {
        return { ok: false, error: "Someone is already using that name." };
      }
      await claimMember({ id: target.id, deviceKey });
    } else {
      const name = clean(input.newName ?? "", 60);
      if (!name) return { ok: false, error: "Enter your name." };
      await addMember({
        id: newId(),
        groupId: view.group.id,
        name,
        deviceKey,
        actorMemberId: null,
      });
    }

    revalidatePath(`/g/${input.slug}`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

export async function addMemberAction(input: {
  slug: string;
  name: string;
}): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };

  const name = clean(input.name, 60);
  if (!name) return { ok: false, error: "Enter a name." };

  try {
    await addMember({
      id: newId(),
      groupId: found.view.group.id,
      name,
      deviceKey: null,
      actorMemberId: found.view.you,
    });
    revalidatePath(`/g/${input.slug}`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

export async function renameMemberAction(input: {
  slug: string;
  memberId: string;
  name: string;
}): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };

  const name = clean(input.name, 60);
  if (!name) return { ok: false, error: "Enter a name." };
  if (!found.view.members.some((member) => member.id === input.memberId)) {
    return { ok: false, error: "That person is not in this group." };
  }

  try {
    await renameMember({
      id: input.memberId,
      name,
      actorMemberId: found.view.you,
    });
    revalidatePath(`/g/${input.slug}`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

export async function setGroupSettingsAction(input: {
  slug: string;
  name: string;
  simplifyPayments: boolean;
}): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };

  const name = clean(input.name);
  if (!name) return { ok: false, error: "Give the group a name." };

  try {
    await setGroupSettings({
      id: found.view.group.id,
      name,
      simplifyPayments: input.simplifyPayments,
      actorMemberId: found.view.you,
    });
    revalidatePath(`/g/${input.slug}`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

// ----------------------------------------------------------- expenses ---

export async function saveExpenseAction(
  input: ExpenseFormInput,
): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };
  const { view } = found;

  const title = clean(input.title);
  if (!title) return { ok: false, error: "Give the expense a title." };

  const amount = parseAmountMinor(input.amount, view.group.currency);
  if (!amount.ok) return { ok: false, error: amount.error };

  if (!view.members.some((member) => member.id === input.paidBy)) {
    return { ok: false, error: "Choose who paid." };
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.spentOn)) {
    return { ok: false, error: "Choose a date." };
  }

  const inGroup = (memberId: string) =>
    view.members.some((member) => member.id === memberId);

  // Build the split the same way the form previewed it — same functions, same
  // expense id, so the same paisa lands on the same person.
  let split: SplitInput;

  if (input.splitMode === "equal") {
    const participants = input.participants.filter(inGroup);
    if (participants.length === 0) {
      return { ok: false, error: "Pick who this is split between." };
    }
    split = { mode: "equal", member_ids: participants };
  } else if (input.splitMode === "exact") {
    const entries = [];
    for (const [memberId, typed] of Object.entries(input.exact)) {
      if (!inGroup(memberId)) continue;
      const parsed = parseAmountMinor(typed, view.group.currency, {
        allowZero: true,
      });
      if (!parsed.ok) return { ok: false, error: `${parsed.error}.` };
      entries.push({ member_id: memberId, share_minor: parsed.value });
    }
    if (entries.length === 0) {
      return { ok: false, error: "Pick who this is split between." };
    }
    split = { mode: "exact", entries };
  } else {
    const entries = [];
    for (const [memberId, typed] of Object.entries(input.percent)) {
      if (!inGroup(memberId)) continue;
      const parsed = parsePercentBp(typed);
      if (!parsed.ok) return { ok: false, error: `${parsed.error}.` };
      entries.push({ member_id: memberId, percent_bp: parsed.value });
    }
    if (entries.length === 0) {
      return { ok: false, error: "Pick who this is split between." };
    }
    split = { mode: "percent", entries };
  }

  const shares = computeShares(amount.value, split, input.id);
  if (!shares.ok) return { ok: false, error: shares.error };

  try {
    await saveExpense({
      id: input.id,
      groupId: view.group.id,
      title,
      description: clean(input.description, MAX_NOTE) || null,
      amountMinor: amount.value,
      category: clean(input.category, 40) || null,
      paidBy: input.paidBy,
      spentOn: input.spentOn,
      splitMode: input.splitMode,
      shares: shares.value,
      actorMemberId: view.you,
    });

    revalidatePath(`/g/${input.slug}`);
    revalidatePath(`/g/${input.slug}/report`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

export async function setExpenseDeletedAction(input: {
  slug: string;
  expenseId: string;
  deleted: boolean;
}): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };

  if (!found.view.expenses.some((expense) => expense.id === input.expenseId)) {
    return { ok: false, error: "That expense is not in this group." };
  }

  try {
    await setExpenseDeleted({
      id: input.expenseId,
      deleted: input.deleted,
      actorMemberId: found.view.you,
    });
    revalidatePath(`/g/${input.slug}`);
    revalidatePath(`/g/${input.slug}/report`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

// -------------------------------------------------------- settlements ---

export async function saveSettlementsAction(
  input: SettlementFormInput,
): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };
  const { view } = found;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.settledOn)) {
    return { ok: false, error: "Choose a date." };
  }

  const rows = [];
  for (const row of input.rows) {
    const amount = parseAmountMinor(row.amount, view.group.currency);
    if (!amount.ok) return { ok: false, error: amount.error };
    if (row.from === row.to) {
      return { ok: false, error: "A payment needs two different people." };
    }
    if (
      !view.members.some((member) => member.id === row.from) ||
      !view.members.some((member) => member.id === row.to)
    ) {
      return { ok: false, error: "That person is not in this group." };
    }
    rows.push({
      id: row.id,
      from_member: row.from,
      to_member: row.to,
      amount_minor: amount.value,
    });
  }

  if (rows.length === 0) return { ok: false, error: "Nothing to record." };

  try {
    await saveSettlements({
      groupId: view.group.id,
      rows,
      settledOn: input.settledOn,
      note: clean(input.note, MAX_NOTE) || null,
      actorMemberId: view.you,
    });
    revalidatePath(`/g/${input.slug}`);
    revalidatePath(`/g/${input.slug}/report`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

export async function saveSettlementAction(
  input: EditSettlementInput,
): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };
  const { view } = found;

  if (!view.settlements.some((settlement) => settlement.id === input.id)) {
    return { ok: false, error: "That payment is not in this group." };
  }

  const amount = parseAmountMinor(input.amount, view.group.currency);
  if (!amount.ok) return { ok: false, error: amount.error };

  if (
    !view.members.some((member) => member.id === input.from) ||
    !view.members.some((member) => member.id === input.to)
  ) {
    return { ok: false, error: "That person is not in this group." };
  }
  if (input.from === input.to) {
    return { ok: false, error: "A payment needs two different people." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.settledOn)) {
    return { ok: false, error: "Choose a date." };
  }

  try {
    await saveSettlement({
      id: input.id,
      fromMember: input.from,
      toMember: input.to,
      amountMinor: amount.value,
      settledOn: input.settledOn,
      note: clean(input.note, MAX_NOTE) || null,
      actorMemberId: view.you,
    });
    revalidatePath(`/g/${input.slug}`);
    revalidatePath(`/g/${input.slug}/report`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}

export async function setSettlementDeletedAction(input: {
  slug: string;
  settlementId: string;
  deleted: boolean;
}): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };

  if (
    !found.view.settlements.some(
      (settlement) => settlement.id === input.settlementId,
    )
  ) {
    return { ok: false, error: "That payment is not in this group." };
  }

  try {
    await setSettlementDeleted({
      id: input.settlementId,
      deleted: input.deleted,
      actorMemberId: found.view.you,
    });
    revalidatePath(`/g/${input.slug}`);
    revalidatePath(`/g/${input.slug}/report`);
    return { ok: true };
  } catch (problem) {
    return { ok: false, error: readableError(problem) };
  }
}
