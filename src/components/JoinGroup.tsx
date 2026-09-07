"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { joinGroupAction } from "@/app/actions";
import type { MemberView } from "@/lib/groups";
import { rememberGroup } from "@/lib/session";
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

  const unclaimed = members.filter((member) => !member.claimed);

  async function join(input: { memberId?: string; newName?: string }) {
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
                  <span className="opacity-40">that&apos;s me</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
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
          />
        </Field>

        <button
          className={`${primaryButton} mt-3 w-full`}
          disabled={busy || newName.trim() === ""}
          onClick={() => join({ newName })}
        >
          {busy ? "Joining…" : "Join group"}
        </button>
      </Card>

      <ErrorNote>{error}</ErrorNote>

      <p className="px-1 text-xs opacity-50">
        Already claimed names are hidden. If yours is taken because you switched
        phones, ask someone in the group to rename it for you.
      </p>
    </main>
  );
}
