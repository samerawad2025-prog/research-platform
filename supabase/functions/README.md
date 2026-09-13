# Functions

**Naming caveat, read this first:** in a standard Supabase CLI project layout, `supabase/functions/` is conventionally where **Edge Functions** live — standalone Deno-based serverless functions, deployed with `supabase functions deploy`. **This project has none of those.** Everything in this folder is a Postgres RPC function (PL/pgSQL, `SECURITY DEFINER`), defined as part of the database schema and deployed by running SQL, not by deploying a separate function runtime. If this project ever adds a real Supabase Edge Function, it would also belong in this folder per convention — just don't assume anything here already is one.

These four files are extracted directly from `supabase/schema.sql` (the source of truth) purely for easier individual review — **do not edit these files and expect the change to take effect anywhere.** Edit `schema.sql` and the relevant file in `supabase/migrations/`, then re-extract if you want this mirror to stay current.

## What's here

- **`submit_paper.sql`** — the only way an anonymous visitor creates a paper. Generates the confirmation token, hashes it, returns the raw value exactly once.
- **`get_paper_for_confirmation.sql`** — the only way an anonymous visitor reads a paper's extraction result. Token-gated, explicit field allowlist.
- **`confirm_researcher_metadata.sql`** — the only way an anonymous visitor writes confirmed data. Token-gated, reconciles the researcher list by id (not delete-and-recreate), distinguishes a deliberately-cleared field from an untouched one.
- **`prevent_premature_publish.sql`** — a trigger function (with its trigger definition), blocking `article_versions` from being marked published unless the underlying paper has already been approved. The only function here not directly callable by anonymous users.

Full explanation of each function's role in `docs/database.md`.
