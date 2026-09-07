"use client";

/**
 * Client-side conveniences only.
 *
 * Identity is *not* here: the device key lives in an httpOnly cookie issued by
 * middleware.ts, so the server can resolve who you are while it renders and no
 * page script can read the key. See src/lib/device.ts.
 *
 * What is left is a shortcut list of groups this browser has opened. Losing it
 * loses nothing — the group still lives at its slug — which is why every
 * access can fail silently. Safari in private mode throws on localStorage
 * rather than returning null, so none of this is optional.
 */

const RECENT_GROUPS = "ste.recent-groups";
const RECENT_LIMIT = 10;

export interface RecentGroup {
  slug: string;
  name: string;
  openedAt: number;
}

export function recentGroups(): RecentGroup[] {
  try {
    const raw = window.localStorage.getItem(RECENT_GROUPS);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is RecentGroup =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as RecentGroup).slug === "string" &&
        typeof (entry as RecentGroup).name === "string",
    );
  } catch {
    return [];
  }
}

export function rememberGroup(slug: string, name: string): void {
  try {
    const next = [
      { slug, name, openedAt: Date.now() },
      ...recentGroups().filter((entry) => entry.slug !== slug),
    ].slice(0, RECENT_LIMIT);
    window.localStorage.setItem(RECENT_GROUPS, JSON.stringify(next));
  } catch {
    // A missing shortcut list is not worth surfacing to anyone.
  }
}

export function forgetGroup(slug: string): void {
  try {
    window.localStorage.setItem(
      RECENT_GROUPS,
      JSON.stringify(recentGroups().filter((entry) => entry.slug !== slug)),
    );
  } catch {
    // Same.
  }
}
