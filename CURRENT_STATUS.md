# CURRENT_STATUS.md

**Generated:** September 13, 2026, by direct query against the live Supabase production database (project `jyqvhaqyrsfqkkcxiwth`) — every claim in the "Production status" and "Confirmed working features" sections below is backed by that query result, not carried over from prior notes. This supersedes the "Known issues" section of `CLAUDE_CODE_HANDOVER.md` as the current source of truth; that file's history sections remain accurate for *how* things were found and fixed.

**Updated:** September 17, 2026, documentation-only pass. **Supabase and Vercel access were unavailable in that session** — the production snapshot below (papers/`ai_generations` counts) is still the 2026-09-13 query result, now 4 days old, and has **not** been re-verified. Only what could be independently confirmed via GitHub this pass is reflected as changed. Do not read the snapshot numbers below as current without re-querying Supabase first.

---

## Production status (live snapshot, 2026-09-13 — not refreshed since)

- **44 total papers**: 28 `completed`, 10 `failed`, 6 `pending`, 0 `processing`, 0 `partial`.
- **77 `ai_generations` rows** on `provider='gemini'`, `model_used='gemini-3.6-flash'`, spanning 2026-09-03 through **2026-09-13 20:52**.
- 8 older `ai_generations` rows have `model_used=null` (pre-dates the model-name being recorded; historical only).
- No `supabase_migrations` tracking rows exist (migrations are applied by hand via the SQL Editor, consistent with `supabase/migrations/README.md` — this is expected, not a gap).
- **Not captured in this snapshot:** samerawad2025-prog/research-platform#1 (the `maxDuration` fix and the `title_ar`/`abstract_ar` prompt fix) is still unmerged as of 2026-09-17 — neither has reached this database yet.

---

## Confirmed working features (verified against real production data as of 2026-09-13, not re-checked since)

- **Two-pass extraction pipeline is live and functioning** on real documents via the real Gemini API. Recent runs show `"Merged result after 1 pass(es)..."` notes with correct document-type classification (`thesis`, `journal_article`) on real submissions as recent as 2026-09-13.
- **Supervisor key fix (was `BUG_HISTORY.md` #15) — production-confirmed as of 2026-09-13.** Of the 15 most recent `ai_generations` rows then, 14 returned the key `supervisor_name` directly; the one exception predates the fix reaching production. No `supervisor`-keyed row had appeared since.
- **DOCX header extraction (was `BUG_HISTORY.md` #16) — production-confirmed as of 2026-09-13.** Multiple real theses submitted 2026-09-11 and 2026-09-13 showed `university`, `faculty`, and `degree_type` populated from DOCX header XML that `mammoth` alone cannot read.
- **Merge-filtering fix (`BUG_HISTORY.md` #13) — reconfirmed as of 2026-09-13.** A real thesis (`13e90987-...`) showed all 6 researchers preserved intact through a two-pass merge.
- **Document-type classification** was discriminating correctly as of 2026-09-13: real `thesis` and `journal_article` documents both correctly classified.
- **`ai_generations` append-only history** was intact as of 2026-09-13 — no evidence of any row being overwritten or deleted.

## Open bugs

| # | Symptom | Evidence | Status |
|---|---|---|---|
| A | `failure_code` is `null` on every one of the 10 failed papers | All 10 failures dated 2026-09-07 through 2026-09-09 16:03, each with a raw, unparsed `"Gemini API error 503: ..."` note. As of the 2026-09-13 snapshot, zero failures had occurred since 2026-09-09. | **Still open — unverified.** No re-query since 2026-09-13; status unchanged because no new evidence exists either way. |
| B | `extraction_status='partial'` has never occurred, ever | Same evidence as A, same date. | **Still open — unverified.** Same as A. |
| C | 6 papers permanently stuck at `extraction_status='pending'` | All 6 dated 2026-08-19 through 2026-09-02, predating the current code's earliest generation record. | **Still open — needs a founder decision** (manually re-trigger or mark abandoned), not a code fix. No decision made yet. |
| D | GitHub MCP connector fails to connect (`bad request: Authorization header is badly formatted`) | Was blocking direct repo/branch verification as of 2026-09-13. | **Closed.** GitHub MCP has connected and worked correctly across every session since 2026-09-15 (repo reads, file operations, PR creation, PR status/comment reads) — confirmed again in this pass. |
| E | Three Vercel projects linked to the same GitHub repo, ambiguous which serves production | Unresolved as of 2026-09-13; not independently verified that session (no Vercel MCP tool queried). | **Mostly closed, one step remains.** On 2026-09-15/16, `research-platform-88r9` and `research-platform` were confirmed (via Vercel MCP, since disconnected) to have never had a Next.js-detected or `production`-target deployment, and were deleted by the founder. Only `research-platform-5zpu` remains. **Still unverified:** whether `research-platform-5zpu`'s own Production Branch setting is correctly pointed at `research-platform` — Vercel access is unavailable in this session to check. |
| F | No tool available to read Vercel environment variables remotely | Unchanged. | **Still open, structural.** Re-confirmed on 2026-09-15/16 (available Vercel tools cover projects/teams/deployments/logs, not env vars) — no such capability exists in any session so far. |
| G | `app/api/extract/route.js` had no `maxDuration`, risking the platform's default function timeout killing an in-flight extraction and leaving `extraction_status='processing'` stuck forever with no diagnostics | Found 2026-09-15, not present in any earlier version of this document. Fix committed to `claude/current-status-paper-count-67xy5x`. | **Open — fixed in code, not deployed, not verified.** samerawad2025-prog/research-platform#1 is still unmerged as of 2026-09-17. **Do not mark this verified until:** (1) merged, (2) `research-platform-5zpu`'s deployed function config confirmed to show `Max Duration: 300s`, per this project's own repeated deployment-lag lesson. |
| H | `title_ar`/`abstract_ar` JSON keys were never stated explicitly in the extraction prompt — the same inference gap that caused the `supervisor_name` bug (`BUG_HISTORY.md` #15) | Found 2026-09-15/16, not present in any earlier version of this document. Fix is in the same PR as G. | **Open — fixed in code, not deployed, not verified.** Same PR, same unmerged state as G. **Do not mark this verified until:** (1) merged, (2) at least one real Arabic-only and one real bilingual document are submitted and `ai_generations.result_data` is inspected directly to confirm `title_ar`/`abstract_ar` populate under their own keys rather than being absorbed into `title`/`abstract` or left `not_found`. |

## Items removed from "open" status (closed by verification, listed with the pass that closed them)

Closed by the 2026-09-13 Supabase verification pass:
- Supervisor key normalization (#15) — confirmed live, no longer "mock-tested only."
- DOCX header extraction (#16) — confirmed live, no longer "mock-tested only."
- Researcher-list merge filtering (#13) — reconfirmed against fresh real data.

Closed by this 2026-09-17 documentation pass (based on GitHub evidence gathered 2026-09-15/16, not on any new query run today):
- **D** — GitHub MCP connectivity. Fully closed.
- **E** — narrowed from "three ambiguous projects" to "one residual setting check on the single remaining project." Not fully closed.

## Technical debt

- 6 orphaned `pending` papers pre-dating current code — cosmetic/data cleanup, not urgent (unchanged, see bug C).
- ~~Three ambiguous Vercel project links to the same repo~~ — reduced to one project; the residual Production Branch check (see bug E) is the only remaining piece of this item.
- No CI wired to `scripts/test-docx-extraction.js` — it exists and works standalone but isn't run automatically on any change (unchanged).
- Legacy `ai_generations` rows (8, `model_used=null`) and stale field names in older rows (`methodology`, `keywords`, `abstract_en`, etc.) — historical only, already documented, no action needed.
- `methodology`/`keywords`/`themes` columns remain in `papers` schema, unused since extraction scope was simplified — harmless, intentionally kept (unchanged).
- ~~GitHub connectivity from this assistant session is currently broken~~ — resolved, see bug D.
- `README.md` describes the project as "Step 2" and points to a nonexistent `DEPLOYMENT_GUIDE.md` — identified 2026-09-13 in `CLEANUP_PLAN.md`, not yet fixed.
- `.env.local.example`'s `GEMINI_MODEL` comment is stale (`gemini-2.5-flash` vs. actual default `gemini-3.6-flash`) — identified 2026-09-13 in `CLEANUP_PLAN.md`, not yet fixed.

## Next recommended priorities

1. **Merge samerawad2025-prog/research-platform#1**, then verify G and H against production before treating either as done — this is now the most direct, already-in-progress continuation of item 1 below, and per this project's own recurring failure mode, "fixed in code" and "verified in production" are not the same claim.
2. **Force a real (or realistically simulated) pass-2/API failure against the live deployment** to actually exercise the resilience-phase code path (`failure_code` population, `partial` status) — still the largest confirmed-vs-assumed gap; nothing new has changed this since 2026-09-13.
3. **Verify `research-platform-5zpu`'s Production Branch setting** — the one remaining piece of item E, now that the other two projects are gone.
4. **Decide what to do with the 6 orphaned `pending` papers** (manually re-trigger extraction, or mark abandoned) — founder decision, not a code change.
5. **Re-run a fresh Supabase production snapshot** the next time Supabase access is available in a session — the numbers in this document are 4 days stale as of this writing and should not be relied on for anything time-sensitive.
6. Only after 1–4 above: resume the explicitly-paused roadmap work (landing page/design system, phone input, or Step 4 article generation) per `CLAUDE_CODE_HANDOVER.md` §13 and `PHASE_2_PLAN.md`.
