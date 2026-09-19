# CURRENT_STATUS.md

**Generated:** September 18, 2026, by direct query against the **current** live Supabase production database (project `mzpkiuovjppmavqkppem`, region `eu-central-1`). This supersedes the "Known issues" section of `CLAUDE_CODE_HANDOVER.md` as the current source of truth; that file's history sections remain accurate for *how* things were found and fixed.

> ## ⚠️ Read this before trusting any pre-2026-09-18 claim
>
> **The original Supabase project (`jyqvhaqyrsfqkkcxiwth`) was deleted on 2026-09-18.** It was rebuilt from `supabase/schema.sql` into a new project the same day. The schema, all six tables, all four RPCs, the RLS policies, and the `papers` storage bucket were all verified correct on the new project.
>
> **All 44 papers and 77 `ai_generations` rows are gone.** They were the founder's own test submissions, so nothing of product value was lost — but that data was the *evidence base* for several claims in `BUG_HISTORY.md` and in earlier versions of this file (the supervisor-key fix #15, DOCX header extraction #16, merge filtering #13).
>
> Those claims are still **true** — each was verified against real production data at the time and documented with specifics — but they can **no longer be re-verified by query**. For a project whose first principle is "check the database rather than trusting notes", treat them as *historical, documented, and no longer requeryable*. Do not cite them as live evidence.

---

## Production status (live snapshot, 2026-09-18 21:15 UTC)

- **2 total papers**, both `completed`, both the same English test thesis (one PDF, one DOCX). 0 `failed`, 0 `pending`, 0 `processing`, 0 `partial`.
- **4 `ai_generations` rows** (2 per paper: "Pass 1" + "Merged result after 1 pass(es)"), `provider='gemini'`, `model_used='gemini-3.6-flash'`.
- **8 `researchers` rows** — 2 submitters plus 6 extracted authors written through `confirm_researcher_metadata`, confirming the full submit → extract → confirm round trip works on the rebuilt database.
- **2 storage objects** in the `papers` bucket, matching the 2 papers exactly. No orphans.

## Confirmed working on the rebuilt database (2026-09-18)

- **Schema rebuild is correct.** All 6 tables present with RLS enabled; all 4 RPCs present; the three `SECURITY DEFINER` functions all carry `search_path = public, extensions`, with pgcrypto confirmed installed in `extensions` — `BUG_HISTORY.md` #1 is structurally prevented, not merely absent.
- **Storage bucket correct.** `papers`: private, 20 MB limit, PDF + DOCX mime types only.
- **End-to-end submission works** for English PDF **and** English DOCX: upload → `submit_paper` → `/api/extract` → two-pass extraction → `completed`, correctly classified `thesis`, and confirmation writing researchers back.
- **`maxDuration = 300` is deployed** (merged in #1 as `5b28d1e8`). The exact configured value has not been read back from a function-config endpoint — no available tooling exposes one — but the deployment is healthy and no extraction has been cut short.

## Open bugs

| # | Symptom | Evidence | Status |
|---|---|---|---|
| A | Typed `failure_code` population | **Closed 2026-09-18.** Two real 503 failures on the *old* project wrote `failure_code='api_error'` with full diagnostics (`httpStatus`, `attempt`, `retriedAfter`, `retryAlsoFailed`). The resilience-phase code is confirmed working. | **Closed** — exercised by a real failure at last. |
| B | `extraction_status='partial'` has never occurred | Still zero occurrences. Both observed failures died on **pass 1**, and `partial` only arises when pass 1 succeeds and pass 2 fails. | **Open — unexercised.** Not evidence of a defect; the path simply hasn't been hit. |
| C | 6 orphaned `pending` papers | **Moot.** Those rows were in the deleted project. The current database has 0 pending papers. | **Closed by circumstance**, not by decision. |
| F | No tool reads Vercel environment variables remotely | Re-confirmed 2026-09-18 with live Vercel access (`get_project`, `list_deployments`, `get_deployment` — none expose env vars). | **Open, structural.** Check the dashboard directly. |
| H | `title_ar`/`abstract_ar` prompt key mapping | Deployed since `5b28d1e8`. Still **never exercised**: no document containing Arabic title/abstract content has completed extraction. Both test papers are English-only, so their `title_ar = null` is correct, not a failure. | **Open — deployed, unverified.** Needs one Arabic-content document to complete extraction. |
| I | **Recurring Gemini 503s are under-retried** | On 2026-09-18, 3/3 Gemini calls hit a 503 on attempt 1; only 1 recovered on the single retry. Net: a 100% first-attempt failure rate became a 67% end-to-end failure rate. `RETRY_DELAY_MS` is a fixed 1500 ms — far short of the "temporary spike" Google's own error text describes. | **Open.** Analysis complete; recommended fix is bounded exponential backoff (~2s then ~8s, jittered) for 503/429 only. Costs no tokens — a 503 is rejected before the model runs. Not yet implemented. |
| J | **A failed extraction has no recovery path** | The CAS guard in `app/api/extract/route.js` only claims papers where `extraction_status = 'pending'`. Once a paper is `failed`, re-running extraction is impossible without manual DB intervention — a transient Google 503 permanently burns that submission and the student must re-upload. | **Open.** Arguably a larger resilience gap than I. Needs its own decision (route + RPC + confirmation UI). |

## Items closed on 2026-09-18

- **D** — GitHub MCP connectivity. Worked across every session since 2026-09-15.
- **E** — Vercel project ambiguity. Fully closed: the two stray projects were deleted, and `research-platform-5zpu`'s Production Branch setting was confirmed correct by observing a `production`-target deploy fire from a `research-platform` push.
- **A** — typed `failure_code`, closed by real production evidence (above).
- **`BUG_HISTORY.md` #17** — Arabic/non-ASCII filenames failed to upload silently. Fixed in `components/SubmissionForm.jsx`.

## Technical debt

- No CI wired to `scripts/test-docx-extraction.js` — it exists and works standalone but runs on nobody's schedule.
- `README.md` describes the project as "Step 2" and points to a nonexistent `DEPLOYMENT_GUIDE.md` (identified 2026-09-13 in `CLEANUP_PLAN.md`, still unfixed).
- `.env.local.example`'s `GEMINI_MODEL` comment is stale (`gemini-2.5-flash` vs. the actual default `gemini-3.6-flash`).
- `GEMINI_MODEL` appears unset in production — failure rows recorded `model_used: null`. Harmless (the code default applies) but failure rows don't self-document which model failed.
- `methodology`/`keywords`/`themes` columns remain in `papers`, unused since extraction scope was simplified — intentionally dead, documented, leave alone.
- `supabase/functions/*.sql` mirrors `schema.sql` with nothing enforcing they stay in sync.
- Preview deployments write into the **same** database as production (only one Supabase project exists). An accepted near-zero-budget tradeoff; be aware test submissions from preview branches land in the real `papers` table.

## Next recommended priorities

1. **Submit one document containing an Arabic title and abstract** — now unblocked by the #17 filename fix. This is the last thing standing between bug H and closure, and it exercises the `title_ar`/`abstract_ar` mapping for the first time in production.
2. **Implement the 503 backoff (bug I).** Analysis is done and the change is contained to `callGemini()` in `lib/ai/providers/gemini.js`. Zero token cost.
3. **Decide on a recovery path for failed extractions (bug J)** — whether a `failed` paper can be re-extracted without manual DB surgery.
4. Only after 1–3: resume paused roadmap work. Per `PHASE_2_PLAN.md` the recommended first feature is the **phone input redesign**, ahead of the landing page/design system or Step 4 article generation.
