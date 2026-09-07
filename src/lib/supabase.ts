import "server-only";
import { createClient } from "@supabase/supabase-js";

/**
 * The only connection to the database, and it exists only on the server.
 *
 * The browser is never given a Supabase key. Every table has RLS enabled with
 * no policies at all, so the anon role can read nothing and write nothing —
 * this client's secret key is the sole way in, and our own route handlers are
 * what check that the caller supplied the right group slug.
 *
 * That is what makes "the link is the password" true. A publishable key
 * shipped in the JS bundle would be public, and the permissive policies it
 * would need would let anyone holding it dump every group in the database.
 *
 * The `server-only` import above is the guard: if this module is ever pulled
 * into a client component, the build fails rather than leaking the key.
 */

const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
const secretKey = process.env.SUPABASE_SECRET_KEY;

if (!url || !secretKey) {
  throw new Error(
    "Missing SUPABASE_URL or SUPABASE_SECRET_KEY. Copy .env.example to .env.local.",
  );
}

export const db = createClient(url, secretKey, {
  auth: {
    // There are no user accounts, and nothing should be written to storage on
    // a server that handles every group's requests.
    persistSession: false,
    autoRefreshToken: false,
  },
});
