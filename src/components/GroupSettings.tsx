"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { QRCodeSVG } from "qrcode.react";
import {
  addMemberAction,
  renameMemberAction,
  setGroupSettingsAction,
} from "@/app/actions";
import type { MemberView } from "@/lib/groups";
import type { Group } from "@/lib/types";
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
  onDone,
}: {
  slug: string;
  group: Group;
  members: MemberView[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [name, setName] = useState(group.name);
  const [simplify, setSimplify] = useState(group.simplify_payments);
  const [newMember, setNewMember] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameTo, setRenameTo] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

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

      <button
        className={`${primaryButton} w-full`}
        disabled={busy}
        onClick={() =>
          run(async () => {
            const result = await setGroupSettingsAction({
              slug,
              name,
              simplifyPayments: simplify,
            });
            if (result.ok) onDone();
            return result;
          })
        }
      >
        Save settings
      </button>

      <hr className="border-black/10 dark:border-white/15" />

      <div>
        <h3 className="mb-2 text-sm font-semibold">People</h3>
        <ul className="divide-y divide-black/5 dark:divide-white/10">
          {members.map((member) => (
            <li key={member.id} className="py-2">
              {renaming === member.id ? (
                <div className="flex gap-2">
                  <input
                    className={inputStyle}
                    value={renameTo}
                    onChange={(event) => setRenameTo(event.target.value)}
                    maxLength={60}
                    autoFocus
                  />
                  <button
                    className={quietButton}
                    disabled={busy}
                    onClick={async () => {
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
                    Save
                  </button>
                </div>
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
                  <button
                    className="text-xs underline underline-offset-2"
                    onClick={() => {
                      setRenaming(member.id);
                      setRenameTo(member.name);
                    }}
                  >
                    rename
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>

        <p className="mt-2 text-xs leading-relaxed opacity-60">
          People cannot be removed once they appear in an expense — deleting
          them would orphan the splits and break every balance. Rename instead.
        </p>

        <div className="mt-3 flex gap-2">
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
            onClick={async () => {
              const done = await run(() =>
                addMemberAction({ slug, name: newMember }),
              );
              if (done) setNewMember("");
            }}
          >
            Add
          </button>
        </div>
      </div>

      <ErrorNote>{error}</ErrorNote>
    </div>
  );
}
