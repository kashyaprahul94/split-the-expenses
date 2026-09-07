// Domain types. These mirror the tables in supabase/schema.sql, with one
// deliberate difference: every money field is a plain `number` holding an
// integer count of the currency's minor unit (paise for INR). Never a float,
// never a decimal string. See money.ts for why and for the conversions.

export type CurrencyCode = "INR" | "USD" | "EUR" | "GBP" | "AED" | "JPY";

export type SplitMode = "equal" | "exact" | "percent";

export interface Group {
  id: string;
  slug: string;
  name: string;
  /** Owned by the group, not the expense. Locked once an expense exists. */
  currency: CurrencyCode;
  simplify_payments: boolean;
  created_at: string;
}

export interface Member {
  id: string;
  group_id: string;
  name: string;
  /** Set when a device claims this member. Null means nobody has claimed it. */
  device_key: string | null;
  created_at: string;
}

export interface Expense {
  id: string;
  group_id: string;
  title: string;
  description: string | null;
  amount_minor: number;
  /** Free text, report-only. Never affects balances. */
  category: string | null;
  /** Who actually put the money down. The split says who consumed it. */
  paid_by: string;
  spent_on: string;
  split_mode: SplitMode;
  created_at: string;
  updated_at: string;
  /** Soft delete. A non-null value excludes this expense from all balances. */
  deleted_at: string | null;
}

export interface ExpenseShare {
  id: string;
  expense_id: string;
  member_id: string;
  /** What this member owes for this expense. */
  share_minor: number;
}

export interface Settlement {
  id: string;
  group_id: string;
  from_member: string;
  to_member: string;
  amount_minor: number;
  settled_on: string;
  note: string | null;
  created_at: string;
  deleted_at: string | null;
}

export type ActivityKind =
  | "group_created"
  | "member_added"
  | "member_renamed"
  | "member_claimed"
  | "expense_added"
  | "expense_edited"
  | "expense_deleted"
  | "expense_restored"
  | "settlement_added"
  | "settlement_edited"
  | "settlement_deleted"
  | "settlement_restored"
  | "settings_changed";

export interface Activity {
  id: string;
  group_id: string;
  actor_member: string | null;
  kind: ActivityKind;
  subject_id: string | null;
  summary: string;
  created_at: string;
}

/**
 * The split libraries validate rather than throw, because every failure here
 * is something a person typed and needs to see explained in the form.
 */
export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export const ok = <T,>(value: T): Result<T> => ({ ok: true, value });
export const err = <T,>(error: string): Result<T> => ({ ok: false, error });
