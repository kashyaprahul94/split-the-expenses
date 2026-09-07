"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A sheet that comes up from the bottom on phones and sits centred on wider
 * screens. Built on <dialog> so focus trapping, Escape and inertness of the
 * page behind come from the platform rather than from us getting it wrong.
 */
export function Dialog({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  // Escape fires `close` directly, bypassing our button, so the parent's state
  // has to hear about it or the dialog cannot be reopened.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const handle = () => onClose();
    element.addEventListener("close", handle);
    return () => element.removeEventListener("close", handle);
  }, [onClose]);

  return (
    <dialog
      ref={ref}
      className="m-0 mt-auto w-full max-w-lg rounded-t-2xl bg-white p-0 backdrop:bg-black/40 sm:m-auto sm:rounded-2xl dark:bg-neutral-900 dark:text-white"
      onClick={(event) => {
        // Clicking the backdrop closes. The backdrop is the dialog element
        // itself, so anything inside the content box is not a backdrop click.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="max-h-[85vh] overflow-y-auto p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm opacity-60 hover:opacity-100"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
