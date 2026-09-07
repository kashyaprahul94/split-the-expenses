"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { saveExpenseAction } from "@/app/actions";
import type { MemberView } from "@/lib/groups";
import { newId } from "@/lib/ids";
import { today } from "@/lib/dates";
import {
  formatMinor,
  formatMoney,
  parseAmountMinor,
  parsePercentBp,
  toInputValue,
} from "@/lib/money";
import { computeShares, exactRemainder, SPLIT_MODE_LABELS } from "@/lib/split";
import type { CurrencyCode, Expense, ExpenseShare, SplitMode } from "@/lib/types";
import {
  ErrorNote,
  Field,
  inputStyle,
  primaryButton,
  quietButton,
} from "./ui";

const CATEGORIES = ["food", "travel", "stay", "groceries", "drinks", "other"];

export function ExpenseForm({
  slug,
  currency,
  members,
  you,
  editing,
  editingShares,
  onDone,
}: {
  slug: string;
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  editing?: Expense;
  editingShares?: ExpenseShare[];
  onDone: () => void;
}) {
  const router = useRouter();

  /**
   * Generated once, before anything is saved. split.ts seeds its remainder
   * rotation from the expense id, so the id has to exist while the form is
   * previewing — otherwise the split shown and the split saved could put the
   * odd paisa on different people.
   */
  const [id] = useState(() => editing?.id ?? newId());

  const [title, setTitle] = useState(editing?.title ?? "");
  const [amount, setAmount] = useState(
    editing ? toInputValue(editing.amount_minor, currency) : "",
  );
  const [description, setDescription] = useState(editing?.description ?? "");
  const [category, setCategory] = useState(editing?.category ?? "");
  const [paidBy, setPaidBy] = useState(
    editing?.paid_by ?? you ?? members[0]?.id ?? "",
  );
  const [spentOn, setSpentOn] = useState(
    editing?.spent_on ?? today(),
  );
  const [splitMode, setSplitMode] = useState<SplitMode>(
    editing?.split_mode ?? "equal",
  );

  const [participants, setParticipants] = useState<string[]>(() =>
    editing && editingShares
      ? editingShares.map((share) => share.member_id)
      : members.map((member) => member.id),
  );

  const [exact, setExact] = useState<Record<string, string>>(() => {
    if (!editing || !editingShares || editing.split_mode !== "exact") return {};
    return Object.fromEntries(
      editingShares.map((share) => [
        share.member_id,
        toInputValue(share.share_minor, currency),
      ]),
    );
  });

  const [percent, setPercent] = useState<Record<string, string>>(() => {
    if (!editing || !editingShares || editing.split_mode !== "percent") return {};
    // Percentages are not stored — only the amounts they produced — so they are
    // recovered from the shares. Rounding means the recovered figures can be a
    // hundredth out; the amounts themselves are exact either way.
    return Object.fromEntries(
      editingShares.map((share) => [
        share.member_id,
        ((share.share_minor / editing.amount_minor) * 100).toFixed(2),
      ]),
    );
  });

  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const totalMinor = useMemo(() => {
    const parsed = parseAmountMinor(amount, currency);
    return parsed.ok ? parsed.value : null;
  }, [amount, currency]);

  /** The live preview, computed with exactly the functions the server will
   * use — same inputs, same expense id, same answer. */
  const preview = useMemo(() => {
    if (totalMinor === null) return null;

    if (splitMode === "equal") {
      if (participants.length === 0) return null;
      return computeShares(totalMinor, { mode: "equal", member_ids: participants }, id);
    }

    if (splitMode === "exact") {
      const entries = [];
      for (const [memberId, typed] of Object.entries(exact)) {
        const parsed = parseAmountMinor(typed, currency, { allowZero: true });
        if (!parsed.ok) return null;
        entries.push({ member_id: memberId, share_minor: parsed.value });
      }
      if (entries.length === 0) return null;
      return computeShares(totalMinor, { mode: "exact", entries }, id);
    }

    const entries = [];
    for (const [memberId, typed] of Object.entries(percent)) {
      const parsed = parsePercentBp(typed);
      if (!parsed.ok) return null;
      entries.push({ member_id: memberId, percent_bp: parsed.value });
    }
    if (entries.length === 0) return null;
    return computeShares(totalMinor, { mode: "percent", entries }, id);
  }, [totalMinor, splitMode, participants, exact, percent, currency, id]);

  /** The running difference for `exact`. Off-by-one-paisa is miserable to fix
   * by hand, so it is shown continuously and there is a button to absorb it. */
  const shortfall = useMemo(() => {
    if (totalMinor === null || splitMode !== "exact") return null;
    const entries = [];
    for (const typed of Object.values(exact)) {
      const parsed = parseAmountMinor(typed, currency, { allowZero: true });
      if (!parsed.ok) return null;
      entries.push({ share_minor: parsed.value });
    }
    return exactRemainder(totalMinor, entries);
  }, [totalMinor, splitMode, exact, currency]);

  const percentTotalBp = useMemo(() => {
    if (splitMode !== "percent") return null;
    let sum = 0;
    for (const typed of Object.values(percent)) {
      const parsed = parsePercentBp(typed);
      if (!parsed.ok) return null;
      sum += parsed.value;
    }
    return sum;
  }, [splitMode, percent]);

  function toggleParticipant(memberId: string) {
    setParticipants((current) =>
      current.includes(memberId)
        ? current.filter((entry) => entry !== memberId)
        : [...current, memberId],
    );
  }

  function absorbShortfall(memberId: string) {
    if (shortfall === null || totalMinor === null) return;
    const currentText = exact[memberId] ?? "0";
    const parsed = parseAmountMinor(currentText, currency, { allowZero: true });
    const current = parsed.ok ? parsed.value : 0;
    setExact({ ...exact, [memberId]: toInputValue(current + shortfall, currency) });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");

    const result = await saveExpenseAction({
      slug,
      id,
      title,
      description,
      amount,
      category,
      paidBy,
      spentOn,
      splitMode,
      participants,
      exact,
      percent,
    });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    router.refresh();
    onDone();
  }

  const shareOf = (memberId: string): number | null => {
    if (!preview?.ok) return null;
    return (
      preview.value.find((share) => share.member_id === memberId)?.share_minor ??
      null
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="What was it?">
        <input
          className={inputStyle}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Dinner at Souza Lobo"
          maxLength={200}
          autoFocus
        />
      </Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Amount">
          <input
            className={inputStyle}
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder="0.00"
            inputMode="decimal"
          />
        </Field>

        <Field label="Date">
          <input
            type="date"
            className={inputStyle}
            value={spentOn}
            onChange={(event) => setSpentOn(event.target.value)}
          />
        </Field>
      </div>

      <Field label="Paid by" hint="Who actually put the money down.">
        <select
          className={inputStyle}
          value={paidBy}
          onChange={(event) => setPaidBy(event.target.value)}
        >
          {members.map((member) => (
            <option key={member.id} value={member.id}>
              {member.name}
              {member.id === you ? " (you)" : ""}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Category" hint="Optional. Only used in the report.">
        <input
          className={inputStyle}
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          list="expense-categories"
          placeholder="food"
          maxLength={40}
        />
        <datalist id="expense-categories">
          {CATEGORIES.map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
      </Field>

      {/* ------------------------------------------------------- splitting -- */}
      <div>
        <span className="mb-1.5 block text-sm font-medium">Split</span>

        <div className="mb-3 flex gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/10">
          {(["equal", "exact", "percent"] as SplitMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setSplitMode(mode)}
              className={`flex-1 rounded-md px-2 py-1.5 text-sm transition ${
                splitMode === mode
                  ? "bg-white shadow-sm dark:bg-black/50"
                  : "opacity-60 hover:opacity-100"
              }`}
            >
              {SPLIT_MODE_LABELS[mode]}
            </button>
          ))}
        </div>

        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {members.map((member) => {
            const share = shareOf(member.id);
            const included =
              splitMode === "equal"
                ? participants.includes(member.id)
                : splitMode === "exact"
                  ? member.id in exact
                  : member.id in percent;

            return (
              <li key={member.id} className="flex items-center gap-3 py-2">
                {splitMode === "equal" ? (
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={included}
                    onChange={() => toggleParticipant(member.id)}
                    aria-label={`Include ${member.name}`}
                  />
                ) : (
                  <input
                    type="checkbox"
                    className="size-4 shrink-0"
                    checked={included}
                    aria-label={`Include ${member.name}`}
                    onChange={() => {
                      if (splitMode === "exact") {
                        const next = { ...exact };
                        if (included) delete next[member.id];
                        else next[member.id] = "";
                        setExact(next);
                      } else {
                        const next = { ...percent };
                        if (included) delete next[member.id];
                        else next[member.id] = "";
                        setPercent(next);
                      }
                    }}
                  />
                )}

                <span className="min-w-0 flex-1 truncate text-sm">
                  {member.name}
                  {member.id === you ? (
                    <span className="opacity-50"> (you)</span>
                  ) : null}
                </span>

                {splitMode === "equal" ? (
                  <span className="tnum text-sm opacity-70">
                    {share === null ? "—" : formatMoney(share, currency)}
                  </span>
                ) : splitMode === "exact" ? (
                  <input
                    className={`${inputStyle} tnum w-28 text-right`}
                    value={exact[member.id] ?? ""}
                    disabled={!included}
                    inputMode="decimal"
                    placeholder="0.00"
                    onChange={(event) =>
                      setExact({ ...exact, [member.id]: event.target.value })
                    }
                    aria-label={`${member.name}'s amount`}
                  />
                ) : (
                  <span className="flex items-center gap-1.5">
                    <input
                      className={`${inputStyle} tnum w-20 text-right`}
                      value={percent[member.id] ?? ""}
                      disabled={!included}
                      inputMode="decimal"
                      placeholder="0"
                      onChange={(event) =>
                        setPercent({ ...percent, [member.id]: event.target.value })
                      }
                      aria-label={`${member.name}'s percentage`}
                    />
                    <span className="text-sm opacity-60">%</span>
                    <span className="tnum w-20 text-right text-sm opacity-70">
                      {share === null ? "—" : formatMoney(share, currency)}
                    </span>
                  </span>
                )}
              </li>
            );
          })}
        </ul>

        {/* The running difference, and a one-tap way to make it go away. */}
        {splitMode === "exact" && shortfall !== null && shortfall !== 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
            <span className="tnum">
              {shortfall > 0
                ? `${formatMinor(shortfall, currency, { symbol: true })} left to assign`
                : `${formatMinor(-shortfall, currency, { symbol: true })} over`}
            </span>
            {you && you in exact ? (
              <button
                type="button"
                className="ml-auto underline underline-offset-2"
                onClick={() => absorbShortfall(you)}
              >
                put it on me
              </button>
            ) : null}
          </div>
        ) : null}

        {splitMode === "percent" && percentTotalBp !== null && percentTotalBp !== 10000 ? (
          <p className="tnum mt-2 rounded-lg bg-amber-50 px-3 py-2 text-sm dark:bg-amber-950/40">
            Percentages add up to {(percentTotalBp / 100).toFixed(2)}%, not 100%.
          </p>
        ) : null}
      </div>

      <Field label="Note" hint="Optional.">
        <input
          className={inputStyle}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={500}
        />
      </Field>

      <ErrorNote>{error}</ErrorNote>

      <div className="flex gap-2">
        <button type="button" className={`${quietButton} flex-1`} onClick={onDone}>
          Cancel
        </button>
        <button className={`${primaryButton} flex-1`} disabled={busy}>
          {busy ? "Saving…" : editing ? "Save changes" : "Add expense"}
        </button>
      </div>
    </form>
  );
}
