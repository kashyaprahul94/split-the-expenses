import type { NextConfig } from "next";

// Two Next processes must never share a build directory. A `next build` while
// `next dev` is running will serve the browser chunks from the other
// compilation and the symptoms are baffling to debug. Any second process sets
// NEXT_DIST_DIR (use `.next-verify`) so it writes somewhere else entirely.
const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
