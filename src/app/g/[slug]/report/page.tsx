import Link from "next/link";
import { notFound } from "next/navigation";
import { computeBalances, groupTotals } from "@/lib/balances";
import { getDeviceKey } from "@/lib/device";
import { getGroupBundle } from "@/lib/groups";
import { ReportTable } from "@/components/ReportTable";
import { Card, Money, SectionTitle } from "@/components/ui";

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

  const balances = computeBalances(ledger);
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
        <Link
          href={`/g/${slug}`}
          className="shrink-0 text-xs underline underline-offset-2 opacity-70"
        >
          back to group
        </Link>
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
