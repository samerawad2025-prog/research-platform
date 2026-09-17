# CURRENT_STATUS.md

**Generated:** September 13, 2026, by direct query against the live Supabase production database (project `jyqvhaqyrsfqkkcxiwth`) — every claim below is backed by a query result, not carried over from prior notes. This supersedes the "Known issues" section of `CLAUDE_CODE_HANDOVER.md` as the current source of truth; that file's history sections remain accurate for *how* things were found and fixed.

**Updated:** September 17, 2026, documentation-only pass (first pass: Supabase/Vercel unavailable, GitHub-only evidence for bugs D/E/G/H). **Updated again same day** once Supabase and Vercel access were reconnected: samerawad2025-prog/research-platform#1 was merged (merge commit `5b28d1e8`) and independently confirmed deployed to production (`research-platform-5zpu`, deployment `dpl_DrZabRmYNGnhizjwpZ23mHE6P8cD`, `state: READY`, `target: production`, built from commit `5b28d1e8`). The papers/`ai_generations` counts were re-queried at that time and are unchanged from 2026-09-13 (no new submissions since) — see bug H below for what that does and doesn't prove.

---

## Production status (live snapshot, 2026-09-13, re-queried and reconfirmed unchanged 2026-09-17 22:07 UTC)

- **44 total papers**: 28 `completed`, 10 `failed`, 6 `pending`, 0 `processing`, 0 `partial` — identical counts on re-query, no drift, no regression introduced by the #1 deploy.
- **77 `ai_generations` rows** on `provider='gemini'`, `model_used='gemini-3.6-flash'`, spanning 2026-09-03 through **2026-09-13 20:52**. Re-queried 2026-09-17: zero new rows, zero rows in the last hour — **no document has been submitted since the #1 deploy went live**, so this snapshot cannot yet speak to bugs G or H in production use (see those rows below).
- 8 older `ai_generations` rows have `model_used=null` (pre-dates the model-name being recorded; historical only).
- No `supabase_migrations` tracking rows exist (migrations are applied by hand via the SQL Editor, consistent with `supabase/migrations/README.md` — this is expected, not a gap).
- **samerawad2025-prog/research-platform#1 is merged and deployed** (merge commit `5b28d1e8`, production deployment `dpl_DrZabRmYNGnhizjwpZ23mHE6P8cD`, confirmed `READY`) — but deployed is not the same claim as exercised; see bugs G and H.

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
| E | Three Vercel projects linked to the same GitHub repo, ambiguous which serves production | Unresolved as of 2026-09-13; not independently verified that session (no Vercel MCP tool was queried). | **Closed.** `research-platform-88r9` and `research-platform` were deleted 2026-09-15/16. The residual check (does `research-platform-5zpu`'s Production Branch setting actually point at `research-platform`) is now independently confirmed: `get_project`'s `latestDeployment.target` is `"production"` and was triggered directly by a push to the `research-platform` branch (commit `5b28d1e8`) — that only happens if the Production Branch setting matches. Nothing left open here. |
| F | No tool available to read Vercel environment variables remotely | Unchanged. | **Still open, structural.** Re-confirmed 2026-09-17 with live Vercel MCP access connected (`get_project`, `list_deployments`, `get_deployment`, `get_deployment_build_logs` all checked — none expose env vars) — this really is a missing capability, not a session-specific gap. Check the dashboard directly. |
| G | `app/api/extract/route.js` had no `maxDuration`, risking the platform's default function timeout killing an in-flight extraction and leaving `extraction_status='processing'` stuck forever with no diagnostics | Found 2026-09-15, fixed in the same commit merged as #1. | **Deployed and confirmed via a healthy production deploy; the exact configured value is the one piece still unconfirmed.** Merged (`5b28d1e8`) and independently confirmed live: production deployment `dpl_DrZabRmYNGnhizjwpZ23mHE6P8cD` is `READY`, built from that commit, `/api/extract` compiled successfully as a dynamic function. **Not confirmed:** the actual numeric `Max Duration` Vercel applied to the deployed function — none of the available Vercel MCP tools (`get_deployment`, build logs) surface per-function runtime config; that one number still needs a dashboard glance (Project → Functions). No evidence of a problem, just no positive confirmation of the exact value either. |
| H | `title_ar`/`abstract_ar` JSON keys were never stated explicitly in the extraction prompt — the same inference gap that caused the `supervisor_name` bug (`BUG_HISTORY.md` #15) | Found 2026-09-15/16, fixed in the same commit merged as #1. | **Deployed, but still functionally unexercised.** The new prompt text is live in production as of `5b28d1e8` (confirmed deployed). But a re-query of `ai_generations` immediately after deploy (2026-09-17 22:07 UTC) shows **zero new rows since 2026-09-13** — nobody has submitted a document since the deploy, so the new prompt has not yet been run against a real Gemini call. "Deployed" is confirmed; "working" is not. **Do not mark this verified until** a real Arabic-only and a real bilingual document are submitted and `ai_generations.result_data` is inspected directly to confirm `title_ar`/`abstract_ar` populate under their own keys. |

## Items removed from "open" status (closed by verification, listed with the pass that closed them)

Closed by the 2026-09-13 Supabase verification pass (carried as *unconfirmed against live data* in `CLAUDE_CODE_HANDOVER.md` §8 before then):
- Supervisor key normalization (#15) — **confirmed live**, no longer "mock-tested only."
- DOCX header extraction (#16) — **confirmed live**, no longer "mock-tested only."
- Researcher-list merge filtering (#13) — **reconfirmed** against fresh real data (previously confirmed against older real data only).

Closed by this 2026-09-17 documentation pass (GitHub evidence gathered 2026-09-15/16, then Supabase/Vercel evidence gathered directly the same day once access reconnected):
- **D** — GitHub MCP connectivity. Fully closed.
- **E** — fully closed. Two ambiguous projects deleted, and the residual Production Branch check confirmed directly via `get_project`/`list_deployments`, not just inferred.
- **PR #1 merge + deployment (G/H's deployment half)** — merged and confirmed deployed to production via `get_project`, `list_deployments`, and `get_deployment` (commit `5b28d1e8`, deployment `dpl_DrZabRmYNGnhizjwpZ23mHE6P8cD`, `READY`). G and H themselves stay open (see table) — this only closes "is it live," not "is it working."

## Technical debt

- 6 orphaned `pending` papers pre-dating current code — cosmetic/data cleanup, not urgent, but visible in any admin view once one exists (unchanged, see bug C).
- ~~Three ambiguous Vercel project links to the same repo (handover §8 item 2) — unresolved housekeeping risk (wrong project could get edited/promoted by mistake).~~ Fully resolved: reduced to one project 2026-09-15/16, and its Production Branch setting independently confirmed correct 2026-09-17 (see bug E).
- No CI wired to `scripts/test-docx-extraction.js` — it exists and works standalone but isn't run automatically on any change (unchanged).
- Legacy `ai_generations` rows (8, `model_used=null`) and stale field names in older rows (`methodology`, `keywords`, `abstract_en`, etc.) — historical only, already documented, no action needed.
- `methodology`/`keywords`/`themes` columns remain in `papers` schema, unused since extraction scope was simplified — harmless, but a future schema reviewer should know they're intentionally dead.
- ~~GitHub connectivity from this assistant session is currently broken — should be fixed before relying on this session for repo-state checks.~~ Resolved 2026-09-15, see bug D.
- `README.md` describes the project as "Step 2" and points to a nonexistent `DEPLOYMENT_GUIDE.md` — identified 2026-09-13 in `CLEANUP_PLAN.md`, not yet fixed.
- `.env.local.example`'s `GEMINI_MODEL` comment is stale (`gemini-2.5-flash` vs. actual default `gemini-3.6-flash`) — identified 2026-09-13 in `CLEANUP_PLAN.md`, not yet fixed.

## Next recommended priorities

1. **Submit one real Arabic-only document and one real bilingual document** through the live `/submit` flow, then inspect `ai_generations.result_data` directly — this is the only thing standing between bug H and being closeable. Nothing else is blocking it.
2. **(Optional, low priority) Confirm the exact `Max Duration` value Vercel applied** to the deployed `/api/extract` function via the dashboard (Project → Functions) — the deployment itself is confirmed healthy; this only confirms the specific number, and there's no evidence of a problem either way.
3. **Force a real (or realistically simulated) pass-2/API failure against the live deployment** to actually exercise the resilience-phase code path (`failure_code` population, `partial` status) — still the single largest confirmed-vs-assumed gap left; unchanged since 2026-09-13, now with the added benefit that any such test would also exercise the new `maxDuration` config for real.
4. **Decide what to do with the 6 orphaned `pending` papers** (manually re-trigger extraction, or mark abandoned) — founder decision, not a code change.
5. Only after 1 and 3 above: resume the explicitly-paused roadmap work — per `PHASE_2_PLAN.md`, the phone input redesign is the recommended first feature, ahead of the landing page/design system or Step 4 article generation.
