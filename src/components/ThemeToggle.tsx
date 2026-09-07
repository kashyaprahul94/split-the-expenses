"use client";

import { useEffect, useState } from "react";

export const THEME_KEY = "ste.theme";

/**
 * Light or dark, chosen explicitly and remembered per device.
 *
 * The choice is applied by a blocking script in the document head, before
 * anything paints — see layout.tsx. This component only mirrors and changes
 * it, so it starts from whatever the script already put on <html> rather than
 * assuming a default and causing a flash.
 */
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.dataset.theme === "dark");
    setReady(true);
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try {
      window.localStorage.setItem(THEME_KEY, next ? "dark" : "light");
    } catch {
      // Private mode throws rather than returning null. The theme still
      // applies for this visit; it just will not be remembered.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      // Rendered on the server as light, so the label is hidden until the
      // effect has read the real value. Without this it can announce the
      // wrong mode for a frame.
      aria-label={ready ? (dark ? "Switch to light theme" : "Switch to dark theme") : "Switch theme"}
      title={ready ? (dark ? "Light theme" : "Dark theme") : "Switch theme"}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-line text-sm hover:bg-raised"
    >
      <span aria-hidden="true">{ready && dark ? "☀" : "☾"}</span>
    </button>
  );
}
