"use client";

import { useState } from "react";
import type { MemberBalance, Transfer } from "@/lib/balances";
import type { MemberView } from "@/lib/groups";
import type { CurrencyCode } from "@/lib/types";
import { SettleUp } from "./SettleUp";
import { Dialog } from "./Dialog";
import { Empty, Money, NetAmount, primaryButton, quietButton } from "./ui";

export function Balances({
  slug,
  currency,
  members,
  you,
  balances,
  transfers,
  simplified,
}: {
  slug: string;
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  balances: MemberBalance[];
  transfers: Transfer[];
  simplified: boolean;
}) {
  const [settling, setSettling] = useState<Transfer | null>(null);

  const nameOf = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? "someone";
  const label = (memberId: string) =>
    memberId === you ? "you" : nameOf(memberId);

  const settled = balances.every((balance) => balance.net_minor === 0);

  return (
    <div className="space-y-4">
      <ul className="divide-y divide-black/5 dark:divide-white/10">
        {balances.map((balance) => (
          <li
            key={balance.member_id}
            className="flex items-center justify-between gap-3 py-2"
          >
            <span className="min-w-0 truncate text-sm">
              {nameOf(balance.member_id)}
              {balance.member_id === you ? (
                <span className="opacity-50"> (you)</span>
              ) : null}
            </span>
            <span className="flex items-center gap-3">
              <span className="text-xs opacity-50">
                {balance.net_minor > 0
                  ? "is owed"
                  : balance.net_minor < 0
                    ? "owes"
                    : "settled up"}
              </span>
              <NetAmount minor={balance.net_minor} currency={currency} />
            </span>
          </li>
        ))}
      </ul>

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
                    onClick={() => setSettling(transfer)}
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

      <button
        className={`${primaryButton} w-full`}
        onClick={() =>
          setSettling({ from: you ?? members[0]?.id ?? "", to: "", amount_minor: 0 })
        }
      >
        Record a payment
      </button>

      <Dialog
        open={settling !== null}
        title="Record a payment"
        onClose={() => setSettling(null)}
      >
        {settling ? (
          <SettleUp
            slug={slug}
            currency={currency}
            members={members}
            you={you}
            initial={settling}
            onDone={() => setSettling(null)}
          />
        ) : null}
      </Dialog>
    </div>
  );
}
