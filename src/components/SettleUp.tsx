"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveSettlementsAction } from "@/app/actions";
import type { Transfer } from "@/lib/balances";
import type { MemberView } from "@/lib/groups";
import { newId } from "@/lib/ids";
import { today } from "@/lib/dates";
import { toInputValue } from "@/lib/money";
import type { CurrencyCode } from "@/lib/types";
import { ErrorNote, Field, inputStyle, primaryButton, quietButton } from "./ui";

/**
 * Records a payment that actually happened. Reached either from the settle-up
 * button or from a proposed transfer, which is why it takes an `initial` —
 * "record" on a suggestion should be one tap, not a form to re-fill.
 */
export function SettleUp({
  slug,
  currency,
  members,
  you,
  initial,
  onDone,
}: {
  slug: string;
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  initial: Transfer;
  onDone: () => void;
}) {
  const router = useRouter();

  const [from, setFrom] = useState(initial.from || you || members[0]?.id || "");
  const [to, setTo] = useState(
    initial.to || members.find((member) => member.id !== you)?.id || "",
  );
  const [amount, setAmount] = useState(
    initial.amount_minor > 0 ? toInputValue(initial.amount_minor, currency) : "",
  );
  const [settledOn, setSettledOn] = useState(
    today(),
  );
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const result = await saveSettlementsAction({
      slug,
      rows: [{ id: newId(), from, to, amount }],
      settledOn,
      note,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    router.refresh();
    onDone();
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Who paid">
          <select
            className={inputStyle}
            value={from}
            onChange={(event) => setFrom(event.target.value)}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.id === you ? " (you)" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Who received">
          <select
            className={inputStyle}
            value={to}
            onChange={(event) => setTo(event.target.value)}
          >
            {members.map((member) => (
              <option key={member.id} value={member.id}>
                {member.name}
                {member.id === you ? " (you)" : ""}
              </option>
            ))}
          </select>
        </Field>
      </div>

      {from === to ? (
        <ErrorNote>A payment needs two different people.</ErrorNote>
      ) : null}

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <input
            className={inputStyle}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
            autoFocus
          />
        </Field>

        <Field label="Date">
          <input
            type="date"
            className={inputStyle}
            value={settledOn}
            onChange={(event) => setSettledOn(event.target.value)}
          />
        </Field>
      </div>

      <Field label="Note" hint="Optional.">
        <input
          className={inputStyle}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="UPI"
          maxLength={500}
        />
      </Field>

      <ErrorNote>{error}</ErrorNote>

      <div className="flex gap-2">
        <button type="button" className={`${quietButton} flex-1`} onClick={onDone}>
          Cancel
        </button>
        <button
          className={`${primaryButton} flex-1`}
          disabled={busy || from === to}
        >
          {busy ? "Recording…" : "Record payment"}
        </button>
      </div>
    </form>
  );
}
