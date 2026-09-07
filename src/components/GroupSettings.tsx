"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  addMemberAction,
  removeMemberAction,
  renameMemberAction,
  setGroupSettingsAction,
} from "@/app/actions";
import type { GroupView, MemberView } from "@/lib/groups";
import type { Group } from "@/lib/types";
import { ExportGroup } from "./ExportGroup";
import { Dialog } from "./Dialog";
import {
  ErrorNote,
  Field,
  inputStyle,
  primaryButton,
  quietButton,
} from "./ui";

/** The link is the password, so sharing it is a first-class action rather than
 * something buried in a menu. */
export function SharePanel({ slug }: { slug: string }) {
  const [url, setUrl] = useState("");
  const [copied, setCopied] = useState(false);

  // window is not available while this renders on the server, and the origin
  // differs between localhost, a LAN address and production.
  useEffect(() => {
    setUrl(`${window.location.origin}/g/${slug}`);
  }, [slug]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the input below is selectable.
    }
  }

  async function share() {
    if (!navigator.share) return copy();
    try {
      await navigator.share({ url, title: "Split the expenses" });
    } catch {
      // The person dismissed the share sheet.
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm opacity-70">
        Anyone with this link can see and edit the group. There is no password
        beyond the link itself, so share it the way you would a door key.
      </p>

      {url ? (
        <div className="flex justify-center rounded-xl bg-white p-4">
          <QRCodeSVG value={url} size={180} />
        </div>
      ) : null}

      <input readOnly value={url} className={`${inputStyle} text-xs`} onFocus={(event) => event.target.select()} />

      <div className="flex gap-2">
        <button className={`${quietButton} flex-1`} onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
        <button className={`${primaryButton} flex-1`} onClick={share}>
          Share
        </button>
      </div>
    </div>
  );
}

export function GroupSettings({
  slug,
  group,
  members,
  view,
  onDone,
}: {
  slug: string;
  group: Group;
  members: MemberView[];
  view: GroupView;
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [simplify, setSimplify] = useState(group.simplify_payments);
  const [newMember, setNewMember] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [removing, setRemoving] = useState<MemberView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  // Removing people is the only destructive action here, so it is offered
  // only to whoever created the group. Not a security control — there is no
  // auth, and anyone with the link could claim the creator on the join screen
  // — but it keeps a stray tap from deleting somebody.
  const youAreCreator =
    group.created_by === null || view.you === group.created_by;

  /** How many places in the ledger name this person. Anything above zero and
   * they can only be renamed: deleting them would orphan the splits. */
  const appearances = (memberId: string) =>
    view.expenses.filter((expense) => expense.paid_by === memberId).length +
    view.shares.filter((share) => share.member_id === memberId).length +
    view.settlements.filter(
      (settlement) =>
        settlement.from_member === memberId || settlement.to_member === memberId,
    ).length;

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setBusy(true);
    setError("");
    const result = await work();
    if (!result.ok) setError(result.error ?? "Something went wrong.");
    else router.refresh();
    setBusy(false);
    return result.ok;
  }

  return (
    <div className="space-y-5">
      <form
        className="space-y-5"
        onSubmit={async (event) => {
          event.preventDefault();
          const result = await setGroupSettingsAction({
            slug,
            name,
            simplifyPayments: simplify,
          });
          if (!result.ok) setError(result.error);
          else {
            router.refresh();
            onDone();
          }
        }}
      >
        <Field label="Group name">
          <input
            className={inputStyle}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={200}
          />
        </Field>

        <div>
          <label className="flex items-start gap-3">
            <input
              type="checkbox"
              className="mt-1 size-4 shrink-0"
              checked={simplify}
              onChange={(event) => setSimplify(event.target.checked)}
            />
            <span>
              <span className="block text-sm font-medium">Simplify payments</span>
              <span className="block text-xs leading-relaxed opacity-60">
                Reroute debts so fewer payments settle the group. Nobody&apos;s
                total changes — only who they pay. Off by default, because the
                direct view is the one you can check against what you remember
                happening.
              </span>
            </span>
          </label>
        </div>

        <button className={`${primaryButton} w-full`} disabled={busy}>
          Save settings
        </button>
      </form>

      <hr className="border-black/10 dark:border-white/15" />

      <div>
        <h3 className="mb-2 text-sm font-semibold">People</h3>
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {members.map((member) => (
            <li key={member.id} className="py-2">
              {renaming === member.id ? (
                <form
                  className="flex gap-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    const done = await run(() =>
                      renameMemberAction({
                        slug,
                        memberId: member.id,
                        name: renameTo,
                      }),
                    );
                    if (done) setRenaming(null);
                  }}
                >
                  <input
                    className={inputStyle}
                    value={renameTo}
                    onChange={(event) => setRenameTo(event.target.value)}
                    maxLength={60}
                    autoFocus
                    // Escape abandons the rename, which is what the key is for.
                    onKeyDown={(event) => {
                      if (event.key === "Escape") setRenaming(null);
                    }}
                  />
                  <button className={quietButton} disabled={busy}>
                    Save
                  </button>
                  <button
                    type="button"
                    className={quietButton}
                    onClick={() => setRenaming(null)}
                  >
                    Cancel
                  </button>
                </form>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 truncate text-sm">
                    {member.name}
                    {!member.claimed ? (
                      <span className="ml-2 text-xs opacity-50">
                        not on a device yet
                      </span>
                    ) : null}
                  </span>
                  <span className="flex shrink-0 gap-2">
                    <button
                      className="text-xs underline underline-offset-2"
                      onClick={() => {
                        setRenaming(member.id);
                        setRenameTo(member.name);
                      }}
                    >
                      Rename
                    </button>
                    {youAreCreator &&
                    member.id !== group.created_by &&
                    appearances(member.id) === 0 ? (
                      <button
                        className="text-xs text-rose-700 underline underline-offset-2 dark:text-rose-400"
                        onClick={() => setRemoving(member)}
                      >
                        Remove
                      </button>
                    ) : null}
                  </span>
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-2 text-xs leading-relaxed opacity-60">
          {youAreCreator
            ? "Only people who appear in no expense or payment can be removed — deleting anyone else would orphan the splits and break every balance. Rename them instead."
            : "Only the person who created this group can remove people. Anyone can rename."}
        </p>

        <form
          className="mt-3 flex gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            if (newMember.trim() === "") return;
            const done = await run(() =>
              addMemberAction({ slug, name: newMember }),
            );
            if (done) setNewMember("");
          }}
        >
          <input
            className={inputStyle}
            value={newMember}
            onChange={(event) => setNewMember(event.target.value)}
            placeholder="Add someone"
            maxLength={60}
          />
          <button
            className={quietButton}
            disabled={busy || newMember.trim() === ""}
          >
            Add
          </button>
        </form>
      </div>

      <ErrorNote>{error}</ErrorNote>

      <hr className="border-black/10 dark:border-white/15" />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Back up this group</h3>
        <ExportGroup view={view} />
      </div>

      {/* Removing somebody is the one thing here that cannot be undone from
          the app, so it asks first and says exactly what will happen. */}
      <Dialog
        open={removing !== null}
        title="Remove from group"
        onClose={() => setRemoving(null)}
      >
        {removing ? (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed">
              Remove <span className="font-medium">{removing.name}</span> from
              this group?
            </p>
            <p className="text-sm opacity-60">
              They appear in no expense or payment, so nothing in the ledger
              changes. {removing.claimed
                ? "Their device will be signed out of the group and they would need to join again."
                : "They have not opened the group on any device."}
            </p>
            <div className="flex gap-2">
              <button
                className={`${quietButton} flex-1`}
                onClick={() => setRemoving(null)}
              >
                Cancel
              </button>
              <button
                className={`${primaryButton} flex-1`}
                disabled={busy}
                onClick={async () => {
                  const target = removing;
                  setRemoving(null);
                  await run(() =>
                    removeMemberAction({ slug, memberId: target.id }),
                  );
                }}
              >
                Remove
              </button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
