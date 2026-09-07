import { type CurrencyCode, type Result, err, ok } from "./types";

/**
 * Money is an integer count of the currency's minor unit, everywhere.
 *
 * `0.1 + 0.2 !== 0.3` in IEEE 754. An expense app that drifts by fractions of
 * a paisa across fifty expenses produces balances that do not zero out, which
 * destroys the only thing the app is for. So there is no float money in this
 * codebase — not in the database, not in TypeScript, not in transit.
 *
 * The two functions below are the *only* border crossings: a string a person
 * typed comes in through `parseAmountMinor`, and a string a person reads goes
 * out through `formatMinor`. Both do their arithmetic on integers and strings.
 * Notably neither one divides by 100.
 */

interface CurrencyInfo {
  /** Digits after the decimal point. JPY has none; most have two. */
  exponent: number;
  symbol: string;
  /** INR groups as 1,23,456.78 — last three digits, then pairs. */
  grouping: "western" | "indian";
}

export const CURRENCIES: Record<CurrencyCode, CurrencyInfo> = {
  INR: { exponent: 2, symbol: "₹", grouping: "indian" },
  USD: { exponent: 2, symbol: "$", grouping: "western" },
  EUR: { exponent: 2, symbol: "€", grouping: "western" },
  GBP: { exponent: 2, symbol: "£", grouping: "western" },
  AED: { exponent: 2, symbol: "AED ", grouping: "western" },
  JPY: { exponent: 0, symbol: "¥", grouping: "western" },
};

export const DEFAULT_CURRENCY: CurrencyCode = "INR";

export const CURRENCY_CODES = Object.keys(CURRENCIES) as CurrencyCode[];

export function isCurrencyCode(value: string): value is CurrencyCode {
  return Object.prototype.hasOwnProperty.call(CURRENCIES, value);
}

/**
 * ~₹10 billion in paise. Well inside Number.MAX_SAFE_INTEGER even after the
 * multiplications in split.ts, so integer arithmetic stays exact. Anything
 * above this is a typo, not an expense.
 */
export const MAX_AMOUNT_MINOR = 1_000_000_000_000;

export function minorPerUnit(currency: CurrencyCode): number {
  return 10 ** CURRENCIES[currency].exponent;
}

interface ParseOptions {
  /** Settlements and expenses are always positive; only tests want negatives. */
  allowNegative?: boolean;
  /** Reject 0. Every caller so far wants this, so it defaults on. */
  allowZero?: boolean;
}

/**
 * "1,234.5" -> 123450 paise. Returns an error message rather than throwing,
 * because every failure here is something a person typed into a form.
 *
 * Too many decimal places is an error, never a silent round: rounding
 * someone's input without telling them is how money quietly goes missing.
 */
export function parseAmountMinor(
  input: string,
  currency: CurrencyCode,
  options: ParseOptions = {},
): Result<number> {
  const { allowNegative = false, allowZero = false } = options;
  const { exponent, symbol } = CURRENCIES[currency];

  // Strip what people paste or type out of habit: the symbol, thousands
  // separators, spaces (including the non-breaking kind copied from web pages).
  let text = input
    .replace(symbol, "")
    .replace(/[,\s ]/g, "")
    .trim();

  if (text === "") return err("Enter an amount");

  let negative = false;
  if (text.startsWith("-")) {
    negative = true;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  if (!/^\d*(\.\d*)?$/.test(text) || text === "." || text === "") {
    return err("That is not a number");
  }

  const [whole, fraction = ""] = text.split(".");

  if (fraction.length > exponent) {
    return err(
      exponent === 0
        ? `${currency} amounts cannot have decimals`
        : `At most ${exponent} decimal place${exponent === 1 ? "" : "s"}`,
    );
  }

  // The whole point: build the integer by string concatenation, so no float
  // ever holds the value. Padding the fraction is the decimal shift.
  const digits = (whole === "" ? "0" : whole) + fraction.padEnd(exponent, "0");

  // Guard before Number(): a long digit string silently loses precision.
  if (digits.replace(/^0+/, "").length > 15) {
    return err("That amount is too large");
  }

  const magnitude = Number(digits);
  if (!Number.isSafeInteger(magnitude)) return err("That amount is too large");
  if (magnitude > MAX_AMOUNT_MINOR) return err("That amount is too large");

  if (magnitude === 0 && !allowZero) return err("Amount must be more than zero");
  if (negative && magnitude !== 0 && !allowNegative) {
    return err("Amount cannot be negative");
  }

  return ok(negative ? -magnitude : magnitude);
}

function groupDigits(whole: string, style: "western" | "indian"): string {
  if (style === "western") {
    return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  }
  // Indian: the last three digits stand alone, everything before them pairs up.
  if (whole.length <= 3) return whole;
  const last3 = whole.slice(-3);
  const rest = whole.slice(0, -3);
  return rest.replace(/\B(?=(\d{2})+(?!\d))/g, ",") + "," + last3;
}

interface FormatOptions {
  /** Prefix the currency symbol. */
  symbol?: boolean;
  /** Thousands separators. Off for CSV, so spreadsheets parse the number. */
  grouping?: boolean;
  /** Force a leading + on positives. Useful for net balance displays. */
  signed?: boolean;
}

/**
 * 123450 paise -> "1,234.50". Display only, and still no division: the whole
 * and fractional parts are pulled out with integer ops and joined as strings.
 */
export function formatMinor(
  amountMinor: number,
  currency: CurrencyCode,
  options: FormatOptions = {},
): string {
  const { symbol = false, grouping = true, signed = false } = options;
  const info = CURRENCIES[currency];
  const per = minorPerUnit(currency);

  const negative = amountMinor < 0;
  const magnitude = Math.abs(amountMinor);

  const whole = Math.floor(magnitude / per);
  const fraction = magnitude - whole * per;

  const wholeText = grouping
    ? groupDigits(String(whole), info.grouping)
    : String(whole);

  const body =
    info.exponent === 0
      ? wholeText
      : `${wholeText}.${String(fraction).padStart(info.exponent, "0")}`;

  const sign = negative ? "-" : signed && amountMinor > 0 ? "+" : "";

  return `${sign}${symbol ? info.symbol : ""}${body}`;
}

/** "₹1,234.50" — the everyday display form. */
export function formatMoney(
  amountMinor: number,
  currency: CurrencyCode,
  options: Omit<FormatOptions, "symbol"> = {},
): string {
  return formatMinor(amountMinor, currency, { ...options, symbol: true });
}

/**
 * The form-field representation of a stored amount: no symbol, no grouping,
 * so it round-trips through parseAmountMinor unchanged.
 */
export function toInputValue(
  amountMinor: number,
  currency: CurrencyCode,
): string {
  return formatMinor(amountMinor, currency, { grouping: false });
}

/**
 * Percentages are held as integer basis points (1% = 100bp) for the same
 * reason amounts are held as minor units. 33.33% -> 3333.
 */
export const BASIS_POINTS_TOTAL = 10_000;

export function parsePercentBp(input: string): Result<number> {
  const text = input.replace(/[%\s ]/g, "").trim();
  if (text === "") return err("Enter a percentage");
  if (!/^\d*(\.\d*)?$/.test(text) || text === ".") {
    return err("That is not a number");
  }

  const [whole, fraction = ""] = text.split(".");
  if (fraction.length > 2) return err("At most 2 decimal places");

  const bp = Number((whole === "" ? "0" : whole) + fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(bp)) return err("That percentage is too large");
  if (bp > BASIS_POINTS_TOTAL) return err("Cannot be more than 100%");

  return ok(bp);
}

export function formatPercentBp(bp: number): string {
  const whole = Math.floor(Math.abs(bp) / 100);
  const fraction = Math.abs(bp) - whole * 100;
  const sign = bp < 0 ? "-" : "";
  return fraction === 0
    ? `${sign}${whole}`
    : `${sign}${whole}.${String(fraction).padStart(2, "0").replace(/0$/, "")}`;
}
