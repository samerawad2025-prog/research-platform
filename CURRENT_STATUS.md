# CURRENT_STATUS.md

**Generated:** September 13, 2026, by direct query against the live Supabase production database (project `jyqvhaqyrsfqkkcxiwth`) — every claim below is backed by a query result, not carried over from prior notes. This supersedes the "Known issues" section of `CLAUDE_CODE_HANDOVER.md` as the current source of truth; that file's history sections remain accurate for *how* things were found and fixed.

**Updated:** September 17, 2026, documentation-only pass. **Supabase and Vercel access were unavailable in that session** — the production snapshot below (papers/`ai_generations` counts) is still the 2026-09-13 query result, now 4 days old, and has **not** been re-verified. Only what could be independently confirmed via GitHub this pass is reflected as changed below (bugs D, E, G, H and the technical debt list); the "Production status" and "Confirmed working features" sections remain exactly what the 2026-09-13 query showed. Do not read the snapshot numbers below as current without re-querying Supabase first.

---

## Production status (live snapshot, 2026-09-13 — not refreshed since)

- **44 total papers**: 28 `completed`, 10 `failed`, 6 `pending`, 0 `processing`, 0 `partial`.
- **77 `ai_generations` rows** on `provider='gemini'`, `model_used='gemini-3.6-flash'`, spanning 2026-09-03 through **2026-09-13 20:52** (that day — extraction was actively running against the real Gemini API, not just mock).
- 8 older `ai_generations` rows have `model_used=null` (pre-dates the model-name being recorded; historical only).
- No `supabase_migrations` tracking rows exist (migrations are applied by hand via the SQL Editor, consistent with `supabase/migrations/README.md` — this is expected, not a gap).
- **Not captured in this snapshot:** samerawad2025-prog/research-platform#1 (the `maxDuration` fix and the `title_ar`/`abstract_ar` prompt fix) is still unmerged as of 2026-09-17 — neither has reached this database yet.

---

## Confirmed working features (verified against real production data as of 2026-09-13, not re-checked since)

- **Two-pass extraction pipeline is live and functioning** on real documents via the real Gemini API. Recent runs show `"Merged result after 1 pass(es)..."` notes with correct document-type classification (`thesis`, `journal_article`) on real submissions as recent as 2026-09-13.
- **Supervisor key fix (was `BUG_HISTORY.md` #15) — production-confirmed as of 2026-09-13.** Of the 15 most recent `ai_generations` rows then, 14 returned the key `supervisor_name` directly; the one exception is a single row from 2026-09-11 22:19, which predates the fix reaching production. No `supervisor`-keyed row had appeared since. Previously this fix was verified only against mock/reconstructed data — that gap was closed by the 2026-09-13 pass.
- **DOCX header extraction (was `BUG_HISTORY.md` #16) — production-confirmed as of 2026-09-13.** Multiple real theses submitted 2026-09-11 and 2026-09-13 showed `university`, `faculty`, and `degree_type` populated (e.g. "University of Khartoum" / "School of Management Studies" / "Bachelor of Business Administration & Finance"), sourced from DOCX header XML that `mammoth` alone cannot read. Previously verified only against one forensic test file — the 2026-09-13 pass confirmed it across multiple independent real submissions.
- **Merge-filtering fix (`BUG_HISTORY.md` #13) — reconfirmed as of 2026-09-13.** A real thesis submitted 2026-09-11 (`13e90987-...`) showed all 6 researchers preserved intact through a two-pass merge, matching the fix's intent.
- **Document-type classification** was discriminating correctly as of 2026-09-13: real `thesis` and `journal_article` documents were both present and correctly classified in the data reviewed then.
- **`ai_generations` append-only history** was intact as of 2026-09-13 — no evidence of any row being overwritten or deleted.

## Open bugs

| # | Symptom | Evidence | Status |
|---|---|---|---|
| A | `failure_code` is `null` on every one of the 10 failed papers | All 10 failures are dated 2026-09-07 through 2026-09-09 16:03, each with a raw, unparsed `"Gemini API error 503: ..."` note — the exact shape the *pre-resilience-phase* code would produce. Zero failures of any kind had occurred since 2026-09-09 as of the 2026-09-13 snapshot, and none have been reported since. | **Still open — unverified.** The resilience-phase code (migration `0007_resilience_phase.sql`, bounded retry, typed `failure_code`) may well be deployed and correct — there has simply been no real failure since to test it against, and no re-query has been run since 2026-09-13. Do not treat this as fixed until a genuine failure occurs (or is deliberately forced) and produces a populated `failure_code`. |
| B | `extraction_status='partial'` has never occurred, ever | Same 10 failures above all show `extraction_status='failed'`, not `partial` — but all predate the resilience-phase deploy window (last one 2026-09-09 16:03; production was failure-free since, as of the last check). | **Still open — unverified.** Same root cause/evidence gap as A. |
| C | 6 papers permanently stuck at `extraction_status='pending'` | All 6 are dated 2026-08-19 through 2026-09-02 — i.e. from before the current code's earliest generation record (2026-09-03). Almost certainly orphaned by an earlier deploy (missing-service-role-key era, bug #4, or before the CAS-claim logic existed) rather than a live bug. | **Still open — needs a founder decision:** manually re-trigger or mark these 6 as abandoned — not a code fix. No decision made yet. |
| D | GitHub MCP connector fails to connect (`bad request: Authorization header is badly formatted`) | Was blocking direct repo/branch verification as of 2026-09-13. | **Closed.** GitHub MCP has connected and worked correctly across every session since 2026-09-15 (repo reads, file operations, PR creation, PR status/comment reads) — confirmed again in this pass. |
| E | Three Vercel projects linked to the same GitHub repo, ambiguous which serves production | Unresolved as of 2026-09-13; not independently verified that session (no Vercel MCP tool was queried). | **Mostly closed, one step remains.** On 2026-09-15/16, `research-platform-88r9` and `research-platform` were confirmed (via Vercel MCP, since disconnected) to have never had a Next.js-detected or `production`-target deployment, and were deleted by the founder. Only `research-platform-5zpu` remains. **Still unverified:** whether `research-platform-5zpu`'s own Production Branch setting is correctly pointed at `research-platform` — Vercel access is unavailable in this session to check. |
| F | No tool available to read Vercel environment variables remotely | Unchanged. | **Still open, structural.** Re-confirmed on 2026-09-15/16 (available Vercel tools cover projects/teams/deployments/logs, not env vars) — no such capability exists in any session so far. |
| G | `app/api/extract/route.js` had no `maxDuration`, risking the platform's default function timeout killing an in-flight extraction and leaving `extraction_status='processing'` stuck forever with no diagnostics | Found 2026-09-15, not present in any earlier version of this document. Fix committed to `claude/current-status-paper-count-67xy5x`. | **Open — fixed in code, not deployed, not verified.** samerawad2025-prog/research-platform#1 is still unmerged as of 2026-09-17. **Do not mark this verified until:** (1) merged, (2) `research-platform-5zpu`'s deployed function config confirmed to show `Max Duration: 300s`, per this project's own repeated deployment-lag lesson. |
| H | `title_ar`/`abstract_ar` JSON keys were never stated explicitly in the extraction prompt — the same inference gap that caused the `supervisor_name` bug (`BUG_HISTORY.md` #15) | Found 2026-09-15/16, not present in any earlier version of this document. Fix is in the same PR as G. | **Open — fixed in code, not deployed, not verified.** Same PR, same unmerged state as G. **Do not mark this verified until:** (1) merged, (2) at least one real Arabic-only and one real bilingual document are submitted and `ai_generations.result_data` is inspected directly to confirm `title_ar`/`abstract_ar` populate under their own keys rather than being absorbed into `title`/`abstract` or left `not_found`. |

## Items removed from "open" status (closed by verification, listed with the pass that closed them)

Closed by the 2026-09-13 Supabase verification pass (carried as *unconfirmed against live data* in `CLAUDE_CODE_HANDOVER.md` §8 before then):
- Supervisor key normalization (#15) — **confirmed live**, no longer "mock-tested only."
- DOCX header extraction (#16) — **confirmed live**, no longer "mock-tested only."
- Researcher-list merge filtering (#13) — **reconfirmed** against fresh real data (previously confirmed against older real data only).

Closed by this 2026-09-17 documentation pass (based on GitHub evidence gathered 2026-09-15/16, not on any new query run today):
- **D** — GitHub MCP connectivity. Fully closed.
- **E** — narrowed from "three ambiguous projects" to "one residual setting check on the single remaining project." Not fully closed.

## Technical debt

- 6 orphaned `pending` papers pre-dating current code — cosmetic/data cleanup, not urgent, but visible in any admin view once one exists (unchanged, see bug C).
- ~~Three ambiguous Vercel project links to the same repo (handover §8 item 2) — unresolved housekeeping risk (wrong project could get edited/promoted by mistake).~~ Reduced to one project as of 2026-09-15/16; the residual Production Branch check (see bug E) is the only remaining piece of this item.
- No CI wired to `scripts/test-docx-extraction.js` — it exists and works standalone but isn't run automatically on any change (unchanged).
- Legacy `ai_generations` rows (8, `model_used=null`) and stale field names in older rows (`methodology`, `keywords`, `abstract_en`, etc.) — historical only, already documented, no action needed.
- `methodology`/`keywords`/`themes` columns remain in `papers` schema, unused since extraction scope was simplified — harmless, but a future schema reviewer should know they're intentionally dead.
- ~~GitHub connectivity from this assistant session is currently broken — should be fixed before relying on this session for repo-state checks.~~ Resolved 2026-09-15, see bug D.
- `README.md` describes the project as "Step 2" and points to a nonexistent `DEPLOYMENT_GUIDE.md` — identified 2026-09-13 in `CLEANUP_PLAN.md`, not yet fixed.
- `.env.local.example`'s `GEMINI_MODEL` comment is stale (`gemini-2.5-flash` vs. actual default `gemini-3.6-flash`) — identified 2026-09-13 in `CLEANUP_PLAN.md`, not yet fixed.

## Next recommended priorities

1. **Merge samerawad2025-prog/research-platform#1**, then verify G and H against production before treating either as done — per this project's own recurring failure mode, "fixed in code" and "verified in production" are not the same claim.
2. **Force a real (or realistically simulated) pass-2/API failure against the live deployment** to actually exercise the resilience-phase code path (`failure_code` population, `partial` status) — still the single largest confirmed-vs-assumed gap left; nothing has changed on this since 2026-09-13.
3. **Verify `research-platform-5zpu`'s Production Branch setting** — the one remaining piece of item E, now that the other two projects are gone.
4. **Decide what to do with the 6 orphaned `pending` papers** (manually re-trigger extraction, or mark abandoned) — founder decision, not a code change.
5. **Re-run a fresh Supabase production snapshot** the next time Supabase access is available in a session — the numbers in this document are stale as of this writing and should not be relied on for anything time-sensitive.
6. Only after 1–4 above: resume the explicitly-paused roadmap work (landing page/design system, phone input, or Step 4 article generation) per `CLAUDE_CODE_HANDOVER.md` §13 and `PHASE_2_PLAN.md`.
