"use client";

import { useState } from "react";
import type { GroupView } from "@/lib/groups";
import { type GroupExport, toGroupCsv, toGroupJson } from "@/lib/portable";
import { quietButton } from "./ui";

/**
 * Take the whole group out of the app.
 *
 * Done entirely in the browser, from the data already on the page — no request,
 * nothing to fail, and it works even if the server is having a bad day. Which
 * matters, because the moment you most want a backup is the moment things are
 * going wrong.
 */
export function ExportGroup({ view }: { view: GroupView }) {
  const [saved, setSaved] = useState("");

  const data: GroupExport = {
    group: {
      id: view.group.id,
      slug: view.group.slug,
      name: view.group.name,
      currency: view.group.currency,
      simplify_payments: view.group.simplify_payments,
    },
    members: view.members.map((member) => ({
      id: member.id,
      name: member.name,
    })),
    expenses: view.expenses.map((expense) => ({
      id: expense.id,
      title: expense.title,
      description: expense.description,
      amount_minor: expense.amount_minor,
      category: expense.category,
      paid_by: expense.paid_by,
      spent_on: expense.spent_on,
      split_mode: expense.split_mode,
      deleted_at: expense.deleted_at,
    })),
    shares: view.shares.map((share) => ({
      expense_id: share.expense_id,
      member_id: share.member_id,
      share_minor: share.share_minor,
    })),
    settlements: view.settlements.map((settlement) => ({
      id: settlement.id,
      from_member: settlement.from_member,
      to_member: settlement.to_member,
      amount_minor: settlement.amount_minor,
      settled_on: settlement.settled_on,
      note: settlement.note,
      deleted_at: settlement.deleted_at,
    })),
  };

  function download(kind: "json" | "csv") {
    const text = kind === "json" ? toGroupJson(data) : toGroupCsv(data);
    const stem = view.group.name
      .replaceAll(/[^\w-]+/g, "-")
      .replace(/^-|-$/g, "")
      .toLowerCase();
    const stamp = new Date().toISOString().slice(0, 10);

    const blob = new Blob([text], {
      type: kind === "json" ? "application/json" : "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${stem || "group"}-${stamp}.${kind}`;
    link.click();
    URL.revokeObjectURL(url);

    setSaved(kind);
    setTimeout(() => setSaved(""), 2500);
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <button className={`${quietButton} flex-1`} onClick={() => download("json")}>
          {saved === "json" ? "Saved" : "Export JSON"}
        </button>
        <button className={`${quietButton} flex-1`} onClick={() => download("csv")}>
          {saved === "csv" ? "Saved" : "Export CSV"}
        </button>
      </div>
      <p className="text-xs leading-relaxed opacity-60">
        A complete copy of this group: everyone in it, every expense and how it
        was split, and every payment. JSON is the exact one — import it to
        rebuild the group. CSV holds the same rows and opens in a spreadsheet.
        Both keep amounts as whole paise, so nothing can round on the way out.
      </p>
    </div>
  );
}
