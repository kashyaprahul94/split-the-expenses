"use client";

import { useMemo } from "react";
import type { MemberBalance } from "@/lib/balances";
import type { MemberView } from "@/lib/groups";
import { formatMinor, formatMoney } from "@/lib/money";
import { formatCalendarDate } from "@/lib/dates";
import { categoryFor } from "@/lib/categories";
import type { CurrencyCode, Expense, ExpenseShare } from "@/lib/types";
import { BalanceTable } from "./BalanceTable";
import { CategoryIcon, Empty, Money, quietButton } from "./ui";

/**
 * One row per expense, one column per member. This is the view that makes a
 * group trust the app, so it gets the details right: amounts right-aligned in
 * tabular figures, the title column pinned while the member columns scroll,
 * and totals that visibly reconcile.
 */
export function ReportTable({
  groupName,
  currency,
  members,
  you,
  expenses,
  shares,
  balances,
}: {
  groupName: string;
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  expenses: Expense[];
  shares: ExpenseShare[];
  balances: MemberBalance[];
}) {
  const live = useMemo(
    () => expenses.filter((expense) => expense.deleted_at === null),
    [expenses],
  );

  const shareFor = useMemo(() => {
    const map = new Map<string, number>();
    for (const share of shares) {
      map.set(`${share.expense_id}\u0000${share.member_id}`, share.share_minor);
    }
    return map;
  }, [shares]);

  const owedTotals = useMemo(() => {
    const totals = new Map<string, number>();
    for (const member of members) totals.set(member.id, 0);
    for (const expense of live) {
      for (const member of members) {
        const amount = shareFor.get(`${expense.id}\u0000${member.id}`) ?? 0;
        totals.set(member.id, (totals.get(member.id) ?? 0) + amount);
      }
    }
    return totals;
  }, [live, members, shareFor]);

  const grandTotal = live.reduce((sum, expense) => sum + expense.amount_minor, 0);
  const columnSum = [...owedTotals.values()].reduce((sum, value) => sum + value, 0);

  function downloadCsv() {
    const header = [
      "Date",
      "Title",
      "Category",
      "Paid by",
      "Amount",
      ...members.map((member) => member.name),
    ];

    const rows = live.map((expense) => [
      expense.spent_on,
      expense.title,
      expense.category ?? "",
      members.find((member) => member.id === expense.paid_by)?.name ?? "",
      // Ungrouped, so a spreadsheet reads it as a number rather than text.
      formatMinor(expense.amount_minor, currency, { grouping: false }),
      ...members.map((member) =>
        formatMinor(shareFor.get(`${expense.id}\u0000${member.id}`) ?? 0, currency, {
          grouping: false,
        }),
      ),
    ]);

    rows.push([
      "",
      "Total",
      "",
      "",
      formatMinor(grandTotal, currency, { grouping: false }),
      ...members.map((member) =>
        formatMinor(owedTotals.get(member.id) ?? 0, currency, { grouping: false }),
      ),
    ]);

    const escape = (cell: string) =>
      /[",\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell;

    const csv = [header, ...rows]
      .map((row) => row.map((cell) => escape(String(cell))).join(","))
      .join("\n");

    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${groupName.replaceAll(/[^\w-]+/g, "-").toLowerCase()}-expenses.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  if (live.length === 0) return <Empty>Nothing to report yet.</Empty>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs opacity-60">
          Each column is what that person owes for the expense.
        </p>
        <button className={`${quietButton} px-3 py-1.5 text-xs`} onClick={downloadCsv}>
          Export CSV
        </button>
      </div>

      {/* Twenty members is twenty columns, so the table scrolls inside its own
          box rather than making the whole page scroll sideways.

          No negative margin on this box. With `-mx-4 px-4` the scrollport
          starts a rem left of the table, so `left: 0` pins the frozen column
          outside the table and rows slide visibly through the gap beside it. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/15">
              <th className="frozen-col py-2 pr-3 text-left font-medium">
                Expense
              </th>
              <th className="px-3 py-2 text-right font-medium whitespace-nowrap">
                Amount
              </th>
              {members.map((member) => (
                <th
                  key={member.id}
                  className="px-3 py-2 text-right font-medium whitespace-nowrap"
                >
                  {member.name}
                  {member.id === you ? " (you)" : ""}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {live.map((expense) => (
              <tr
                key={expense.id}
                className="border-b border-black/5 dark:border-white/10"
              >
                <th
                  scope="row"
                  className="frozen-col max-w-[12rem] truncate py-2 pr-3 text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <CategoryIcon
                      icon={categoryFor(expense.category).icon}
                      label={categoryFor(expense.category).label}
                      className="size-7 text-sm"
                    />
                    <span className="min-w-0">
                      <span className="block truncate">{expense.title}</span>
                      <span className="block text-xs opacity-50">
                        {formatCalendarDate(expense.spent_on)}
                      </span>
                    </span>
                  </span>
                </th>
                <td className="tnum px-3 py-2 text-right">
                  {formatMoney(expense.amount_minor, currency)}
                </td>
                {members.map((member) => {
                  const owed = shareFor.get(`${expense.id}\u0000${member.id}`) ?? 0;
                  const paid = expense.paid_by === member.id;
                  return (
                    <td key={member.id} className="tnum px-3 py-2 text-right">
                      {owed === 0 && !paid ? (
                        <span className="opacity-25">—</span>
                      ) : (
                        <>
                          {owed > 0 ? formatMoney(owed, currency) : null}
                          {paid ? (
                            <span className="block text-xs text-emerald-700 dark:text-emerald-400">
                              paid {formatMoney(expense.amount_minor, currency)}
                            </span>
                          ) : null}
                        </>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-black/20 font-medium dark:border-white/25">
              <th className="frozen-col py-2 pr-3 text-left">
                Total
              </th>
              <td className="tnum px-3 py-2 text-right">
                {formatMoney(grandTotal, currency)}
              </td>
              {members.map((member) => (
                <td key={member.id} className="tnum px-3 py-2 text-right">
                  {formatMoney(owedTotals.get(member.id) ?? 0, currency)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/*
        The reconciliation check, shown rather than assumed. If the columns
        ever stop adding up to the grand total, the person reading this needs
        to know before they act on the numbers.
      */}
      <p
        className={`rounded-lg px-3 py-2 text-xs ${
          columnSum === grandTotal
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
        }`}
      >
        {columnSum === grandTotal ? (
          <>
            Columns add up to{" "}
            <Money minor={columnSum} currency={currency} />, matching the total.
          </>
        ) : (
          <>
            Columns add up to <Money minor={columnSum} currency={currency} /> but
            expenses total <Money minor={grandTotal} currency={currency} />. Do
            not trust these figures — please report this.
          </>
        )}
      </p>

      <div>
        <h2 className="mb-2 text-sm font-semibold">Where everyone stands</h2>
        {/* The same component as the Balances tab, rather than a second
            hand-laid-out version. Inline spans with a gap put each row's
            figures wherever the numbers happened to end, so the columns did
            not line up between rows. A table aligns them by construction. */}
        <BalanceTable
          currency={currency}
          members={members}
          you={you}
          balances={balances}
        />
      </div>
    </div>
  );
}
