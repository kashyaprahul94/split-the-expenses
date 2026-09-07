import Link from "next/link";
import { notFound } from "next/navigation";
import { computeBalances, groupTotals } from "@/lib/balances";
import { getDeviceKey } from "@/lib/device";
import { getGroupBundle } from "@/lib/groups";
import { ReportTable } from "@/components/ReportTable";
import { Card, Money, SectionTitle } from "@/components/ui";
import { ThemeToggle } from "@/components/ThemeToggle";

export const dynamic = "force-dynamic";

export default async function ReportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const deviceKey = await getDeviceKey();
  const view = await getGroupBundle(slug, deviceKey);

  if (!view) notFound();

  const ledger = {
    members: view.members.map((member) => ({ id: member.id })),
    expenses: view.expenses,
    shares: view.shares,
    settlements: view.settlements,
  };

  // computeBalances returns rows in member-id order, which is meaningless to
  // read. Reordered to match the alphabetical member list so every table in
  // the app lists people the same way.
  const order = new Map(view.members.map((member, index) => [member.id, index]));
  const balances = computeBalances(ledger).sort(
    (a, b) =>
      (order.get(a.member_id) ?? 0) - (order.get(b.member_id) ?? 0),
  );
  const totals = groupTotals(ledger);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-4 p-4">
      <header className="flex items-start justify-between gap-3 pt-2">
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold tracking-tight">
            {view.group.name}
          </h1>
          <p className="mt-0.5 text-xs opacity-60">
            <Money minor={totals.total_minor} currency={view.group.currency} />{" "}
            across {totals.expense_count} expenses ·{" "}
            <Money minor={totals.per_head_minor} currency={view.group.currency} />{" "}
            per head
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <Link
            href={`/g/${slug}`}
            className="text-xs underline underline-offset-2 opacity-70"
          >
            Back to group
          </Link>
          <ThemeToggle />
        </div>
      </header>

      <Card>
        <SectionTitle>The expense table</SectionTitle>
        <ReportTable
          groupName={view.group.name}
          currency={view.group.currency}
          members={view.members}
          you={view.you}
          expenses={view.expenses}
          shares={view.shares}
          balances={balances}
        />
      </Card>
    </main>
  );
}
