"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * A sheet that rises from the bottom on phones and sits centred on wider
 * screens. Built on <dialog> so focus trapping, Escape, and inertness of the
 * page behind come from the platform rather than from us getting it wrong.
 *
 * Two things the platform does *not* do, which are handled here:
 *
 * 1. **It does not lock the page behind.** A modal <dialog> blocks clicks but
 *    the document still scrolls under it on wheel and touch, so opening a form
 *    and scrolling drags the page around behind it.
 * 2. **Scroll chaining.** Once the dialog's own content hits its end, further
 *    scrolling is passed to the page. `overscroll-contain` stops that.
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

  // Hold the page still while the dialog is up. The scrollbar's width is
  // added back as padding, or removing it shifts the whole layout sideways
  // the moment a dialog opens.
  useEffect(() => {
    if (!open) return;

    const { body } = document;
    const previousOverflow = body.style.overflow;
    const previousPadding = body.style.paddingRight;
    const scrollbar = window.innerWidth - document.documentElement.clientWidth;

    body.style.overflow = "hidden";
    if (scrollbar > 0) body.style.paddingRight = `${scrollbar}px`;

    return () => {
      body.style.overflow = previousOverflow;
      body.style.paddingRight = previousPadding;
    };
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
      className="m-0 mt-auto w-full max-w-lg rounded-t-2xl border border-line bg-surface p-0 text-foreground shadow-2xl backdrop:bg-black/60 backdrop:backdrop-blur-[2px] sm:m-auto sm:rounded-2xl"
      onClick={(event) => {
        // Clicking the backdrop closes. The backdrop is the dialog element
        // itself, so anything inside the content box is not a backdrop click.
        if (event.target === ref.current) onClose();
      }}
    >
      <div className="max-h-[85vh] overflow-y-auto overscroll-contain p-5">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="-mr-1 rounded-lg px-2 py-1 text-lg leading-none opacity-60 hover:opacity-100"
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
