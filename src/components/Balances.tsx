"use client";

import type { MemberBalance, Transfer } from "@/lib/balances";
import type { MemberView } from "@/lib/groups";
import type { CurrencyCode } from "@/lib/types";
import { BalanceTable } from "./BalanceTable";
import { Empty, Money, quietButton } from "./ui";

export function Balances({
  currency,
  members,
  you,
  balances,
  transfers,
  simplified,
  onSettle,
}: {
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  balances: MemberBalance[];
  transfers: Transfer[];
  simplified: boolean;
  /** Opens the settle-up form, pre-filled with this transfer. Owned by the
   * group screen, because the Payments tab needs the same form. */
  onSettle: (transfer: Transfer) => void;
}) {
  const nameOf = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? "someone";
  const label = (memberId: string) =>
    memberId === you ? "you" : nameOf(memberId);

  const settled = balances.every((balance) => balance.net_minor === 0);

  return (
    <div className="space-y-4">
      <BalanceTable
        currency={currency}
        members={members}
        you={you}
        balances={balances}
      />

      <div>
        <h3 className="mb-2 text-sm font-semibold">
          {settled ? "Nothing outstanding" : simplified ? "Suggested payments" : "Who owes whom"}
        </h3>

        {transfers.length === 0 ? (
          <Empty>Everyone is square.</Empty>
        ) : (
          <ul className="space-y-2">
            {transfers.map((transfer) => (
              <li
                key={`${transfer.from}-${transfer.to}-${transfer.amount_minor}`}
                className="flex items-center justify-between gap-3 rounded-lg bg-black/[0.03] px-3 py-2.5 dark:bg-white/5"
              >
                <span className="min-w-0 text-sm">
                  <span className="font-medium">{label(transfer.from)}</span>
                  <span className="opacity-60"> pays </span>
                  <span className="font-medium">{label(transfer.to)}</span>
                </span>
                <span className="flex items-center gap-2">
                  <Money
                    minor={transfer.amount_minor}
                    currency={currency}
                    className="text-sm font-medium"
                  />
                  <button
                    className={`${quietButton} px-2.5 py-1 text-xs`}
                    onClick={() => onSettle(transfer)}
                  >
                    record
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {/*
          Saying this out loud is not optional. With simplification on, someone
          can be told to pay a person they never transacted with, which reads
          as a bug unless the screen explains it.
        */}
        {simplified && transfers.length > 0 ? (
          <p className="mt-3 text-xs leading-relaxed opacity-60">
            These are rerouted to reduce the number of payments. Nobody ends up
            paying or receiving a different total — only who they hand it to
            changes.
          </p>
        ) : null}
      </div>

    </div>
  );
}
