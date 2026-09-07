import { isCalendarDate } from "./dates";
import { CURRENCIES, MAX_AMOUNT_MINOR } from "./money";
import { sumShares } from "./split";
import {
  type CurrencyCode,
  type Result,
  type SplitMode,
  err,
  ok,
} from "./types";

/**
 * Taking a whole group out of the app, and putting one back.
 *
 * Two formats, one validator:
 *
 * - **JSON** is the faithful one. Types survive, nesting survives, nothing
 *   depends on column order. This is what a backup should be.
 * - **CSV** is the legible one. One file rather than a zip of six, every row
 *   tagged with a `record_type` in the first column, so it opens in any
 *   spreadsheet — because a backup you cannot open is a backup you will not
 *   check.
 *
 * In both, amounts are **minor units**: 160020, not 1600.20. A spreadsheet
 * that decides `1600.20` is a float and hands back `1600.1999999999998` would
 * quietly corrupt the ledger, which is the one thing this file exists to
 * prevent. CSV carries a human-readable `amount_display` alongside, which the
 * importer ignores.
 *
 * Everything read back is validated. These files have been outside the app —
 * hand-edited, truncated, or written by an older build — so nothing in them is
 * taken on trust, least of all that the shares still add up.
 */

export const EXPORT_FORMAT = "split-the-expenses";
export const EXPORT_VERSION = 1;

export interface GroupExport {
  group: {
    id: string;
    slug: string;
    name: string;
    currency: CurrencyCode;
    simplify_payments: boolean;
  };
  members: { id: string; name: string }[];
  expenses: {
    id: string;
    title: string;
    description: string | null;
    amount_minor: number;
    category: string | null;
    paid_by: string;
    spent_on: string;
    split_mode: SplitMode;
    deleted_at: string | null;
  }[];
  shares: { expense_id: string; member_id: string; share_minor: number }[];
  settlements: {
    id: string;
    from_member: string;
    to_member: string;
    amount_minor: number;
    settled_on: string;
    note: string | null;
    deleted_at: string | null;
  }[];
}

export const CSV_COLUMNS = [
  "record_type",
  "id",
  "name",
  "slug",
  "currency",
  "simplify_payments",
  "title",
  "description",
  "amount_minor",
  "amount_display",
  "category",
  "paid_by",
  "spent_on",
  "split_mode",
  "expense_id",
  "member_id",
  "share_minor",
  "from_member",
  "to_member",
  "settled_on",
  "note",
  "deleted_at",
] as const;

type Column = (typeof CSV_COLUMNS)[number];
type Row = Partial<Record<Column, string>>;

// ------------------------------------------------------------- writing ---

function escapeCell(value: string): string {
  return /[",\n\r]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/** Minor units to a plain decimal, for the human-readable column only. Never
 * read back — see the note at the top of this file. */
function display(amountMinor: number, currency: CurrencyCode): string {
  const exponent = CURRENCIES[currency].exponent;
  const per = 10 ** exponent;
  const whole = Math.floor(Math.abs(amountMinor) / per);
  const fraction = Math.abs(amountMinor) - whole * per;
  const sign = amountMinor < 0 ? "-" : "";
  return exponent === 0
    ? `${sign}${whole}`
    : `${sign}${whole}.${String(fraction).padStart(exponent, "0")}`;
}

export function toGroupJson(data: GroupExport): string {
  return JSON.stringify(
    {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exported_at: new Date().toISOString(),
      ...data,
    },
    null,
    2,
  );
}

export function toGroupCsv(data: GroupExport): string {
  const rows: Row[] = [];
  const currency = data.group.currency;

  rows.push({
    record_type: "group",
    id: data.group.id,
    name: data.group.name,
    slug: data.group.slug,
    currency,
    simplify_payments: data.group.simplify_payments ? "true" : "false",
  });

  for (const member of data.members) {
    rows.push({ record_type: "member", id: member.id, name: member.name });
  }

  for (const expense of data.expenses) {
    rows.push({
      record_type: "expense",
      id: expense.id,
      title: expense.title,
      description: expense.description ?? "",
      amount_minor: String(expense.amount_minor),
      amount_display: display(expense.amount_minor, currency),
      category: expense.category ?? "",
      paid_by: expense.paid_by,
      spent_on: expense.spent_on,
      split_mode: expense.split_mode,
      deleted_at: expense.deleted_at ?? "",
    });
  }

  for (const share of data.shares) {
    rows.push({
      record_type: "share",
      expense_id: share.expense_id,
      member_id: share.member_id,
      share_minor: String(share.share_minor),
      amount_display: display(share.share_minor, currency),
    });
  }

  for (const settlement of data.settlements) {
    rows.push({
      record_type: "settlement",
      id: settlement.id,
      from_member: settlement.from_member,
      to_member: settlement.to_member,
      amount_minor: String(settlement.amount_minor),
      amount_display: display(settlement.amount_minor, currency),
      settled_on: settlement.settled_on,
      note: settlement.note ?? "",
      deleted_at: settlement.deleted_at ?? "",
    });
  }

  return [
    CSV_COLUMNS.join(","),
    ...rows.map((row) =>
      CSV_COLUMNS.map((column) => escapeCell(row[column] ?? "")).join(","),
    ),
  ].join("\n");
}

// ------------------------------------------------------------- reading ---

/**
 * A real CSV reader, not `split(",")`. Notes and titles contain commas,
 * quotes and the occasional newline, and a naive split turns one of those into
 * a silently mangled ledger.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  // Strip a UTF-8 BOM, which Excel writes and which would otherwise become
  // part of the first header name.
  let index = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const endCell = () => {
    row.push(cell);
    cell = "";
  };
  const endRow = () => {
    endCell();
    if (row.some((value) => value !== "")) rows.push(row);
    row = [];
  };

  while (index < text.length) {
    const character = text[index];

    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 2;
          continue;
        }
        quoted = false;
        index += 1;
        continue;
      }
      cell += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      quoted = true;
      index += 1;
    } else if (character === ",") {
      endCell();
      index += 1;
    } else if (character === "\r") {
      index += 1;
    } else if (character === "\n") {
      endRow();
      index += 1;
    } else {
      cell += character;
      index += 1;
    }
  }

  if (cell !== "" || row.length > 0) endRow();
  return rows;
}

const asInteger = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isSafeInteger(value) ? value : null;
  if (typeof value !== "string" || !/^-?\d+$/.test(value.trim())) return null;
  const parsed = Number(value.trim());
  return Number.isSafeInteger(parsed) ? parsed : null;
};

const asText = (value: unknown): string =>
  value === null || value === undefined ? "" : String(value).trim();

/** The loose shape both readers produce, before validation. */
interface RawExport {
  group?: Record<string, unknown>;
  members?: Record<string, unknown>[];
  expenses?: Record<string, unknown>[];
  shares?: Record<string, unknown>[];
  settlements?: Record<string, unknown>[];
}

function csvToRaw(text: string): Result<RawExport> {
  const rows = parseCsv(text);
  if (rows.length === 0) return err("That file is empty.");

  const header = rows[0].map((cell) => cell.trim());
  if (!header.includes("record_type")) {
    return err(
      "That does not look like a Split the Expenses export — no record_type column.",
    );
  }

  const columnAt = new Map(header.map((name, position) => [name, position]));
  const field = (row: string[], column: Column): string =>
    (row[columnAt.get(column) ?? -1] ?? "").trim();

  const raw: RawExport = { members: [], expenses: [], shares: [], settlements: [] };

  for (const row of rows.slice(1)) {
    const kind = field(row, "record_type");

    if (kind === "group") {
      raw.group = {
        id: field(row, "id"),
        slug: field(row, "slug"),
        name: field(row, "name"),
        currency: field(row, "currency") || "INR",
        simplify_payments: field(row, "simplify_payments").toLowerCase() === "true",
      };
    } else if (kind === "member") {
      raw.members!.push({ id: field(row, "id"), name: field(row, "name") });
    } else if (kind === "expense") {
      raw.expenses!.push({
        id: field(row, "id"),
        title: field(row, "title"),
        description: field(row, "description") || null,
        amount_minor: field(row, "amount_minor"),
        category: field(row, "category") || null,
        paid_by: field(row, "paid_by"),
        spent_on: field(row, "spent_on"),
        split_mode: field(row, "split_mode") || "equal",
        deleted_at: field(row, "deleted_at") || null,
      });
    } else if (kind === "share") {
      raw.shares!.push({
        expense_id: field(row, "expense_id"),
        member_id: field(row, "member_id"),
        share_minor: field(row, "share_minor"),
      });
    } else if (kind === "settlement") {
      raw.settlements!.push({
        id: field(row, "id"),
        from_member: field(row, "from_member"),
        to_member: field(row, "to_member"),
        amount_minor: field(row, "amount_minor"),
        settled_on: field(row, "settled_on"),
        note: field(row, "note") || null,
        deleted_at: field(row, "deleted_at") || null,
      });
    }
    // Unknown record types are ignored rather than fatal, so a newer export
    // with an extra kind can still be read by an older build.
  }

  return ok(raw);
}

function jsonToRaw(text: string): Result<RawExport> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err("That file is not valid JSON.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return err("That JSON file is not a group export.");
  }

  const body = parsed as Record<string, unknown>;
  if (body.format !== undefined && body.format !== EXPORT_FORMAT) {
    return err(`That file says it is "${String(body.format)}", not a group export.`);
  }
  if (typeof body.version === "number" && body.version > EXPORT_VERSION) {
    return err(
      `That file was written by a newer version (${body.version}). Update the app first.`,
    );
  }

  const list = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? (value as Record<string, unknown>[]) : [];

  return ok({
    group:
      typeof body.group === "object" && body.group !== null
        ? (body.group as Record<string, unknown>)
        : undefined,
    members: list(body.members),
    expenses: list(body.expenses),
    shares: list(body.shares),
    settlements: list(body.settlements),
  });
}

function validate(raw: RawExport): Result<GroupExport> {
  if (!raw.group) return err("That file has no group in it.");

  const currency = asText(raw.group.currency) || "INR";
  if (!Object.prototype.hasOwnProperty.call(CURRENCIES, currency)) {
    return err(`"${currency}" is not a supported currency.`);
  }
  const name = asText(raw.group.name);
  if (!name) return err("The group has no name.");

  const group: GroupExport["group"] = {
    id: asText(raw.group.id),
    slug: asText(raw.group.slug),
    name,
    currency: currency as CurrencyCode,
    simplify_payments:
      raw.group.simplify_payments === true || raw.group.simplify_payments === "true",
  };

  const members: GroupExport["members"] = [];
  for (const entry of raw.members ?? []) {
    const id = asText(entry.id);
    const memberName = asText(entry.name);
    if (!id || !memberName) return err("A person in the file has no id or no name.");
    members.push({ id, name: memberName });
  }
  if (members.length === 0) return err("That file has nobody in the group.");

  const duplicateName = members.find(
    (member, position) =>
      members.findIndex((other) => other.name === member.name) !== position,
  );
  if (duplicateName) {
    // Names are the identity here and the database enforces it, so catch it
    // now with a message that says which name rather than at the insert.
    return err(`Two people in the file are both called "${duplicateName.name}".`);
  }

  const expenses: GroupExport["expenses"] = [];
  for (const entry of raw.expenses ?? []) {
    const amount = asInteger(entry.amount_minor);
    const title = asText(entry.title);
    const id = asText(entry.id);
    if (!id || !title) return err("An expense in the file has no id or no title.");
    if (amount === null || amount <= 0 || amount > MAX_AMOUNT_MINOR) {
      return err(`"${title}" has an invalid amount: ${asText(entry.amount_minor)}.`);
    }
    const spentOn = asText(entry.spent_on);
    if (!isCalendarDate(spentOn)) {
      return err(`"${title}" has an invalid date: ${spentOn || "(blank)"}.`);
    }
    const splitMode = asText(entry.split_mode) || "equal";
    if (!["equal", "exact", "percent"].includes(splitMode)) {
      return err(`"${title}" has an unknown split mode: ${splitMode}.`);
    }
    expenses.push({
      id,
      title,
      description: asText(entry.description) || null,
      amount_minor: amount,
      category: asText(entry.category) || null,
      paid_by: asText(entry.paid_by),
      spent_on: spentOn,
      split_mode: splitMode as SplitMode,
      deleted_at: asText(entry.deleted_at) || null,
    });
  }

  const shares: GroupExport["shares"] = [];
  for (const entry of raw.shares ?? []) {
    const amount = asInteger(entry.share_minor);
    if (amount === null || amount < 0) {
      return err(`A share has an invalid amount: ${asText(entry.share_minor)}.`);
    }
    shares.push({
      expense_id: asText(entry.expense_id),
      member_id: asText(entry.member_id),
      share_minor: amount,
    });
  }

  const settlements: GroupExport["settlements"] = [];
  for (const entry of raw.settlements ?? []) {
    const amount = asInteger(entry.amount_minor);
    if (amount === null || amount <= 0) {
      return err(`A payment has an invalid amount: ${asText(entry.amount_minor)}.`);
    }
    const settledOn = asText(entry.settled_on);
    if (!isCalendarDate(settledOn)) {
      return err(`A payment has an invalid date: ${settledOn || "(blank)"}.`);
    }
    settlements.push({
      id: asText(entry.id),
      from_member: asText(entry.from_member),
      to_member: asText(entry.to_member),
      amount_minor: amount,
      settled_on: settledOn,
      note: asText(entry.note) || null,
      deleted_at: asText(entry.deleted_at) || null,
    });
  }

  // ---------------------------------------------- referential integrity ---
  const memberIds = new Set(members.map((member) => member.id));
  const expenseIds = new Set(expenses.map((expense) => expense.id));

  for (const expense of expenses) {
    if (!memberIds.has(expense.paid_by)) {
      return err(`"${expense.title}" was paid by somebody who is not in the file.`);
    }
  }
  for (const share of shares) {
    if (!expenseIds.has(share.expense_id)) {
      return err("A share refers to an expense that is not in the file.");
    }
    if (!memberIds.has(share.member_id)) {
      return err("A share refers to somebody who is not in the file.");
    }
  }
  for (const settlement of settlements) {
    if (
      !memberIds.has(settlement.from_member) ||
      !memberIds.has(settlement.to_member)
    ) {
      return err("A payment refers to somebody who is not in the file.");
    }
    if (settlement.from_member === settlement.to_member) {
      return err("A payment goes from somebody to themselves.");
    }
  }

  // The invariant, checked before anything is written. An import that lands a
  // half-correct ledger is worse than one that refuses outright.
  for (const expense of expenses) {
    const owned = shares.filter((share) => share.expense_id === expense.id);
    if (owned.length === 0) {
      return err(`"${expense.title}" has no shares in the file.`);
    }
    const total = sumShares(owned);
    if (total !== expense.amount_minor) {
      return err(
        `"${expense.title}" does not add up: its shares total ${total} but the expense is ${expense.amount_minor} (in minor units).`,
      );
    }
  }

  return ok({ group, members, expenses, shares, settlements });
}

/**
 * Read an export, whichever format it is in. Sniffed rather than trusted to a
 * file extension, because people rename files and browsers lie about types.
 */
export function parseGroupFile(text: string): Result<GroupExport> {
  const trimmed = text.trimStart();
  const raw = trimmed.startsWith("{") ? jsonToRaw(trimmed) : csvToRaw(text);
  if (!raw.ok) return raw;
  return validate(raw.value);
}

export const parseGroupJson = (text: string): Result<GroupExport> => {
  const raw = jsonToRaw(text);
  return raw.ok ? validate(raw.value) : raw;
};

export const parseGroupCsv = (text: string): Result<GroupExport> => {
  const raw = csvToRaw(text);
  return raw.ok ? validate(raw.value) : raw;
};
