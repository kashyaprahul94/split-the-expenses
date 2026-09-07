"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { setExpenseDeletedAction } from "@/app/actions";
import type { MemberView } from "@/lib/groups";
import type { CurrencyCode, Expense, ExpenseShare } from "@/lib/types";
import { ExpenseForm } from "./ExpenseForm";
import { Dialog } from "./Dialog";
import { Empty, ErrorNote, Money, formatDate, quietButton } from "./ui";

export function ExpenseList({
  slug,
  currency,
  members,
  you,
  expenses,
  shares,
}: {
  slug: string;
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  expenses: Expense[];
  shares: ExpenseShare[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Expense | null>(null);
  const [showDeleted, setShowDeleted] = useState(false);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const nameOf = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? "someone";

  const live = expenses.filter((expense) => expense.deleted_at === null);
  const deleted = expenses.filter((expense) => expense.deleted_at !== null);
  const visible = showDeleted ? expenses : live;

  async function setDeleted(expense: Expense, deleted: boolean) {
    setBusyId(expense.id);
    setError("");
    const result = await setExpenseDeletedAction({
      slug,
      expenseId: expense.id,
      deleted,
    });
    if (!result.ok) setError(result.error);
    else router.refresh();
    setBusyId(null);
  }

  if (expenses.length === 0) {
    return <Empty>No expenses yet. Add the first one.</Empty>;
  }

  return (
    <div className="space-y-3">
      <ErrorNote>{error}</ErrorNote>

      <ul className="divide-y divide-black/5 dark:divide-white/10">
        {visible.map((expense) => {
          const removed = expense.deleted_at !== null;
          const yourShare = shares.find(
            (share) => share.expense_id === expense.id && share.member_id === you,
          );

          return (
            <li key={expense.id} className={removed ? "opacity-50" : ""}>
              <div className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">
                    {removed ? <s>{expense.title}</s> : expense.title}
                  </p>
                  <p className="mt-0.5 text-xs opacity-60">
                    {nameOf(expense.paid_by)} paid · {formatDate(expense.spent_on)}
                    {expense.category ? ` · ${expense.category}` : ""}
                  </p>
                  {yourShare && !removed ? (
                    <p className="mt-0.5 text-xs opacity-60">
                      your share <Money minor={yourShare.share_minor} currency={currency} />
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-col items-end gap-1">
                  <Money
                    minor={expense.amount_minor}
                    currency={currency}
                    className="text-sm font-medium"
                  />
                  <div className="flex gap-2 text-xs">
                    {removed ? (
                      <button
                        className="underline underline-offset-2 disabled:opacity-40"
                        disabled={busyId === expense.id}
                        onClick={() => setDeleted(expense, false)}
                      >
                        restore
                      </button>
                    ) : (
                      <>
                        <button
                          className="underline underline-offset-2"
                          onClick={() => setEditing(expense)}
                        >
                          edit
                        </button>
                        <button
                          className="underline underline-offset-2 disabled:opacity-40"
                          disabled={busyId === expense.id}
                          onClick={() => setDeleted(expense, true)}
                        >
                          delete
                        </button>
                      </>
                    )}
                  </div>
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
            : `Show ${deleted.length} deleted expense${deleted.length === 1 ? "" : "s"}`}
        </button>
      ) : null}

      <Dialog
        open={editing !== null}
        title="Edit expense"
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <ExpenseForm
            slug={slug}
            currency={currency}
            members={members}
            you={you}
            editing={editing}
            editingShares={shares.filter(
              (share) => share.expense_id === editing.id,
            )}
            onDone={() => setEditing(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
