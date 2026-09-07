import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  BASIS_POINTS_TOTAL,
  MAX_AMOUNT_MINOR,
  formatMinor,
  formatMoney,
  formatPercentBp,
  parseAmountMinor,
  parsePercentBp,
  toInputValue,
} from "./money";

const unwrap = (result: ReturnType<typeof parseAmountMinor>): number => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.error}`);
  return result.value;
};

describe("parseAmountMinor", () => {
  it("shifts the decimal without touching a float", () => {
    expect(unwrap(parseAmountMinor("100", "INR"))).toBe(10_000);
    expect(unwrap(parseAmountMinor("0.01", "INR"))).toBe(1);
    expect(unwrap(parseAmountMinor("1234.5", "INR"))).toBe(123_450);
    expect(unwrap(parseAmountMinor(".5", "INR"))).toBe(50);
  });

  it("is exact where a float would not be", () => {
    // The canonical IEEE 754 failure: 0.1 + 0.2 !== 0.3.
    const a = unwrap(parseAmountMinor("0.1", "INR"));
    const b = unwrap(parseAmountMinor("0.2", "INR"));
    expect(a + b).toBe(unwrap(parseAmountMinor("0.3", "INR")));

    // 8.11 has no exact double representation; 8.11 * 100 is 810.9999...,
    // which Math.round would rescue but truncation would not. String parsing
    // sidesteps the question entirely.
    expect(unwrap(parseAmountMinor("8.11", "INR"))).toBe(811);
    expect(unwrap(parseAmountMinor("1.15", "USD"))).toBe(115);
  });

  it("accepts what people actually paste", () => {
    expect(unwrap(parseAmountMinor("₹1,234.50", "INR"))).toBe(123_450);
    expect(unwrap(parseAmountMinor(" 1 234 ", "INR"))).toBe(123_400);
    expect(unwrap(parseAmountMinor("+42", "INR"))).toBe(4_200);
  });

  it("rejects rather than silently rounding extra decimals", () => {
    const result = parseAmountMinor("1.234", "INR");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2 decimal places/);
  });

  it("respects the currency's exponent", () => {
    expect(unwrap(parseAmountMinor("100", "JPY"))).toBe(100);
    expect(parseAmountMinor("1.5", "JPY").ok).toBe(false);
  });

  it("rejects junk, blanks, negatives and zero by default", () => {
    for (const bad of ["", "   ", "abc", ".", "1.2.3", "1-2"]) {
      expect(parseAmountMinor(bad, "INR").ok).toBe(false);
    }
    expect(parseAmountMinor("-5", "INR").ok).toBe(false);
    expect(parseAmountMinor("0", "INR").ok).toBe(false);
  });

  it("allows negatives and zero when asked", () => {
    expect(unwrap(parseAmountMinor("-5", "INR", { allowNegative: true }))).toBe(
      -500,
    );
    expect(unwrap(parseAmountMinor("0", "INR", { allowZero: true }))).toBe(0);
  });

  it("refuses amounts that would leave safe-integer range", () => {
    expect(parseAmountMinor("999999999999999999", "INR").ok).toBe(false);
    expect(
      parseAmountMinor(String(MAX_AMOUNT_MINOR / 100 + 1), "INR").ok,
    ).toBe(false);
  });
});

describe("formatMinor", () => {
  it("renders minor units as decimals", () => {
    expect(formatMinor(3_334, "INR")).toBe("33.34");
    expect(formatMinor(1, "INR")).toBe("0.01");
    expect(formatMinor(0, "INR")).toBe("0.00");
    expect(formatMinor(-1, "INR")).toBe("-0.01");
  });

  it("groups INR the Indian way and others the western way", () => {
    expect(formatMinor(123_456_789, "INR")).toBe("12,34,567.89");
    expect(formatMinor(123_456_789, "USD")).toBe("1,234,567.89");
    expect(formatMinor(100_000, "INR")).toBe("1,000.00");
  });

  it("omits the fractional part for zero-exponent currencies", () => {
    expect(formatMinor(1_234, "JPY")).toBe("1,234");
  });

  it("adds a symbol and an explicit sign on request", () => {
    expect(formatMoney(123_450, "INR")).toBe("₹1,234.50");
    expect(formatMinor(500, "INR", { signed: true })).toBe("+5.00");
    expect(formatMinor(-500, "INR", { signed: true })).toBe("-5.00");
  });

  it("drops grouping for CSV so spreadsheets parse the number", () => {
    expect(formatMinor(123_456_789, "INR", { grouping: false })).toBe(
      "1234567.89",
    );
  });
});

describe("money round-trips", () => {
  it("survives format then parse for any storable amount", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: MAX_AMOUNT_MINOR }),
        fc.constantFrom("INR" as const, "USD" as const, "JPY" as const),
        (amountMinor, currency) => {
          const parsed = parseAmountMinor(
            toInputValue(amountMinor, currency),
            currency,
            { allowZero: true },
          );
          expect(parsed.ok).toBe(true);
          if (parsed.ok) expect(parsed.value).toBe(amountMinor);
        },
      ),
    );
  });

  it("survives the grouped display form too", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: MAX_AMOUNT_MINOR }), (amountMinor) => {
        const parsed = parseAmountMinor(formatMoney(amountMinor, "INR"), "INR", {
          allowZero: true,
        });
        expect(parsed.ok).toBe(true);
        if (parsed.ok) expect(parsed.value).toBe(amountMinor);
      }),
    );
  });
});

describe("percentages", () => {
  it("parses to integer basis points", () => {
    const bp = (input: string) => {
      const result = parsePercentBp(input);
      if (!result.ok) throw new Error(result.error);
      return result.value;
    };
    expect(bp("33.33")).toBe(3_333);
    expect(bp("100")).toBe(BASIS_POINTS_TOTAL);
    expect(bp("0")).toBe(0);
    expect(bp("50%")).toBe(5_000);
  });

  it("rejects over 100 and excess precision", () => {
    expect(parsePercentBp("100.01").ok).toBe(false);
    expect(parsePercentBp("1.234").ok).toBe(false);
    expect(parsePercentBp("").ok).toBe(false);
  });

  it("formats without trailing noise", () => {
    expect(formatPercentBp(3_333)).toBe("33.33");
    expect(formatPercentBp(5_000)).toBe("50");
    expect(formatPercentBp(3_330)).toBe("33.3");
    expect(formatPercentBp(3_305)).toBe("33.05");
  });
});
