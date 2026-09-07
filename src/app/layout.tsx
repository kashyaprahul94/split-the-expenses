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

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
