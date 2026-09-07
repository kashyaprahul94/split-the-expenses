"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveSettlementAction,
  setSettlementDeletedAction,
} from "@/app/actions";
import type { MemberView } from "@/lib/groups";
import { toInputValue } from "@/lib/money";
import type { CurrencyCode, Settlement } from "@/lib/types";
import { Dialog } from "./Dialog";
import {
  Empty,
  ErrorNote,
  Field,
  formatDate,
  inputStyle,
  Money,
  primaryButton,
  quietButton,
} from "./ui";

export function PaymentList({
  slug,
  currency,
  members,
  you,
  settlements,
}: {
  slug: string;
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  settlements: Settlement[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Settlement | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const label = (memberId: string) => {
    if (memberId === you) return "you";
    return members.find((member) => member.id === memberId)?.name ?? "someone";
  };

  const live = settlements.filter((row) => row.deleted_at === null);
  const deleted = settlements.filter((row) => row.deleted_at !== null);
  const visible = showDeleted ? settlements : live;

  async function setDeleted(settlement: Settlement, deleted: boolean) {
    setBusyId(settlement.id);
    setError("");
    const result = await setSettlementDeletedAction({
      slug,
      settlementId: settlement.id,
      deleted,
    });
    if (!result.ok) setError(result.error);
    else router.refresh();
    setBusyId(null);
  }

  if (settlements.length === 0) {
    return <Empty>No payments recorded yet.</Empty>;
  }

  return (
    <div className="space-y-3">
      <ErrorNote>{error}</ErrorNote>

      <ul className="divide-y divide-black/5 dark:divide-white/10">
        {visible.map((settlement) => {
          const removed = settlement.deleted_at !== null;
          return (
            <li
              key={settlement.id}
              className={`flex items-start gap-3 py-3 ${removed ? "opacity-50" : ""}`}
            >
              <div className="min-w-0 flex-1">
                <p className="text-sm">
                  <span className="font-medium">{label(settlement.from_member)}</span>
                  <span className="opacity-60"> paid </span>
                  <span className="font-medium">{label(settlement.to_member)}</span>
                </p>
                <p className="mt-0.5 text-xs opacity-60">
                  {formatDate(settlement.settled_on)}
                  {settlement.note ? ` · ${settlement.note}` : ""}
                </p>
              </div>

              <div className="flex flex-col items-end gap-1">
                <Money
                  minor={settlement.amount_minor}
                  currency={currency}
                  className="text-sm font-medium"
                />
                <div className="flex gap-2 text-xs">
                  {removed ? (
                    <button
                      className="underline underline-offset-2 disabled:opacity-40"
                      disabled={busyId === settlement.id}
                      onClick={() => setDeleted(settlement, false)}
                    >
                      restore
                    </button>
                  ) : (
                    <>
                      <button
                        className="underline underline-offset-2"
                        onClick={() => setEditing(settlement)}
                      >
                        edit
                      </button>
                      <button
                        className="underline underline-offset-2 disabled:opacity-40"
                        disabled={busyId === settlement.id}
                        onClick={() => setDeleted(settlement, true)}
                      >
                        delete
                      </button>
                    </>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {deleted.length > 0 ? (
        <button
          className={`${quietButton} w-full`}
          onClick={() => setShowDeleted(!showDeleted)}
        >
          {showDeleted
            ? "Hide deleted"
            : `Show ${deleted.length} deleted payment${deleted.length === 1 ? "" : "s"}`}
        </button>
      ) : null}

      <Dialog
        open={editing !== null}
        title="Edit payment"
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <EditPayment
            slug={slug}
            currency={currency}
            members={members}
            you={you}
            settlement={editing}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}

function EditPayment({
  slug,
  currency,
  members,
  you,
  settlement,
  onDone,
}: {
  slug: string;
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  settlement: Settlement;
  onDone: () => void;
}) {
  const router = useRouter();
  const [from, setFrom] = useState(settlement.from_member);
  const [to, setTo] = useState(settlement.to_member);
  const [amount, setAmount] = useState(
    toInputValue(settlement.amount_minor, currency),
  );
  const [settledOn, setSettledOn] = useState(settlement.settled_on);
  const [note, setNote] = useState(settlement.note ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const result = await saveSettlementAction({
      slug,
      id: settlement.id,
      from,
      to,
      amount,
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

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <input
            className={inputStyle}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            inputMode="decimal"
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
          {busy ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}
