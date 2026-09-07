import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/types";

/** Shared presentation bits. Kept deliberately small — this app is a ledger,
 * not a design system. */

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      // An opaque surface token, not a translucent overlay: a frozen table
      // column sits on this colour and must hide the rows scrolling under it.
      className={`rounded-xl border border-line bg-surface p-4 ${className}`}
    >
      {children}
    </section>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-wide uppercase opacity-60">
        {children}
      </h2>
      {action}
    </div>
  );
}

/**
 * Money, always right-aligned and always in tabular figures. Without them the
 * digits are proportionally spaced and a column of amounts reads as noise.
 */
export function Money({
  minor,
  currency,
  signed = false,
  className = "",
}: {
  minor: number;
  currency: CurrencyCode;
  signed?: boolean;
  className?: string;
}) {
  return (
    <span className={`tnum whitespace-nowrap ${className}`}>
      {formatMoney(minor, currency, { signed })}
    </span>
  );
}

/** Green when the group owes you, red when you owe, plain at zero. Colour is
 * never the only signal — the sign and the wording carry it too, for anyone
 * who cannot distinguish the two. */
export function NetAmount({
  minor,
  currency,
}: {
  minor: number;
  currency: CurrencyCode;
}) {
  const tone =
    minor > 0
      ? "text-emerald-700 dark:text-emerald-400"
      : minor < 0
        ? "text-rose-700 dark:text-rose-400"
        : "opacity-60";
  return (
    <span className={`tnum font-medium whitespace-nowrap ${tone}`}>
      {formatMoney(minor, currency, { signed: minor !== 0 })}
    </span>
  );
}

/**
 * The category badge beside an expense: a round avatar-style disc, so the list
 * scans by shape before it is read. Decorative — the category name is already
 * in the line beneath — so it is hidden from screen readers rather than
 * announced as an emoji.
 */
export function CategoryIcon({
  icon,
  label,
  className = "",
}: {
  icon: string;
  label: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-raised text-base leading-none ${className}`}
      title={label}
      aria-hidden="true"
    >
      {icon}
    </span>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm opacity-60">{children}</p>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:bg-rose-950/50 dark:text-rose-200"
    >
      {children}
    </p>
  );
}

export const buttonStyle =
  "inline-flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed";

export const primaryButton = `${buttonStyle} bg-black text-white hover:bg-black/85 dark:bg-white dark:text-black dark:hover:bg-white/85`;

export const quietButton = `${buttonStyle} border border-line hover:bg-raised`;

/** 16px minimum, or iOS Safari zooms the page on focus and never zooms back. */
export const inputStyle =
  "w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base outline-none focus:border-foreground/40";

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{label}</span>
      {children}
      {hint ? <span className="mt-1 block text-xs opacity-60">{hint}</span> : null}
    </label>
  );
}
