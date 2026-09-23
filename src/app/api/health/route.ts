import { db } from "@/lib/supabase";

/**
 * A read-only ping that keeps the Supabase project from being paused.
 *
 * Free-tier projects pause after a stretch with no database activity, so an
 * external scheduler hits this once a day. It runs one real query against
 * Postgres — a static page would not touch the database and would not count —
 * but reads a single id and throws it away. Nothing is written, and nothing
 * about any group is returned, because this route needs no slug.
 */

export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  const { error } = await db.from("groups").select("id").limit(1);

  const headers = { "Cache-Control": "no-store" };

  if (error) {
    console.error("health check failed", error);
    return Response.json({ ok: false }, { status: 503, headers });
  }

  return Response.json(
    { ok: true, db_ms: Date.now() - started },
    { status: 200, headers },
  );
}
