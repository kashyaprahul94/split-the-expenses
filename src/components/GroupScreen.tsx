"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { MemberBalance, GroupTotals, Transfer } from "@/lib/balances";
import type { GroupView } from "@/lib/groups";
import { rememberGroup } from "@/lib/session";
import { Balances } from "./Balances";
import { Dialog } from "./Dialog";
import { ExpenseForm } from "./ExpenseForm";
import { ExpenseList } from "./ExpenseList";
import { GroupSettings, SharePanel } from "./GroupSettings";
import { PaymentList } from "./PaymentList";
import { Card, Money, SectionTitle, primaryButton, quietButton } from "./ui";

type Tab = "expenses" | "balances" | "payments";

export function GroupScreen({
  view,
  balances,
  transfers,
  totals,
}: {
  view: GroupView;
  balances: MemberBalance[];
  transfers: Transfer[];
  totals: GroupTotals;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("expenses");
  const [adding, setAdding] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [settings, setSettings] = useState(false);

  const { group, members, expenses, shares, settlements, you } = view;

  useEffect(() => {
    rememberGroup(group.slug, group.name);
  }, [group.slug, group.name]);

  /**
   * The database is the source of truth and there is no realtime, so the app
   * re-reads when the tab comes back to the foreground. That covers the case
   * that actually happens: two people adding expenses at the same table, one
   * of them looking at a stale screen.
   */
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") router.refresh();
    };
    document.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      document.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [router]);

  const yourBalance = balances.find((balance) => balance.member_id === you);

  return (
    <main className="mx-auto w-full max-w-2xl space-y-4 p-4 pb-24">
      <header className="flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {group.name}
          </h1>
          <p className="mt-0.5 text-xs opacity-60">
            {totals.member_count} people · {totals.expense_count} expenses ·{" "}
            <Money minor={totals.total_minor} currency={group.currency} /> total
          </p>
        </div>
        <div className="flex shrink-0 gap-1">
          <button
            className={`${quietButton} px-2.5 py-1.5 text-xs`}
            onClick={() => setSharing(true)}
          >
            Share
          </button>
          <button
            className={`${quietButton} px-2.5 py-1.5 text-xs`}
            onClick={() => setSettings(true)}
          >
            Settings
          </button>
        </div>
      </header>

      {yourBalance ? (
        <Card className="text-center">
          <p className="text-xs tracking-wide uppercase opacity-60">
            {yourBalance.net_minor > 0
              ? "You are owed"
              : yourBalance.net_minor < 0
                ? "You owe"
                : "You are settled up"}
          </p>
          <p className="tnum mt-1 text-3xl font-semibold">
            <Money
              minor={Math.abs(yourBalance.net_minor)}
              currency={group.currency}
            />
          </p>
        </Card>
      ) : null}

      <nav className="flex gap-1 rounded-lg bg-black/5 p-1 dark:bg-white/10">
        {(
          [
            ["expenses", "Expenses"],
            ["balances", "Balances"],
            ["payments", "Payments"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex-1 rounded-md px-2 py-1.5 text-sm transition ${
              tab === key
                ? "bg-white shadow-sm dark:bg-black/50"
                : "opacity-60 hover:opacity-100"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <Card>
        {tab === "expenses" ? (
          <>
            <SectionTitle
              action={
                <Link
                  href={`/g/${group.slug}/report`}
                  className="text-xs underline underline-offset-2 opacity-70"
                >
                  report
                </Link>
              }
            >
              Expenses
            </SectionTitle>
            <ExpenseList
              slug={group.slug}
              currency={group.currency}
              members={members}
              you={you}
              expenses={expenses}
              shares={shares}
            />
          </>
        ) : tab === "balances" ? (
          <>
            <SectionTitle>Balances</SectionTitle>
            <Balances
              slug={group.slug}
              currency={group.currency}
              members={members}
              you={you}
              balances={balances}
              transfers={transfers}
              simplified={group.simplify_payments}
            />
          </>
        ) : (
          <>
            <SectionTitle>Payments</SectionTitle>
            <PaymentList
              slug={group.slug}
              currency={group.currency}
              members={members}
              you={you}
              settlements={settlements}
            />
          </>
        )}
      </Card>

      {/* Thumb-reachable, and the one thing people open the app to do. */}
      <div className="fixed inset-x-0 bottom-0 border-t border-black/10 bg-white/90 p-3 backdrop-blur dark:border-white/15 dark:bg-black/80">
        <div className="mx-auto max-w-2xl">
          <button
            className={`${primaryButton} w-full`}
            onClick={() => setAdding(true)}
          >
            Add an expense
          </button>
        </div>
      </div>

      <Dialog open={adding} title="Add an expense" onClose={() => setAdding(false)}>
        {adding ? (
          <ExpenseForm
            slug={group.slug}
            currency={group.currency}
            members={members}
            you={you}
            onDone={() => setAdding(false)}
          />
        ) : null}
      </Dialog>

      <Dialog open={sharing} title="Share this group" onClose={() => setSharing(false)}>
        <SharePanel slug={group.slug} />
      </Dialog>

      <Dialog open={settings} title="Group settings" onClose={() => setSettings(false)}>
        {settings ? (
          <GroupSettings
            slug={group.slug}
            group={group}
            members={members}
            onDone={() => setSettings(false)}
          />
        ) : null}
      </Dialog>
    </main>
  );
}
