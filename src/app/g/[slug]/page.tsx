import { notFound } from "next/navigation";
import { computeBalances, directDebts, groupTotals } from "@/lib/balances";
import { getDeviceKey } from "@/lib/device";
import { getGroupBundle } from "@/lib/groups";
import { simplifyTransfers } from "@/lib/simplify";
import { GroupScreen } from "@/components/GroupScreen";
import { JoinGroup } from "@/components/JoinGroup";

/**
 * The group. Rendered on the server, which is the only place with database
 * access — and the only place that can see the device cookie and so work out
 * who the reader is.
 */

// The ledger changes whenever anyone in the group touches it, so there is
// nothing here worth caching between requests.
export const dynamic = "force-dynamic";

export default async function GroupPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const deviceKey = await getDeviceKey();
  const view = await getGroupBundle(slug, deviceKey);

  if (!view) notFound();

  // Nobody on this device has said who they are yet.
  if (!view.you) {
    return (
      <JoinGroup
        slug={slug}
        groupName={view.group.name}
        members={view.members}
      />
    );
  }

  // Derived on every read, never stored. The dataset is tiny and a cached
  // balance that disagrees with the expense list is unfixable in the field.
  const ledger = {
    members: view.members.map((member) => ({ id: member.id })),
    expenses: view.expenses,
    shares: view.shares,
    settlements: view.settlements,
  };

  const balances = computeBalances(ledger);
  const transfers = view.group.simplify_payments
    ? simplifyTransfers(balances)
    : directDebts(ledger);

  return (
    <GroupScreen
      view={view}
      balances={balances}
      transfers={transfers}
      totals={groupTotals(ledger)}
    />
  );
}
