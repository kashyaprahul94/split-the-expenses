/**
 * Expense categories: a fixed list, with "Other" as the escape hatch.
 *
 * Free text was the old behaviour and it produces "Travel", "travel" and
 * "Trvael" as three different things, which makes the report breakdown
 * useless. A fixed list is the whole point of having categories at all.
 *
 * The stored value is the **id**, lowercase and stable. Labels and icons are
 * presentation and can change without touching a single row.
 *
 * Categories never affect balances — they are report-only — so an unrecognised
 * value is harmless and is shown as Other rather than being rewritten. That
 * matters for rows written before this list existed.
 */

export interface Category {
  id: string;
  label: string;
  /** Shown in a round badge beside the expense, avatar-style. */
  icon: string;
}

export const CATEGORIES: Category[] = [
  { id: "food", label: "Food & drink", icon: "🍽️" },
  { id: "groceries", label: "Groceries", icon: "🛒" },
  { id: "travel", label: "Travel", icon: "🚆" },
  { id: "fuel", label: "Fuel", icon: "⛽" },
  { id: "stay", label: "Stay", icon: "🏨" },
  { id: "tickets", label: "Tickets & entry", icon: "🎟️" },
  { id: "shopping", label: "Shopping", icon: "🛍️" },
  { id: "health", label: "Health", icon: "💊" },
  { id: "utilities", label: "Utilities", icon: "💡" },
  { id: "rent", label: "Rent", icon: "🏠" },
  // Always last, and always present: people need somewhere to put the thing
  // the list did not anticipate.
  { id: "other", label: "Other", icon: "🧾" },
];

export const OTHER: Category = CATEGORIES[CATEGORIES.length - 1];

const byId = new Map(CATEGORIES.map((category) => [category.id, category]));
const byLabel = new Map(
  CATEGORIES.map((category) => [category.label.toLowerCase(), category]),
);

/**
 * The category for a stored value, however it was written.
 *
 * Matches on id first, then on label, both case-insensitively — so "Travel"
 * saved by the old free-text field still resolves to the Travel category
 * rather than falling through to Other.
 */
export function categoryFor(value: string | null | undefined): Category {
  if (!value) return OTHER;
  const key = value.trim().toLowerCase();
  return byId.get(key) ?? byLabel.get(key) ?? OTHER;
}

/** True when a value is one of the known ids. Used by the server to keep new
 * writes on the list without rewriting old rows. */
export function isCategoryId(value: string): boolean {
  return byId.has(value);
}

/** What the form should preselect for an expense being edited. */
export function categoryValue(value: string | null | undefined): string {
  if (!value) return "";
  const key = value.trim().toLowerCase();
  return byId.has(key) ? key : (byLabel.get(key)?.id ?? OTHER.id);
}
