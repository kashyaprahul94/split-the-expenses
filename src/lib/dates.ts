/**
 * Dates. Every conversion starts from an epoch milliseconds value and is
 * explicit about which timezone it is resolving in.
 *
 * The distinction that matters here: an **instant** and a **calendar date**
 * are different things. `created_at` is an instant — a moment that happened,
 * stored as timestamptz and rendered in whatever zone the reader is in.
 * `spent_on` is a calendar date — "the day of the beach lunch" — and it has to
 * read the same to everyone in the group. Storing that as an epoch would mean
 * a member in London and a member in Mumbai could see the same expense filed
 * under different days, and the report would sort differently for each of
 * them. So it stays a bare `YYYY-MM-DD`.
 *
 * The bug this file exists to kill: `new Date().toISOString().slice(0, 10)`
 * yields the date in **UTC**. At 8pm in New York that is already tomorrow, so
 * an expense defaults to the wrong day. It survives testing anywhere east of
 * Greenwich — IST evening is still the same UTC day — which is exactly why it
 * needed catching by reading rather than by using the app.
 */

/** A calendar date with no time and no zone: "2026-09-07". */
export type CalendarDate = string;

const pad = (value: number): string => String(value).padStart(2, "0");

/**
 * The calendar date an instant falls on, **in the viewer's own timezone**.
 * This is the correct way to answer "what is today".
 */
export function toCalendarDate(epochMs: number): CalendarDate {
  const moment = new Date(epochMs);
  return `${moment.getFullYear()}-${pad(moment.getMonth() + 1)}-${pad(moment.getDate())}`;
}

/** Today, locally. Takes the clock as an argument so it can be tested. */
export function today(now: number = Date.now()): CalendarDate {
  return toCalendarDate(now);
}

/**
 * Local midnight at the start of a calendar date, as epoch ms.
 *
 * Built from parts rather than `new Date("2026-09-07")`, which the spec says
 * to read as UTC midnight — the same off-by-one-day bug wearing a different
 * hat.
 */
export function fromCalendarDate(date: CalendarDate): number {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day).getTime();
}

export function isCalendarDate(value: string): value is CalendarDate {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  // Rejects 2026-02-31, which the regex alone is happy with: constructing it
  // rolls over to March, so the round trip does not match.
  return toCalendarDate(fromCalendarDate(value)) === value;
}

/** "7 Sep 2026" in the reader's locale. */
export function formatCalendarDate(date: CalendarDate): string {
  return new Date(fromCalendarDate(date)).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * An instant, for the activity log: "7 Sep, 14:32". Takes the timestamptz
 * string Postgres returns, which unlike a bare date does carry a zone.
 */
export function formatInstant(timestamp: string): string {
  const moment = new Date(timestamp);
  if (Number.isNaN(moment.getTime())) return "";
  return moment.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** "2 hours ago" for recent activity, falling back to a date once it is old
 * enough that the relative form stops being useful. */
export function formatRelative(timestamp: string, now: number = Date.now()): string {
  const moment = new Date(timestamp).getTime();
  if (Number.isNaN(moment)) return "";

  const seconds = Math.round((now - moment) / 1000);
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;

  return formatInstant(timestamp);
}
