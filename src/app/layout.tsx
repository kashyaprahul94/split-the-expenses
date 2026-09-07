import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Split the Expenses",
  description: "Split shared costs with a group. No accounts, no logins.",
};

export const viewport: Viewport = {
  // Phones are the primary device here. maximumScale is deliberately left
  // alone — locking zoom breaks accessibility, and the real fix for iOS
  // Safari's zoom-on-focus is a >=16px font size on inputs (see globals.css).
  width: "device-width",
  initialScale: 1,
};

/**
 * Applies the stored theme before the first paint.
 *
 * This has to be a blocking inline script in the head. Doing it in an effect
 * would render the light palette first and then swap, which is a white flash
 * on every navigation for anyone using dark mode.
 *
 * Light is the default, so an unset or unreadable preference falls through to
 * it — including when localStorage throws, which Safari does in private mode.
 */
const applyTheme = `
try {
  var stored = localStorage.getItem("ste.theme");
  document.documentElement.dataset.theme = stored === "dark" ? "dark" : "light";
} catch (e) {
  document.documentElement.dataset.theme = "light";
}
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // The script sets data-theme before React hydrates, so the server's
    // markup and the DOM legitimately differ on this one attribute.
    <html lang="en" data-theme="light" className="h-full antialiased" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: applyTheme }} />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
