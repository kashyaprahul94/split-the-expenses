"use server";

import { revalidatePath } from "next/cache";
import {
  addMember,
  claimMember,
  createGroup,
  getGroupBundle,
  removeMember,
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
import { isCalendarDate } from "@/lib/dates";
import { parseGroupFile } from "@/lib/portable";
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
  if (message.includes("Only the person who created")) {
    return "Only the person who created this group can remove people.";
  }
  if (message.includes("creator cannot be removed")) {
    return "The group creator cannot be removed.";
  }
  if (message.includes("Cannot remove")) {
    return message;
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

      // A member can be on several devices — one person, a phone and a laptop.
      // But attaching to a name someone is already using has to be deliberate,
      // so the UI must confirm it first. Without that gate a mis-tap silently
      // makes you somebody else, and every expense you add lands on them.
      if (target.claimed && view.you !== target.id && !input.confirmShared) {
        return {
          ok: false,
          error: "That name is already set up on another device.",
        };
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

/**
 * Remove someone from the group.
 *
 * Checked here *and* in the database. The check here exists to give a useful
 * message; the one in the database is what actually holds, because this is the
 * only destructive action in the app and it must not depend on the UI having
 * asked nicely.
 */
export async function removeMemberAction(input: {
  slug: string;
  memberId: string;
}): Promise<ActionResult> {
  const found = await context(input.slug);
  if ("error" in found) return { ok: false, error: found.error };
  const { view } = found;

  const target = view.members.find((member) => member.id === input.memberId);
  if (!target) return { ok: false, error: "That person is not in this group." };

  if (view.group.created_by && view.you !== view.group.created_by) {
    return {
      ok: false,
      error: "Only the person who created this group can remove people.",
    };
  }
  if (input.memberId === view.group.created_by) {
    return { ok: false, error: "The group creator cannot be removed." };
  }

  const appearances =
    view.expenses.filter((expense) => expense.paid_by === input.memberId).length +
    view.shares.filter((share) => share.member_id === input.memberId).length +
    view.settlements.filter(
      (settlement) =>
        settlement.from_member === input.memberId ||
        settlement.to_member === input.memberId,
    ).length;

  if (appearances > 0) {
    return {
      ok: false,
      error: `${target.name} appears in ${appearances} expense or payment record${appearances === 1 ? "" : "s"}. Rename them instead — removing them would break every balance.`,
    };
  }

  try {
    await removeMember({ id: input.memberId, actorMemberId: view.you });
    revalidatePath(`/g/${input.slug}`);
    revalidatePath(`/g/${input.slug}/report`);
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

/**
 * Rebuild a group from an exported file.
 *
 * Always creates a **new** group with fresh ids and a fresh slug, never writing
 * over an existing one. Restoring should not be able to destroy the thing you
 * were trying to rescue, and an import that silently merged into a live group
 * would be unrecoverable. If the original still exists, you end up with both
 * and can delete whichever you do not want.
 *
 * Expenses go in through save_expense, so the same reconcile trigger that
 * guards ordinary writes also guards this one. A file cannot smuggle in a
 * ledger that does not add up.
 */
export async function importGroupAction(input: {
  fileText: string;
}): Promise<ActionResult<{ slug: string }>> {
  const parsed = parseGroupFile(input.fileText);
  if (!parsed.ok) return { ok: false, error: parsed.error };

  const data = parsed.value;
  const deviceKey = await getDeviceKey();
  if (!deviceKey) return { ok: false, error: "Enable cookies to use this app." };

  try {
    let slug = newSlug();
    for (let attempt = 0; attempt < 5 && (await slugExists(slug)); attempt++) {
      slug = newSlug();
    }

    const groupId = newId();
    // Ids are regenerated rather than reused, so importing the same file twice
    // cannot collide with itself or with the group it came from.
    const memberIdFor = new Map(
      data.members.map((member) => [member.id, newId()]),
    );

    // The importing device becomes the first member in the file, so whoever
    // restores a backup can immediately use it. They can switch on the join
    // screen if that is not who they are.
    const [first, ...rest] = data.members;

    await createGroup({
      id: groupId,
      slug,
      name: data.group.name,
      currency: data.group.currency,
      memberId: memberIdFor.get(first.id)!,
      memberName: first.name,
      deviceKey,
    });

    for (const member of rest) {
      await addMember({
        id: memberIdFor.get(member.id)!,
        groupId,
        name: member.name,
        deviceKey: null,
        actorMemberId: null,
      });
    }

    for (const expense of data.expenses) {
      const expenseId = newId();
      await saveExpense({
        id: expenseId,
        groupId,
        title: expense.title,
        description: expense.description,
        amountMinor: expense.amount_minor,
        category: expense.category,
        paidBy: memberIdFor.get(expense.paid_by)!,
        spentOn: expense.spent_on,
        splitMode: expense.split_mode,
        shares: data.shares
          .filter((share) => share.expense_id === expense.id)
          .map((share) => ({
            member_id: memberIdFor.get(share.member_id)!,
            share_minor: share.share_minor,
          })),
        actorMemberId: null,
      });

      // Deleted expenses come back deleted. They are excluded from balances
      // either way, but dropping them would lose the group's own history of
      // what it decided to remove.
      if (expense.deleted_at) {
        await setExpenseDeleted({
          id: expenseId,
          deleted: true,
          actorMemberId: null,
        });
      }
    }

    // save_settlements applies one date to the whole batch, so payments are
    // grouped by their own date. Writing them as a single batch would silently
    // move every payment to whichever date happened to come first.
    const byDate = new Map<string, typeof data.settlements>();
    for (const settlement of data.settlements) {
      if (settlement.deleted_at) continue;
      const existing = byDate.get(settlement.settled_on) ?? [];
      existing.push(settlement);
      byDate.set(settlement.settled_on, existing);
    }

    for (const [settledOn, rows] of byDate) {
      await saveSettlements({
        groupId,
        rows: rows.map((settlement) => ({
          id: newId(),
          from_member: memberIdFor.get(settlement.from_member)!,
          to_member: memberIdFor.get(settlement.to_member)!,
          amount_minor: settlement.amount_minor,
        })),
        settledOn,
        // Notes are per row and the batch takes one, so a shared note would be
        // wrong. Individual notes are restored below.
        note: null,
        actorMemberId: null,
      });
    }

    // Restore each payment's own note, which the batch write cannot carry.
    const written = await getGroupBundle(slug, deviceKey);
    if (written) {
      const noted = data.settlements.filter((row) => !row.deleted_at && row.note);
      for (const original of noted) {
        const match = written.settlements.find(
          (candidate) =>
            candidate.note === null &&
            candidate.settled_on === original.settled_on &&
            candidate.amount_minor === original.amount_minor &&
            candidate.from_member === memberIdFor.get(original.from_member) &&
            candidate.to_member === memberIdFor.get(original.to_member),
        );
        if (!match) continue;
        await saveSettlement({
          id: match.id,
          fromMember: match.from_member,
          toMember: match.to_member,
          amountMinor: match.amount_minor,
          settledOn: match.settled_on,
          note: original.note,
          actorMemberId: null,
        });
      }
    }

    if (data.group.simplify_payments) {
      await setGroupSettings({
        id: groupId,
        name: data.group.name,
        simplifyPayments: true,
        actorMemberId: null,
      });
    }

    revalidatePath(`/g/${slug}`);
    return { ok: true, value: { slug } };
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

  // isCalendarDate, not a regex: a regex is happy with 2026-02-31.
  if (!isCalendarDate(input.spentOn)) {
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

  if (!isCalendarDate(input.settledOn)) {
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
  if (!isCalendarDate(input.settledOn)) {
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
