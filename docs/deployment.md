# Deployment

## Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Client-safe |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | Server-only. Bypasses RLS. A missing value here once caused an uncaught crash with zero diagnostics (`BUG_HISTORY.md` #4) — now caught explicitly with a clear `config` error. |
| `AI_PROVIDER` | No, defaults to `mock` | `mock` or `gemini` |
| `GEMINI_API_KEY` | Only if `AI_PROVIDER=gemini` | |
| `GEMINI_MODEL` | No, defaults to `gemini-3.6-flash` | Pinned to a specific GA model, not a `-latest` alias (Google's own docs mark `-latest` aliases experimental). Production was set to `gemini-3.5-flash-lite` on 2026-09-21 (`CURRENT_STATUS.md`; not re-read since; see the note below). The code default is stale. |
| `GEMINI_MAX_OUTPUT_TOKENS` | No, defaults to `4096` | Explicit on purpose — see `extraction-pipeline.md` |
| `GEMINI_THINKING_LEVEL` | No, defaults to `low` | `minimal \| low \| medium \| high` |
| `GEMINI_TIMEOUT_MS` | No, defaults to `45000` | Default lowered from 120000 in `bbebf8b1`. Deleted from production on 2026-09-21 (`CURRENT_STATUS.md`). |
| `MOCK_SCENARIO` | No, defaults to `thesis` | `article`, `not_research` — only used when `AI_PROVIDER=mock` |

**Planned, not built:** Phase 3 M1 adds a processing-mode variable (for example `EXTRACTION_MODE=external|disabled`) so that external extraction can be switched off without a code change. It does not exist yet. See `PHASE_3_PLAN.md`.

**No tool has ever been available to verify what's actually set in Vercel's environment variable store remotely.** If something behaves like a missing/wrong variable, check the Vercel dashboard directly.

## Deploy process

1. Code changes go to the `research-platform` branch of `samerawad2025-prog/research-platform` on GitHub. Vercel auto-deploys from that branch.
2. **Three Vercel projects are linked to this same GitHub repo** (`research-platform-5zpu`, `research-platform-88r9`, `research-platform`). Only `research-platform-5zpu` has been confirmed as the one actually serving production traffic. This ambiguity has never been fully resolved — worth cleaning up, and worth double-checking which project you're looking at before trusting its logs or settings.
3. Database changes are separate, incremental SQL files in `supabase/migrations/`, run manually via Supabase → SQL Editor. **Never re-run `supabase/schema.sql` against the live database** — it's for fresh installs only.

## After every deploy: verify it actually landed

This is not optional caution — it's a documented, repeated failure mode on this project. At least three separate incidents were "the fix is right, it just isn't live yet," each one costing real debugging time before being caught. The cheapest verification: submit one real paper, then query `ai_generations.notes` and `papers.failure_code` / `extraction_status` in Supabase directly. The exact wording and structure of what's stored is a fingerprint of which code version is actually running — this is literally how deployment lag was caught multiple times (see `.claude/commands/verify-deployment.md` if using Claude Code, or `troubleshooting.md`).

## Fresh install vs. live database

`supabase/schema.sql` builds a complete, correct database from nothing — use it only for a new Supabase project. The live production database has been built up through the ordered migrations in `supabase/migrations/`; that folder, not `schema.sql`, is the actual history of the live database's current shape.
