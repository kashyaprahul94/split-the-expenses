import type { CurrencyCode, SplitMode } from "./types";

/**
 * The shapes that cross from the browser to the server actions.
 *
 * These live apart from actions.ts because a "use server" module may only
 * export async functions, and the client components filling these forms need
 * the types too.
 *
 * No input carries a device key or an actor id: the server reads the device
 * cookie itself, so the client cannot claim to be someone else.
 *
 * Amounts arrive as **raw strings**, exactly as typed. Parsing happens on the
 * server, with the group's currency, so the server is the one that decides
 * what a number means. The client parses the same strings with the same
 * functions to preview the split, but its answer is never trusted.
 */

export interface CreateGroupInput {
  name: string;
  currency: CurrencyCode;
  yourName: string;
}

export interface JoinGroupInput {
  slug: string;
  /** Claim an existing unclaimed member... */
  memberId?: string;
  /** ...or say "I'm someone else" and add one. */
  newName?: string;
}

export interface ExpenseFormInput {
  slug: string;
  /** Generated on the client, because split.ts seeds the remainder rotation
   * from it — the split previewed must be the split saved. */
  id: string;
  title: string;
  description: string;
  amount: string;
  category: string;
  paidBy: string;
  spentOn: string;
  splitMode: SplitMode;
  /** Who is in the split, for `equal`. */
  participants: string[];
  /** member id -> typed amount, for `exact`. */
  exact: Record<string, string>;
  /** member id -> typed percentage, for `percent`. */
  percent: Record<string, string>;
}

export interface SettlementFormInput {
  slug: string;
  rows: { id: string; from: string; to: string; amount: string }[];
  settledOn: string;
  note: string;
}

export interface EditSettlementInput {
  slug: string;
  id: string;
  from: string;
  to: string;
  amount: string;
  settledOn: string;
  note: string;
}

export type ActionResult<T = undefined> =
  | ({ ok: true } & (T extends undefined ? object : { value: T }))
  | { ok: false; error: string };
