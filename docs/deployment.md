# Deployment

> **Release order and steps live in [`docs/release-runbook.md`](release-runbook.md)** (authoritative since 2026-09-30). This file explains the reasoning; where the two differ, the runbook wins.

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
| `SUBMISSION_ACCEPTANCE_FLOW` | No. Leave unset in production until cutover step 4 (`docs/submission-flow.md`, "Cutover") | `enabled` serves `/api/submissions/*` and the acceptance form at `/submit` (Phase 3 M2A/M2B); anything else serves the legacy form and 404s the endpoints. Never enabled without an active agreement (the form would say submissions are unavailable). After migration 0014 it **must** be `enabled`, or the legacy form is served and every submission fails. |
| `ADMIN_REVIEW` | No. Leave unset until migration 0015 is applied and a first administrator is bootstrapped (`docs/admin-review.md`, §2) | `enabled` serves `/admin` and `/api/admin/*` (Phase 3 M4); anything else 404s every one of them. Needs `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (the browser signs staff in with Supabase Auth) and `SUPABASE_SERVICE_ROLE_KEY` (server-only). Disable public sign-up in Supabase Auth first. The review area also needs the volunteer confidentiality version activated in the database before any volunteer can work. |
| `PUBLIC_RESEARCH` | No. Leave unset until the release requirements in `docs/public-research.md` §8 are met | `enabled` serves `/research`, `/api/research`, the approved-file route and a non-empty sitemap (Phase 3 M5); anything else 404s them. Needs migrations 0015 and 0016. |
| `PUBLIC_SITE_ORIGIN` | No | The permanent `https://` origin for canonical URLs, the sitemap and social previews. Never taken from the request host. Unset: no canonical URL, pages ask not to be indexed, sitemap empty. |
| `SUBMISSION_TOKEN_SECRET` | Only with the flow enabled | Server-only, at least 32 characters, **Production scope only**. Derives confirmation tokens and hashes request-limit keys. |
| `ALLOW_PREVIEW_EXTRACTION` | No | `true` lets a preview run automatic extraction. Only matters in `automatic` mode; manual mode never calls a provider anywhere. |

A non-secret template of all of these is in `.env.local.example`.

### Rollout: Phase 3 M1 (five separate decisions)

M1 rollout involves five decisions. They are independent, and each has its own evidence.

**1. Database readiness: a prerequisite, whatever the mode.**
- Migration `supabase/migrations/0011_manual_entry.sql` must be applied **before** the M1 application is deployed. It adds:
  - `papers.manual_entry_at` and `manual_entry_source`, the recorded manual decision;
  - `papers.submission_extraction_policy`, stamped on every new paper by a trigger and immutable afterwards;
  - `extraction_policy`, a single row holding the processing policy for **new** submissions. It **starts as `manual`**.
- M1 reads these columns on every extraction and manual-entry request. Without them it refuses with `503 database_not_ready`, in **every** mode. It never guesses, and it never falls back to calling the provider.
- The migration is additive and compatible with the application in production today (`f45dc690`). This was verified by running that exact route code, and the anonymous `submit_paper` RPC, against the migrated schema (`supabase/tests/handler-postgres.test.js`).
- Applying it changes nothing visible while that application runs: the trigger stamps new papers, and the old code ignores the stamp.
- To verify after applying, in the Supabase SQL editor:
  - `select mode from extraction_policy;` should return one row.
  - `select column_name from information_schema.columns where table_name = 'papers' and (column_name like 'manual_entry%' or column_name = 'submission_extraction_policy');` should return three rows.

**2. The submission policy (`extraction_policy.mode`).** This is set in the database, and it takes effect immediately for papers submitted from then on.
- Each paper keeps the policy it was submitted under.
- M1 extracts automatically only when **both** of these are true:
  - the server runs `EXTRACTION_MODE=automatic`;
  - the paper was submitted under `automatic`, or predates 0011 (a `null` stamp, meaning it was submitted through the pre-M1 form and its AI-processing consent).
- A paper submitted under `manual` is never extracted automatically, even after both settings are later switched to automatic. When the server first sees such a paper in automatic mode, it records a manual decision for it.
- This closes the gap where a paper submitted during manual operation, whose manual decision was never recorded because every follow-up request failed, could be extracted after a switch back to automatic. A missing decision is never treated as permission.
- To change the policy: `update extraction_policy set mode = 'automatic', changed_at = now();` (or `'manual'`).
- **Interim scope.** This is an interim, database-side safeguard. Recording the processing decision inside the submission request itself belongs to M2's server-controlled submission path.

**3. Application deployment: merging M1 (after M0).**
- This happens only after step 1.
- The application's behaviour then depends on decisions 2 and 4.

**4. The production extraction mode (`EXTRACTION_MODE`).** This is a product decision, set in Vercel → `research-platform-5zpu` → Settings → Environment Variables, scoped to **Production** only. It takes effect on the next deployment.
- **Unset or invalid:** treated as `manual`, and logged as `extraction_mode_defaulted`. This is the fail-safe default, not a recommended way to run.
- **`manual`:**
  - Nothing is sent to any provider.
  - Each paper handled in this mode has the decision stored (`manual_entry_source = 'mode'`).
  - Researchers enter the details themselves.
- **`automatic`:** the existing extraction, for papers the submission policy allows, with a manual path offered whenever reading does not produce a result.
- Keeping today's workflow needs **both** `EXTRACTION_MODE=automatic` and `extraction_policy.mode = 'automatic'`. Neither is an unconditional recommendation; see decision 5.

**5. Whether the external provider arrangement supports the intended processing.**
- This is **unverified** (`CURRENT_STATUS.md`, `PHASE_3_PLAN.md` §5).
- M1 gives a way to stop sending documents out. It says nothing about whether the current Gemini arrangement is compatible with any commitment made to researchers.
- The new agreement stays inactive (`docs/legal/README.md`).

**Available rollout paths.** None of them changes anything by itself; each is a founder decision.

| Path | Steps | Effect |
|---|---|---|
| A. Keep today's workflow | Apply 0011 → `update extraction_policy set mode = 'automatic'` → set `EXTRACTION_MODE=automatic` → merge M0, then M1 → verify | Automatic extraction continues, under the same still-unverified provider arrangement, with the new manual fallback. Papers submitted between applying 0011 and the policy update are stamped `manual` and get hand entry. Doing the update right after the migration keeps that window short. |
| B. Stop external processing | Apply 0011 (policy stays `manual`) → set `EXTRACTION_MODE=manual` → merge M0, then M1 → verify | No document is sent to the provider, and every researcher enters details by hand. Papers submitted during this period stay manual permanently. |
| C. Defer | Apply 0011 only (safe with the current app) | Nothing visible changes. Note that new papers are stamped `manual` from this point, so after a later path A they get hand entry rather than extraction, unless the policy was set to `automatic` first. |

**Verify after a deployment.**
1. Send a request with a token that matches no paper. It returns `404` with the mode in the body (`"mode":"automatic"` or `"mode":"manual"`), without touching any paper:

   `curl -s -X POST https://research-platform-5zpu.vercel.app/api/extract -H 'content-type: application/json' -d '{"token":"verify-mode-no-such-token"}'`

   A `503` with `database_not_ready` means step 1 was skipped.
2. Check the function logs:
   - `extraction_mode_defaulted` should not appear, nor should `manual_entry_not_recorded`;
   - `extraction_refused_submission_policy` means papers submitted under `manual` were seen, which is expected only for those.

**Changing mode later.**
- Changing `EXTRACTION_MODE` requires a redeploy. Changing the policy row does not.
- Papers already carrying a manual decision, or submitted under a `manual` policy, stay manual.
- To stop external processing as quickly as possible, set the policy row to `manual` (immediate for new submissions) **and** `EXTRACTION_MODE=manual` (on the next deployment).

**What stopping can and cannot do (the cancellation boundary).**
- Claiming a paper does not send anything. The document leaves the server only when a provider request is dispatched.
- Immediately before every such request, the server re-reads the paper: before pass 1, before pass 2, and before each provider retry. If a manual decision or a confirmation has been recorded by then, the request is not sent.
- If the re-check itself cannot be read, nothing is sent and the run fails as retryable.
- A stop before the first request is recorded with `failure_code = 'stopped_before_dispatch'`, and its history row names no provider.
- A request that has already been dispatched **cannot be recalled**. It finishes (bounded by the provider timeout and `maxDuration`, 300s), and its result is appended to `ai_generations`.
- That result is **not** applied to the paper's metadata if a manual decision or a confirmation was recorded in the meantime.
- There is a remaining window: a decision recorded after the re-check has passed but before that request completes cannot stop that request, only the ones after it.

**Rollback limitations.**
- *Application:* reverting M1 is a normal revert, but the pre-M1 code **ignores** both manual decisions and the submission-policy stamp. When a paper is next opened, it would extract:
  - a paper whose researcher chose manual entry;
  - a paper submitted under a `manual` policy.

  Both are demonstrated in `handler-postgres.test.js`. Before reverting, review: `select count(*) from papers where metadata_confirmed_at is null and (manual_entry_at is not null or submission_extraction_policy = 'manual');`
- *Database:* do not roll back 0011 while M1 is deployed, because M1 would then refuse every request. Dropping the columns permanently deletes recorded decisions and stamps. The steps are at the bottom of the migration file.

**Previews** carry no service-role key.
- On a preview, both routes answer `503` with `recorded: false`, which is accurate: nothing can be stored.
- In manual mode the confirmation page still shows the form, because the page knows the mode.
- In automatic mode the preview guard blocks extraction, and the page offers hand entry at once. Choosing it on a preview reports that the choice could not be saved.

**No tool has ever been available to verify what's actually set in Vercel's environment variable store remotely.** If something behaves like a missing/wrong variable, check the Vercel dashboard directly.

## Deploy process

1. Code changes go to the `research-platform` branch of `samerawad2025-prog/research-platform` on GitHub. Vercel auto-deploys from that branch.
2. **Three Vercel projects are linked to this same GitHub repo** (`research-platform-5zpu`, `research-platform-88r9`, `research-platform`). Only `research-platform-5zpu` has been confirmed as the one actually serving production traffic. This ambiguity has never been fully resolved — worth cleaning up, and worth double-checking which project you're looking at before trusting its logs or settings.
3. Database changes are separate, incremental SQL files in `supabase/migrations/`, run manually via Supabase → SQL Editor. **Never re-run `supabase/schema.sql` against the live database** — it's for fresh installs only.

## After every deploy: verify it actually landed

This is not optional caution — it's a documented, repeated failure mode on this project. At least three separate incidents were "the fix is right, it just isn't live yet," each one costing real debugging time before being caught. The cheapest verification: submit one real paper, then query `ai_generations.notes` and `papers.failure_code` / `extraction_status` in Supabase directly. The exact wording and structure of what's stored is a fingerprint of which code version is actually running — this is literally how deployment lag was caught multiple times (see `.claude/commands/verify-deployment.md` if using Claude Code, or `troubleshooting.md`).

## Fresh install vs. live database

`supabase/schema.sql` builds a complete, correct database from nothing — use it only for a new Supabase project. The live production database has been built up through the ordered migrations in `supabase/migrations/`; that folder, not `schema.sql`, is the actual history of the live database's current shape.
