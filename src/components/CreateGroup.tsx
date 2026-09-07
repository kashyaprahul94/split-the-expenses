"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createGroupAction } from "@/app/actions";
import { CURRENCIES, CURRENCY_CODES, DEFAULT_CURRENCY } from "@/lib/money";
import { rememberGroup, recentGroups, type RecentGroup } from "@/lib/session";
import type { CurrencyCode } from "@/lib/types";
import {
  ErrorNote,
  Field,
  inputStyle,
  primaryButton,
  Card,
  SectionTitle,
} from "./ui";

export function CreateGroup() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [yourName, setYourName] = useState("");
  const [currency, setCurrency] = useState<CurrencyCode>(DEFAULT_CURRENCY);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const result = await createGroupAction({ name, currency, yourName });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    rememberGroup(result.value.slug, name.trim());
    router.push(`/g/${result.value.slug}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="What is this for?" hint="A trip, a flat, a dinner series.">
        <input
          className={inputStyle}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Goa trip"
          maxLength={80}
          autoFocus
        />
      </Field>

      <Field label="Your name" hint="How the group will see you.">
        <input
          className={inputStyle}
          value={yourName}
          onChange={(event) => setYourName(event.target.value)}
          placeholder="Priya"
          maxLength={60}
        />
      </Field>

      <Field
        label="Currency"
        hint="Fixed once the group has its first expense — every amount is stored in it."
      >
        <select
          className={inputStyle}
          value={currency}
          onChange={(event) => setCurrency(event.target.value as CurrencyCode)}
        >
          {CURRENCY_CODES.map((code) => (
            <option key={code} value={code}>
              {code} {CURRENCIES[code].symbol.trim()}
            </option>
          ))}
        </select>
      </Field>

      <ErrorNote>{error}</ErrorNote>

      <button className={`${primaryButton} w-full`} disabled={busy}>
        {busy ? "Creating…" : "Create group"}
      </button>
    </form>
  );
}

/** Groups this browser has opened before. A convenience only — the link is
 * still the only real way in, and this list is not a substitute for keeping it. */
export function RecentGroups() {
  const [groups, setGroups] = useState<RecentGroup[]>([]);

  useEffect(() => {
    setGroups(recentGroups());
  }, []);

  if (groups.length === 0) return null;

  return (
    <Card>
      <SectionTitle>Recently opened</SectionTitle>
      <ul className="divide-y divide-black/5 dark:divide-white/10">
        {groups.map((group) => (
          <li key={group.slug}>
            <a
              href={`/g/${group.slug}`}
              className="flex items-center justify-between py-2.5 text-sm hover:opacity-70"
            >
              <span className="font-medium">{group.name}</span>
              <span className="opacity-40">→</span>
            </a>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs opacity-50">
        Stored on this device only. Clearing your browser data forgets them, so
        keep the group links somewhere.
      </p>
    </Card>
  );
}
