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

| `EXTRACTION_MODE` | **Yes, in production** (a product decision; see Rollout). Missing or invalid means `manual` | `automatic`: the existing two-pass extraction. `manual`: no document content or text taken from it is sent to any AI provider; the researcher enters the details on the confirmation screen. Case and surrounding spaces are ignored; any other value is treated as `manual` and logged as `extraction_mode_defaulted`. Read at request time (the pages are dynamic), but a Vercel env change still needs a redeploy to take effect. Added in Phase 3 M1. |
| `ALLOW_PREVIEW_EXTRACTION` | No | `true` lets a preview run automatic extraction. Only matters in `automatic` mode; manual mode never calls a provider anywhere. |

A non-secret template of all of these is in `.env.local.example`.

### Rollout: Phase 3 M1 (four separate decisions)

M1 rollout involves four decisions. They are independent, and each has its own evidence.

**1. Database readiness: a prerequisite, whatever the mode.**
- Migration `supabase/migrations/0011_manual_entry.sql` must be applied **before** the M1 application is deployed.
- M1 reads `papers.manual_entry_at` / `manual_entry_source` on every extraction and manual-entry request. Without them it refuses with `503 database_not_ready`, in **every** mode. It never guesses, and it never falls back to calling the provider.
- So deploying the code first stops automatic extraction and prevents manual decisions from being recorded until the migration is applied.
- The migration is additive and compatible with the application in production today (`f45dc690`). That code selects explicit columns, and the confirmation page ignores the two extra keys the RPC returns. This was verified by running that exact route code against the migrated schema in `supabase/tests/handler-postgres.test.js`.
- To verify, run this in the Supabase SQL editor after applying: `select column_name from information_schema.columns where table_name = 'papers' and column_name like 'manual_entry%';` It should return two rows.

**2. Application deployment: merging M1 (after M0).**
- This happens only after step 1.
- The application's behaviour then depends on decision 3.

**3. The production extraction mode (`EXTRACTION_MODE`).** This is a product decision, set in Vercel → `research-platform-5zpu` → Settings → Environment Variables, scoped to **Production** only. It takes effect on the next deployment.
- **Unset or invalid:** treated as `manual`, and logged as `extraction_mode_defaulted`. This is the fail-safe default, not a recommended way to run.
- **`manual`:**
  - Nothing is sent to any provider.
  - Each paper handled in this mode has the decision stored (`manual_entry_source = 'mode'`), and it is not extracted later even if the mode changes.
  - Researchers enter the details themselves.
- **`automatic`:** the existing extraction, with a manual path offered whenever reading does not produce a result.

Choosing `automatic` keeps today's workflow. It is **not** an unconditional recommendation; see decision 4.

**4. Whether the external provider arrangement supports the intended processing.**
- This is **unverified** (`CURRENT_STATUS.md`, `PHASE_3_PLAN.md` §5).
- M1 gives a way to stop sending documents out. It says nothing about whether the current Gemini arrangement is compatible with any commitment made to researchers.
- The new agreement stays inactive (`docs/legal/README.md`).

**Available rollout paths** (none of them changes anything by itself; each is a founder decision):

| Path | Steps | Effect |
|---|---|---|
| A. Keep today's workflow | Apply 0011 → set `EXTRACTION_MODE=automatic` → merge M0, then M1 → verify | Automatic extraction continues under the same, still unverified, provider arrangement, with the new manual fallback. |
| B. Stop external processing | Apply 0011 → set `EXTRACTION_MODE=manual` → merge M0, then M1 → verify | No document is sent to the provider; every researcher enters details by hand. |
| C. Defer | Apply 0011 only (safe with the current app) | Nothing visible changes. M1 can be merged later via A or B. |

**Verify after a deployment.**
1. Send a request with a token that matches no paper. It returns `404` with the mode in the body (`"mode":"automatic"` or `"mode":"manual"`), without touching any paper:

   `curl -s -X POST https://research-platform-5zpu.vercel.app/api/extract -H 'content-type: application/json' -d '{"token":"verify-mode-no-such-token"}'`

   A `503` with `database_not_ready` means step 1 was skipped.
2. Check the function logs for `extraction_mode_defaulted`, which should not appear, and for `manual_entry_not_recorded`, which should not appear.

**Changing mode later** only requires setting the variable and redeploying.
- Papers already carrying a manual decision stay manual.
- Papers still `pending` with no decision are extracted on their next visit in automatic mode. In manual mode a paper gets its decision the first time the server sees it: the submission form's own request, or the confirmation page. The remaining gap is a paper submitted in manual mode whose requests all failed. Its decision was never stored, so after a switch to automatic it would be extracted when next opened. Check first with `select id, created_at from papers where extraction_status = 'pending' and manual_entry_at is null and metadata_confirmed_at is null;`

**What a switch cannot do:**
- It cannot recall a provider request already running. That request finishes (up to `maxDuration`, 300s) and its result is appended to `ai_generations`.
- That result is applied to the paper only if nobody has confirmed and no manual decision was recorded in the meantime.

**Rollback limitations.**
- *Application:* reverting M1 is a normal revert. The pre-M1 code **ignores** manual decisions: it would extract a paper whose researcher chose manual entry when that paper is next opened, and it has no manual mode at all. This is demonstrated in `handler-postgres.test.js`. Review `select count(*) from papers where manual_entry_at is not null and metadata_confirmed_at is null;` before reverting.
- *Database:* do not roll back 0011 while M1 is deployed, because M1 would then refuse every request. Dropping the columns permanently deletes recorded decisions. The steps are at the bottom of the migration file.

**Previews** carry no service-role key.
- On a preview, both routes answer `503` with `recorded: false`, which is accurate: nothing can be stored.
- In manual mode the confirmation page still shows the form, because the page knows the mode. In automatic mode the preview guard blocks extraction, and the page offers hand entry at once. Choosing it on a preview reports that the choice could not be saved.

**No tool has ever been available to verify what's actually set in Vercel's environment variable store remotely.** If something behaves like a missing/wrong variable, check the Vercel dashboard directly.

## Deploy process

1. Code changes go to the `research-platform` branch of `samerawad2025-prog/research-platform` on GitHub. Vercel auto-deploys from that branch.
2. **Three Vercel projects are linked to this same GitHub repo** (`research-platform-5zpu`, `research-platform-88r9`, `research-platform`). Only `research-platform-5zpu` has been confirmed as the one actually serving production traffic. This ambiguity has never been fully resolved — worth cleaning up, and worth double-checking which project you're looking at before trusting its logs or settings.
3. Database changes are separate, incremental SQL files in `supabase/migrations/`, run manually via Supabase → SQL Editor. **Never re-run `supabase/schema.sql` against the live database** — it's for fresh installs only.

## After every deploy: verify it actually landed

This is not optional caution — it's a documented, repeated failure mode on this project. At least three separate incidents were "the fix is right, it just isn't live yet," each one costing real debugging time before being caught. The cheapest verification: submit one real paper, then query `ai_generations.notes` and `papers.failure_code` / `extraction_status` in Supabase directly. The exact wording and structure of what's stored is a fingerprint of which code version is actually running — this is literally how deployment lag was caught multiple times (see `.claude/commands/verify-deployment.md` if using Claude Code, or `troubleshooting.md`).

## Fresh install vs. live database

`supabase/schema.sql` builds a complete, correct database from nothing — use it only for a new Supabase project. The live production database has been built up through the ordered migrations in `supabase/migrations/`; that folder, not `schema.sql`, is the actual history of the live database's current shape.
