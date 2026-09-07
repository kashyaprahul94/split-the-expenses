import { describe, expect, it } from "vitest";
import fc from "fast-check";
import {
  formatCalendarDate,
  formatRelative,
  fromCalendarDate,
  isCalendarDate,
  toCalendarDate,
  today,
} from "./dates";

describe("toCalendarDate", () => {
  it("resolves an instant in the local zone, not UTC", () => {
    // The bug, pinned. 2026-09-07T23:30 local is a different UTC day for any
    // zone east of Greenwich, and 2026-09-07T00:30 local is a different UTC
    // day for any zone west of it. Both must still report the 7th.
    const lateEvening = new Date(2026, 8, 7, 23, 30).getTime();
    const earlyMorning = new Date(2026, 8, 7, 0, 30).getTime();

    expect(toCalendarDate(lateEvening)).toBe("2026-09-07");
    expect(toCalendarDate(earlyMorning)).toBe("2026-09-07");
  });

  it("pads single digits", () => {
    expect(toCalendarDate(new Date(2026, 0, 5, 12).getTime())).toBe("2026-01-05");
  });

  it("agrees with the local clock's own idea of the date", () => {
    const now = new Date();
    const expected = [
      now.getFullYear(),
      String(now.getMonth() + 1).padStart(2, "0"),
      String(now.getDate()).padStart(2, "0"),
    ].join("-");
    expect(today()).toBe(expected);
  });
});

describe("fromCalendarDate", () => {
  it("lands on local midnight, not UTC midnight", () => {
    const midnight = new Date(fromCalendarDate("2026-09-07"));
    expect(midnight.getHours()).toBe(0);
    expect(midnight.getMinutes()).toBe(0);
    expect(midnight.getDate()).toBe(7);
  });

  it("round-trips any date", () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date(2000, 0, 1), max: new Date(2100, 0, 1) }),
        (moment) => {
          const date = toCalendarDate(moment.getTime());
          expect(toCalendarDate(fromCalendarDate(date))).toBe(date);
        },
      ),
    );
  });

  it("survives a day that crosses a daylight-saving boundary", () => {
    // In zones that observe DST, local midnight on a transition day is still
    // that day. Building from parts handles this; adding 86400000ms would not.
    for (const date of ["2026-03-08", "2026-03-29", "2026-11-01", "2026-10-25"]) {
      expect(toCalendarDate(fromCalendarDate(date))).toBe(date);
    }
  });
});

describe("formatCalendarDate", () => {
  /**
   * These assertions exist to stop anyone reintroducing `toLocaleDateString`.
   * It renders differently on the server and in the browser — Node produced
   * "Sep 2, 2026" while the browser produced "2 Sept 2026" — which React
   * reports as a hydration failure and then re-renders the whole tree.
   */
  it("produces one fixed format, independent of locale", () => {
    expect(formatCalendarDate("2026-09-02")).toBe("2 Sep 2026");
    expect(formatCalendarDate("2026-01-31")).toBe("31 Jan 2026");
    expect(formatCalendarDate("2026-12-25")).toBe("25 Dec 2026");
  });

  it("emits exactly one shape for every month of the year", () => {
    // A strict pattern, so switching back to Intl fails here rather than in a
    // browser: locale output varies in separator, order and month spelling
    // ("Sept"), and none of those match this.
    const shape = /^\d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}$/;
    for (let month = 1; month <= 12; month++) {
      const date = `2026-${String(month).padStart(2, "0")}-15`;
      expect(formatCalendarDate(date)).toMatch(shape);
    }
  });
});

describe("isCalendarDate", () => {
  it("accepts real dates", () => {
    expect(isCalendarDate("2026-09-07")).toBe(true);
    expect(isCalendarDate("2024-02-29")).toBe(true);
  });

  it("rejects malformed and impossible ones", () => {
    for (const bad of [
      "",
      "2026-9-7",
      "07-09-2026",
      "2026-13-01",
      "2026-02-31",
      "2025-02-29",
      "not a date",
    ]) {
      expect(isCalendarDate(bad)).toBe(false);
    }
  });
});

describe("formatRelative", () => {
  const now = new Date(2026, 8, 7, 12, 0).getTime();
  const ago = (ms: number) => new Date(now - ms).toISOString();

  it("describes recent instants in human units", () => {
    expect(formatRelative(ago(5_000), now)).toBe("just now");
    expect(formatRelative(ago(5 * 60_000), now)).toBe("5m ago");
    expect(formatRelative(ago(3 * 3_600_000), now)).toBe("3h ago");
    expect(formatRelative(ago(2 * 86_400_000), now)).toBe("2d ago");
  });

  it("falls back to a date once relative stops being useful", () => {
    expect(formatRelative(ago(30 * 86_400_000), now)).toMatch(/\d/);
    expect(formatRelative(ago(30 * 86_400_000), now)).not.toMatch(/ago/);
  });

  it("does not throw on rubbish", () => {
    expect(formatRelative("nonsense", now)).toBe("");
  });
});
