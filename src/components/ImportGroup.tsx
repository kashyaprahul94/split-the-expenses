"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { importGroupAction } from "@/app/actions";
import { parseGroupFile } from "@/lib/portable";
import { formatMoney } from "@/lib/money";
import { rememberGroup } from "@/lib/session";
import { ErrorNote, primaryButton, quietButton } from "./ui";

/**
 * Rebuild a group from a file an export produced.
 *
 * The file is checked in the browser first and a summary shown, so nobody
 * clicks import on the wrong file and finds out afterwards. The server
 * validates it again anyway — the browser's opinion is a courtesy, not a
 * control.
 *
 * Import always creates a *new* group. Restoring must never be able to
 * overwrite the thing you were trying to rescue.
 */
export function ImportGroup() {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function choose(file: File | undefined) {
    setError("");
    setSummary(null);
    setText("");
    if (!file) return;

    const contents = await file.text();
    const parsed = parseGroupFile(contents);

    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }

    const data = parsed.value;
    const live = data.expenses.filter((expense) => !expense.deleted_at);
    const total = live.reduce((sum, expense) => sum + expense.amount_minor, 0);

    setText(contents);
    setSummary(
      `${data.group.name} — ${data.members.length} people, ${live.length} expenses ` +
        `totalling ${formatMoney(total, data.group.currency)}, ` +
        `${data.settlements.filter((row) => !row.deleted_at).length} payments.`,
    );
  }

  async function run() {
    setBusy(true);
    setError("");

    const result = await importGroupAction({ fileText: text });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    rememberGroup(result.value.slug, summary?.split(" — ")[0] ?? "Imported group");
    router.push(`/g/${result.value.slug}`);
  }

  return (
    <div className="space-y-3">
      <input
        ref={fileInput}
        type="file"
        accept=".json,.csv,application/json,text/csv"
        className="hidden"
        onChange={(event) => choose(event.target.files?.[0])}
      />

      <button
        className={`${quietButton} w-full`}
        onClick={() => fileInput.current?.click()}
      >
        Choose a backup file
      </button>

      {summary ? (
        <div className="space-y-3 rounded-lg bg-black/[0.03] p-3 dark:bg-white/5">
          <p className="text-sm">{summary}</p>
          <p className="text-xs opacity-60">
            This creates a new group. Nothing existing is changed or replaced.
          </p>
          <button
            className={`${primaryButton} w-full`}
            disabled={busy}
            onClick={run}
          >
            {busy ? "Importing…" : "Import as a new group"}
          </button>
        </div>
      ) : null}

      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
