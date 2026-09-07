"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinGroupAction } from "@/app/actions";
import type { MemberView } from "@/lib/groups";
import { rememberGroup } from "@/lib/session";
import { Dialog } from "./Dialog";
import {
  Card,
  ErrorNote,
  Field,
  inputStyle,
  primaryButton,
  quietButton,
} from "./ui";

/**
 * The join screen. Its whole job is to stop a group ending up with "Sam", who
 * has all the expenses, and "Sam (2)", who has the phone.
 *
 * So the unclaimed names come first and adding a new one is the fallback,
 * not the other way round.
 */
export function JoinGroup({
  slug,
  groupName,
  members,
}: {
  slug: string;
  groupName: string;
  members: MemberView[];
}) {
  const router = useRouter();
  const [newName, setNewName] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const [confirming, setConfirming] = useState<MemberView | null>(null);

  const unclaimed = members.filter((member) => !member.claimed);
  const claimed = members.filter((member) => member.claimed);

  async function join(input: {
    memberId?: string;
    newName?: string;
    confirmShared?: boolean;
  }) {
    setBusy(true);
    setError("");

    const result = await joinGroupAction({ slug, ...input });

    if (!result.ok) {
      setError(result.error);
      setBusy(false);
      return;
    }

    rememberGroup(slug, groupName);
    router.refresh();
  }

  return (
    <main className="mx-auto w-full max-w-md space-y-5 p-5 pt-10">
      <header className="space-y-1.5">
        <h1 className="text-2xl font-semibold tracking-tight">{groupName}</h1>
        <p className="text-sm opacity-70">Who are you in this group?</p>
      </header>

      {unclaimed.length > 0 ? (
        <Card>
          <p className="mb-3 text-sm opacity-70">
            Pick your name so your existing expenses stay yours.
          </p>
          <ul className="space-y-2">
            {unclaimed.map((member) => (
              <li key={member.id}>
                <button
                  className={`${quietButton} w-full justify-between`}
                  disabled={busy}
                  onClick={() => join({ memberId: member.id })}
                >
                  <span>{member.name}</span>
                  <span className="opacity-40">That&apos;s me</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        {/* A real form, so Enter submits. Typing a name and pressing return is
            what people do without thinking about it. */}
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (newName.trim() !== "") join({ newName });
          }}
        >
          <Field
            label={unclaimed.length > 0 ? "I'm someone else" : "Your name"}
            hint="Added to the group as a new person."
          >
            <input
              className={inputStyle}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              placeholder="Your name"
              maxLength={60}
              autoFocus={unclaimed.length === 0}
            />
          </Field>

          <button
            className={`${primaryButton} mt-3 w-full`}
            disabled={busy || newName.trim() === ""}
          >
            {busy ? "Joining…" : "Join group"}
          </button>
        </form>
      </Card>

      {/*
        Names already in use, offered separately and behind a confirmation.
        This is how a second device attaches: one person with a phone and a
        laptop is still one member, and hiding these names would leave them
        no way in but to create a duplicate of themselves.
      */}
      {claimed.length > 0 ? (
        <Card>
          <p className="mb-3 text-sm opacity-70">
            Already set up on another device. Pick one only if it is you.
          </p>
          <ul className="space-y-2">
            {claimed.map((member) => (
              <li key={member.id}>
                <button
                  className={`${quietButton} w-full justify-between`}
                  disabled={busy}
                  onClick={() => setConfirming(member)}
                >
                  <span>{member.name}</span>
                  <span className="text-xs opacity-40">
                    {member.device_count === 1
                      ? "1 device"
                      : `${member.device_count} devices`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <ErrorNote>{error}</ErrorNote>

      <p className="px-1 text-xs leading-relaxed opacity-50">
        Adding this device to a name you already use is how you get the same
        group on your phone and your laptop. Picking someone else&apos;s name
        makes this device them — every expense you add would be recorded as
        theirs.
      </p>

      <Dialog
        open={confirming !== null}
        title="Is this you?"
        onClose={() => setConfirming(null)}
      >
        {confirming ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed">
              <span className="font-medium">{confirming.name}</span> is already
              set up on{" "}
              {confirming.device_count === 1
                ? "another device"
                : `${confirming.device_count} other devices`}
              . Adding this one means everything you do here is recorded as
              them.
            </p>
            <p className="text-sm opacity-60">
              Do that only if it is your own other phone or computer. If someone
              else in the group is {confirming.name}, go back and add your own
              name instead.
            </p>
            <div className="flex gap-2">
              <button
                className={`${quietButton} flex-1`}
                onClick={() => setConfirming(null)}
              >
                Cancel
              </button>
              <button
                className={`${primaryButton} flex-1`}
                disabled={busy}
                onClick={() => {
                  const target = confirming;
                  setConfirming(null);
                  join({ memberId: target.id, confirmShared: true });
                }}
              >
                Yes, that&apos;s me
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </main>
  );
}
