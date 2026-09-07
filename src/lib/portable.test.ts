import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  type GroupExport,
  parseCsv,
  parseGroupCsv,
  parseGroupFile,
  parseGroupJson,
  toGroupCsv,
  toGroupJson,
} from "./portable";
import { computeShares } from "./split";

const sample = (): GroupExport => ({
  group: {
    id: "g1",
    slug: "abcdefgh1234",
    name: "Panchmari 2026",
    currency: "INR",
    simplify_payments: false,
  },
  members: [
    { id: "m1", name: "Rahul" },
    { id: "m2", name: "Suru" },
    { id: "m3", name: "RD" },
  ],
  expenses: [
    {
      id: "e1",
      title: "Train 1",
      description: null,
      amount_minor: 1_600_200,
      category: "Travel",
      paid_by: "m1",
      spent_on: "2026-07-15",
      split_mode: "equal",
      deleted_at: null,
    },
    {
      id: "e2",
      // The things a naive split(",") destroys.
      title: 'Dinner, "the good one"',
      description: "line one\nline two",
      amount_minor: 1_000,
      category: null,
      paid_by: "m2",
      spent_on: "2026-07-16",
      split_mode: "exact",
      deleted_at: "2026-07-20T10:00:00Z",
    },
  ],
  shares: [
    { expense_id: "e1", member_id: "m1", share_minor: 533_400 },
    { expense_id: "e1", member_id: "m2", share_minor: 533_400 },
    { expense_id: "e1", member_id: "m3", share_minor: 533_400 },
    { expense_id: "e2", member_id: "m1", share_minor: 600 },
    { expense_id: "e2", member_id: "m2", share_minor: 400 },
  ],
  settlements: [
    {
      id: "s1",
      from_member: "m2",
      to_member: "m1",
      amount_minor: 533_400,
      settled_on: "2026-07-18",
      note: "UPI, ref #42",
      deleted_at: null,
    },
  ],
});

const unwrap = (result: ReturnType<typeof parseGroupCsv>): GroupExport => {
  if (!result.ok) throw new Error(result.error);
  return result.value;
};

describe("round trips", () => {
  it("survives CSV", () => {
    expect(unwrap(parseGroupCsv(toGroupCsv(sample())))).toEqual(sample());
  });

  it("survives JSON", () => {
    expect(unwrap(parseGroupJson(toGroupJson(sample())))).toEqual(sample());
  });

  it("detects the format without being told", () => {
    expect(unwrap(parseGroupFile(toGroupCsv(sample())))).toEqual(sample());
    expect(unwrap(parseGroupFile(toGroupJson(sample())))).toEqual(sample());
  });

  it("keeps commas, quotes and newlines intact through CSV", () => {
    const restored = unwrap(parseGroupCsv(toGroupCsv(sample())));
    expect(restored.expenses[1].title).toBe('Dinner, "the good one"');
    expect(restored.expenses[1].description).toBe("line one\nline two");
    expect(restored.settlements[0].note).toBe("UPI, ref #42");
  });

  it("keeps amounts as exact integers", () => {
    const restored = unwrap(parseGroupCsv(toGroupCsv(sample())));
    expect(restored.expenses[0].amount_minor).toBe(1_600_200);
    expect(restored.shares[0].share_minor).toBe(533_400);
  });

  it("survives a UTF-8 BOM, which Excel adds", () => {
    expect(unwrap(parseGroupCsv("﻿" + toGroupCsv(sample())))).toEqual(sample());
  });

  it("survives Windows line endings", () => {
    const windows = toGroupCsv(sample()).replaceAll("\n", "\r\n");
    // The embedded newline inside a quoted cell becomes \r\n too, which is
    // still a newline in that cell — so compare everything but that field.
    const restored = unwrap(parseGroupCsv(windows));
    expect(restored.members).toEqual(sample().members);
    expect(restored.expenses[0]).toEqual(sample().expenses[0]);
    expect(restored.shares).toEqual(sample().shares);
  });
});

describe("parseCsv", () => {
  it("handles quotes, embedded separators and doubled quotes", () => {
    expect(parseCsv('a,b\n"x,1","he said ""hi"""')).toEqual([
      ["a", "b"],
      ["x,1", 'he said "hi"'],
    ]);
  });

  it("handles a newline inside a quoted cell", () => {
    expect(parseCsv('a\n"one\ntwo"')).toEqual([["a"], ["one\ntwo"]]);
  });

  it("skips blank lines", () => {
    expect(parseCsv("a\n\n\nb")).toEqual([["a"], ["b"]]);
  });
});

describe("refusing bad files", () => {
  const broken = (change: (data: GroupExport) => void): string => {
    const data = sample();
    change(data);
    return toGroupJson(data);
  };

  it("refuses an expense whose shares do not add up", () => {
    // The invariant. Importing this would produce a ledger that never settles.
    const result = parseGroupJson(
      broken((data) => {
        data.shares[0].share_minor = 1;
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/does not add up/);
  });

  it("refuses an expense with no shares", () => {
    const result = parseGroupJson(
      broken((data) => {
        data.shares = data.shares.filter((share) => share.expense_id !== "e2");
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/no shares/);
  });

  it("refuses references to people who are not in the file", () => {
    const result = parseGroupJson(
      broken((data) => {
        data.expenses[0].paid_by = "ghost";
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not in the file/);
  });

  it("refuses two people with the same name", () => {
    const result = parseGroupJson(
      broken((data) => {
        data.members[1].name = "Rahul";
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/both called/);
  });

  it("refuses impossible dates and amounts", () => {
    expect(parseGroupJson(broken((d) => { d.expenses[0].spent_on = "2026-02-31"; })).ok).toBe(false);
    expect(parseGroupJson(broken((d) => { d.expenses[0].amount_minor = 0; })).ok).toBe(false);
    expect(parseGroupJson(broken((d) => { d.settlements[0].amount_minor = -5; })).ok).toBe(false);
  });

  it("refuses a self-payment", () => {
    const result = parseGroupJson(
      broken((data) => {
        data.settlements[0].to_member = data.settlements[0].from_member;
      }),
    );
    expect(result.ok).toBe(false);
  });

  it("refuses rubbish and empty files", () => {
    expect(parseGroupFile("").ok).toBe(false);
    expect(parseGroupFile("hello world").ok).toBe(false);
    expect(parseGroupJson("{").ok).toBe(false);
    expect(parseGroupJson('{"format":"something-else"}').ok).toBe(false);
  });

  it("refuses a file from a newer version rather than guessing", () => {
    const result = parseGroupJson('{"format":"split-the-expenses","version":99}');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/newer version/);
  });

  it("ignores record types it does not know, so old builds can read new files", () => {
    const csv = toGroupCsv(sample()) + "\nsomething_new,x1,,,,,,,,,,,,,,,,,,,,";
    expect(parseGroupCsv(csv).ok).toBe(true);
  });
});

describe("invariant: any real ledger survives a round trip", () => {
  it("holds for generated groups", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 6 }),
        fc.array(fc.integer({ min: 1, max: 5_000_000 }), { minLength: 1, maxLength: 8 }),
        (memberCount, amounts) => {
          const members = Array.from({ length: memberCount }, (_, i) => ({
            id: `m${i}`,
            name: `Person ${i}`,
          }));

          const expenses: GroupExport["expenses"] = [];
          const shares: GroupExport["shares"] = [];

          amounts.forEach((amount, index) => {
            const id = `e${index}`;
            expenses.push({
              id,
              title: `Expense ${index}`,
              description: null,
              amount_minor: amount,
              category: null,
              paid_by: members[index % members.length].id,
              spent_on: "2026-07-15",
              split_mode: "equal",
              deleted_at: null,
            });
            const computed = computeShares(
              amount,
              { mode: "equal", member_ids: members.map((m) => m.id) },
              id,
            );
            if (computed.ok) {
              for (const share of computed.value) {
                shares.push({
                  expense_id: id,
                  member_id: share.member_id,
                  share_minor: share.share_minor,
                });
              }
            }
          });

          const data: GroupExport = {
            group: {
              id: "g1",
              slug: "abcdefgh1234",
              name: "Generated",
              currency: "INR",
              simplify_payments: false,
            },
            members,
            expenses,
            shares,
            settlements: [],
          };

          expect(unwrap(parseGroupCsv(toGroupCsv(data)))).toEqual(data);
          expect(unwrap(parseGroupJson(toGroupJson(data)))).toEqual(data);
        },
      ),
      { numRuns: 200 },
    );
  });
});
