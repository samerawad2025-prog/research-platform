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

| `EXTRACTION_MODE` | **Yes, in production.** Missing or invalid means `manual` | `automatic`: the existing two-pass extraction. `manual`: no document content or text taken from it is sent to any AI provider; the researcher enters the details on the confirmation screen. Case and surrounding spaces are ignored; any other value is treated as `manual` and logged as `extraction_mode_defaulted`. Read at request time (the pages are dynamic), but a Vercel env change still needs a redeploy to take effect. Added in Phase 3 M1. |
| `ALLOW_PREVIEW_EXTRACTION` | No | `true` lets a preview run automatic extraction. Only matters in `automatic` mode; manual mode never calls a provider anywhere. |

A non-secret template of all of these is in `.env.local.example`.

### Rollout: `EXTRACTION_MODE` (Phase 3 M1)

The variable defaults to **manual**. That is deliberate: a missing or mistyped setting must never send research to a provider. The consequence is that deploying M1 **without** setting the variable switches production from automatic extraction to hand entry.

**To keep today's behaviour, set it before merging:**

1. In Vercel → `research-platform-5zpu` → Settings → Environment Variables, add `EXTRACTION_MODE` = `automatic`, scoped to **Production** only.
2. Optionally, before switching production to manual, apply migration `0011` so manual papers are recorded as `manual` (the app works without it; see the migration's header).
3. Merge the M1 PR. The production deploy picks up the variable.
4. Verify on production. A request with a token that matches no paper returns `404` with the mode in the body (`"mode":"automatic"` or `"mode":"manual"`), without touching any paper:
   `curl -s -X POST https://research-platform-5zpu.vercel.app/api/extract -H 'content-type: application/json' -d '{"token":"verify-mode-no-such-token"}'`
5. Check the function logs for `extraction_mode_defaulted`. It must not appear.

**To switch production to manual later:** apply `0011` first, set `EXTRACTION_MODE=manual`, redeploy, then repeat step 4 (expect `"mode":"manual"`). Switching back is the same with `automatic`. Papers already recorded as `manual` stay manual; they are never sent for extraction after a switch back.

**What a switch does not do:** it cannot recall a provider request that is already running. That request finishes (up to `maxDuration`, 300s), its result is appended to `ai_generations`, and it is applied to the paper only if the researcher has not confirmed by then.

**Previews** carry no service-role key, so on a preview the route cannot record anything. In manual mode it still answers `manual` and sends nothing; in automatic mode the preview guard answers 503 and the confirmation screen offers hand entry straight away.

**No tool has ever been available to verify what's actually set in Vercel's environment variable store remotely.** If something behaves like a missing/wrong variable, check the Vercel dashboard directly.

## Deploy process

1. Code changes go to the `research-platform` branch of `samerawad2025-prog/research-platform` on GitHub. Vercel auto-deploys from that branch.
2. **Three Vercel projects are linked to this same GitHub repo** (`research-platform-5zpu`, `research-platform-88r9`, `research-platform`). Only `research-platform-5zpu` has been confirmed as the one actually serving production traffic. This ambiguity has never been fully resolved — worth cleaning up, and worth double-checking which project you're looking at before trusting its logs or settings.
3. Database changes are separate, incremental SQL files in `supabase/migrations/`, run manually via Supabase → SQL Editor. **Never re-run `supabase/schema.sql` against the live database** — it's for fresh installs only.

## After every deploy: verify it actually landed

This is not optional caution — it's a documented, repeated failure mode on this project. At least three separate incidents were "the fix is right, it just isn't live yet," each one costing real debugging time before being caught. The cheapest verification: submit one real paper, then query `ai_generations.notes` and `papers.failure_code` / `extraction_status` in Supabase directly. The exact wording and structure of what's stored is a fingerprint of which code version is actually running — this is literally how deployment lag was caught multiple times (see `.claude/commands/verify-deployment.md` if using Claude Code, or `troubleshooting.md`).

## Fresh install vs. live database

`supabase/schema.sql` builds a complete, correct database from nothing — use it only for a new Supabase project. The live production database has been built up through the ordered migrations in `supabase/migrations/`; that folder, not `schema.sql`, is the actual history of the live database's current shape.
