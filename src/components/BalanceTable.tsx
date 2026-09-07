"use client";

import type { MemberBalance } from "@/lib/balances";
import type { MemberView } from "@/lib/groups";
import { formatMoney } from "@/lib/money";
import type { CurrencyCode } from "@/lib/types";
import { NetAmount } from "./ui";

/**
 * Where everyone stands, broken into the parts it is made of rather than
 * collapsed to a single number.
 *
 * A bare "you owe ₹450" is the answer, but it is not checkable — the person
 * reading it cannot tell whether it is right. Showing the credit (what they
 * put in), the debit (what they consumed) and the payments already made lets
 * them follow the arithmetic to the net, which is the difference between
 * trusting the app and taking its word for it.
 *
 *     net = paid − share + paid back − received
 */
export function BalanceTable({
  currency,
  members,
  you,
  balances,
}: {
  currency: CurrencyCode;
  members: MemberView[];
  you: string | null;
  balances: MemberBalance[];
}) {
  const nameOf = (memberId: string) =>
    members.find((member) => member.id === memberId)?.name ?? "someone";

  const anySettlements = balances.some(
    (balance) =>
      balance.settled_out_minor !== 0 || balance.settled_in_minor !== 0,
  );

  const totals = balances.reduce(
    (sum, balance) => ({
      paid: sum.paid + balance.paid_minor,
      owed: sum.owed + balance.owed_minor,
      out: sum.out + balance.settled_out_minor,
      in: sum.in + balance.settled_in_minor,
      net: sum.net + balance.net_minor,
    }),
    { paid: 0, owed: 0, out: 0, in: 0, net: 0 },
  );

  return (
    <div className="space-y-2">
      {/* Six columns will not fit a phone, so the table scrolls inside its own
          box with the name pinned, rather than the page scrolling sideways.

          No negative margin on this box. With `-mx-4 px-4` the scrollport
          starts a rem left of the table, so `left: 0` pins the frozen column
          outside the table and rows slide visibly through the gap beside it. */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-black/10 dark:border-white/15">
              <th className="frozen-col py-2 pr-3 text-left font-medium">
                Person
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Paid
                <span className="block text-[10px] font-normal opacity-50">
                  credit
                </span>
              </th>
              <th className="px-3 py-2 text-right font-medium">
                Share
                <span className="block text-[10px] font-normal opacity-50">
                  debit
                </span>
              </th>
              {anySettlements ? (
                <>
                  <th className="px-3 py-2 text-right font-medium">
                    Paid back
                    <span className="block text-[10px] font-normal opacity-50">
                      credit
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right font-medium">
                    Received
                    <span className="block text-[10px] font-normal opacity-50">
                      debit
                    </span>
                  </th>
                </>
              ) : null}
              <th className="px-3 py-2 text-right font-medium">
                Net
                <span className="block text-[10px] font-normal opacity-50">
                  owes / owed
                </span>
              </th>
            </tr>
          </thead>

          <tbody>
            {balances.map((balance) => (
              <tr
                key={balance.member_id}
                className="border-b border-black/5 dark:border-white/10"
              >
                <th
                  scope="row"
                  className="frozen-col max-w-[10rem] truncate py-2 pr-3 text-left font-normal"
                >
                  {nameOf(balance.member_id)}
                  {balance.member_id === you ? (
                    <span className="opacity-50"> (you)</span>
                  ) : null}
                </th>
                <td className="tnum px-3 py-2 text-right">
                  {balance.paid_minor === 0 ? (
                    <span className="opacity-25">—</span>
                  ) : (
                    formatMoney(balance.paid_minor, currency)
                  )}
                </td>
                <td className="tnum px-3 py-2 text-right">
                  {balance.owed_minor === 0 ? (
                    <span className="opacity-25">—</span>
                  ) : (
                    formatMoney(balance.owed_minor, currency)
                  )}
                </td>
                {anySettlements ? (
                  <>
                    <td className="tnum px-3 py-2 text-right">
                      {balance.settled_out_minor === 0 ? (
                        <span className="opacity-25">—</span>
                      ) : (
                        formatMoney(balance.settled_out_minor, currency)
                      )}
                    </td>
                    <td className="tnum px-3 py-2 text-right">
                      {balance.settled_in_minor === 0 ? (
                        <span className="opacity-25">—</span>
                      ) : (
                        formatMoney(balance.settled_in_minor, currency)
                      )}
                    </td>
                  </>
                ) : null}
                <td className="px-3 py-2 text-right">
                  <NetAmount minor={balance.net_minor} currency={currency} />
                </td>
              </tr>
            ))}
          </tbody>

          <tfoot>
            <tr className="border-t-2 border-black/20 font-medium dark:border-white/25">
              <th className="frozen-col py-2 pr-3 text-left">
                Total
              </th>
              <td className="tnum px-3 py-2 text-right">
                {formatMoney(totals.paid, currency)}
              </td>
              <td className="tnum px-3 py-2 text-right">
                {formatMoney(totals.owed, currency)}
              </td>
              {anySettlements ? (
                <>
                  <td className="tnum px-3 py-2 text-right">
                    {formatMoney(totals.out, currency)}
                  </td>
                  <td className="tnum px-3 py-2 text-right">
                    {formatMoney(totals.in, currency)}
                  </td>
                </>
              ) : null}
              <td className="tnum px-3 py-2 text-right">
                {formatMoney(totals.net, currency)}
              </td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/*
        Two checks the reader can make at a glance, shown rather than assumed.
        Credits must equal debits — every rupee someone paid is a rupee someone
        consumed — and the net column must come to exactly zero, because money
        only moves between members and is never created.
      */}
      <p
        className={`rounded-lg px-3 py-2 text-xs ${
          totals.paid === totals.owed && totals.net === 0
            ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200"
            : "bg-rose-50 text-rose-800 dark:bg-rose-950/40 dark:text-rose-200"
        }`}
      >
        {totals.paid === totals.owed && totals.net === 0 ? (
          <>
            Credits and debits both come to{" "}
            {formatMoney(totals.paid, currency)}, and the net column adds up to
            zero.
          </>
        ) : (
          <>
            These do not balance: paid {formatMoney(totals.paid, currency)}{" "}
            against shares {formatMoney(totals.owed, currency)}, net{" "}
            {formatMoney(totals.net, currency)} instead of zero. Do not trust
            these figures — please report this.
          </>
        )}
      </p>
    </div>
  );
}
