#!/usr/bin/env bash
# Apply supabase/schema.sql to the project database.
#
#   npm run db:push
#
# Needs SUPABASE_DB_URL in .env.local — Supabase dashboard > Connect > Session
# pooler. It contains the database password, which is why it lives only there.
#
# The script is safe to re-run: every object is created with `if not exists` or
# `create or replace`, and the destructive drops in schema.sql are commented
# out. It does not drop anything.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env.local ]; then
  # shellcheck disable=SC1091
  set -a && . ./.env.local && set +a
fi

if [ -z "${SUPABASE_DB_URL:-}" ]; then
  echo "SUPABASE_DB_URL is not set in .env.local." >&2
  echo "Supabase dashboard > Connect > Session pooler, or paste schema.sql" >&2
  echo "into the SQL editor by hand." >&2
  exit 1
fi

echo "Applying supabase/schema.sql..."
psql "$SUPABASE_DB_URL" \
  --set ON_ERROR_STOP=1 \
  --single-transaction \
  --file supabase/schema.sql

echo "Done."
