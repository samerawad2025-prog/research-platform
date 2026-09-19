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

## Production status (live snapshot, 2026-09-19)

- **7 total papers**: 5 `completed`, 1 `failed` (a CV, correctly classified `not_research`), 1 stuck in `processing` (see bug K/L below — repaired after the fix deployed).
- **One completed paper has `title_ar` populated** from a real Arabic document — the first time the bilingual mapping has been exercised end to end in production.
- Documents covered so far: English thesis (PDF and DOCX), an Arabic-named file, an Arabic-content research report, an Arabic thesis, and a CV correctly rejected as `not_research`.

## Confirmed working on the rebuilt database

- **Schema rebuild is correct.** All 6 tables present with RLS enabled; all 4 RPCs present; the three `SECURITY DEFINER` functions all carry `search_path = public, extensions`, with pgcrypto confirmed installed in `extensions` — `BUG_HISTORY.md` #1 is structurally prevented, not merely absent.
- **Storage bucket correct.** `papers`: private, 20 MB limit, PDF + DOCX mime types only.
- **End-to-end submission works** for English PDF and DOCX, and for Arabic documents: upload → `submit_paper` → `/api/extract` → two-pass extraction → `completed`, correctly classified, confirmation writing researchers back.
- **Arabic extraction is production-proven.** A real Arabic thesis returned `title_ar`, `abstract_ar`, `university` (`جامعة النيلين`) and `degree_type` (`الماجستير في الاقتصاد`) correctly from a live Gemini call.
- **The `partial` resilience path works.** First-ever `partial` outcome occurred 2026-09-19: pass 1 succeeded, pass 2 hit a Gemini 429, pass 1's result was preserved unmerged and `pass2Failure` recorded — exactly as `BUG_HISTORY.md` #10 specifies.
- **`maxDuration = 300` is deployed** (merged in #1 as `5b28d1e8`). The exact configured value has not been read back from a function-config endpoint — no available tooling exposes one — but the deployment is healthy and no extraction has been cut short.

## Open bugs

| # | Symptom | Evidence | Status |
|---|---|---|---|
| F | No tool reads Vercel environment variables remotely | Re-confirmed 2026-09-18 with live Vercel access (`get_project`, `list_deployments`, `get_deployment` — none expose env vars). | **Open, structural.** Check the dashboard directly. |
| M | **Gemini 429 handling ignores the delay the server states** | On 2026-09-19 a 429 said *"Please retry in 12.577097057s"*; the code retried after a fixed 1500 ms. The second 429 then said *"retry in 10.830900339s"* — the 1.746 s difference proves a rolling window and proves the retry landed **inside** it. It could not have succeeded. `response.headers` is never read (so `Retry-After` is discarded) and the body is truncated at 500 chars, cutting off `RetryInfo.retryDelay`. `RETRYABLE_STATUSES = [503, 429]` also conflates two different failures: a 503 retry is free, but a 429 retry **spends more of the quota you just exhausted**. | **Open.** *Supersedes bug I* — generic backoff (2s/8s = 10s cumulative) would also have failed here; honouring the server's stated delay is strictly better. Fix: split 429 from 503, honour `Retry-After` → `RetryInfo.retryDelay` → message text, **cap at ~20–30 s** (an exhausted daily quota returns an hours-long delay that would hang the function), and don't retry 429 on pass 2 at all — degrade to `partial` immediately. |
| J | **A failed or stalled extraction has no recovery path** | The CAS guard in `app/api/extract/route.js` only claims papers where `extraction_status = 'pending'`. Proven materially harmful on 2026-09-19: paper `bb6db427` stranded in `processing` could not be rescued by the confirmation page's own safety-net re-trigger, because that calls `/api/extract`, which refuses to claim anything not `pending`. | **Open.** The safety net is structurally unable to help the exact case it exists for. Needs its own decision (route + RPC + confirmation UI). |
| N | `not_research` path never sets `failure_code` | `app/api/extract/route.js` sets `extraction_status='failed'` and `document_type='not_research'` but leaves `failure_code` null, contradicting `CLAUDE_CODE_HANDOVER.md` §4, which lists `not_research` as a valid value. Live evidence: the CV submitted 2026-09-19 has `failure_code: null`. | **Open, cosmetic.** No user-facing impact — the 422 message is still correct and specific. Diagnostic/contract inconsistency only. |

## Items closed

**Closed 2026-09-18**

- **D** — GitHub MCP connectivity. Worked across every session since 2026-09-15.
- **E** — Vercel project ambiguity. Fully closed: the two stray projects were deleted, and `research-platform-5zpu`'s Production Branch setting was confirmed correct by observing a `production`-target deploy fire from a `research-platform` push.
- **A** — typed `failure_code`, closed by real production evidence (above).
- **`BUG_HISTORY.md` #17** — Arabic/non-ASCII filenames failed to upload silently. Fixed in `components/SubmissionForm.jsx`.

**Closed 2026-09-19**

- **B** — missing `maxDuration` / stuck-`processing` risk. `export const maxDuration = 300` merged in PR #1 (`5b28d1e8`) and deployed; see the caveat under "Confirmed working" about reading the value back.
- **H** — `title_ar` / `abstract_ar` pipeline inconsistency. Closed by production evidence, not by inspection: a real Arabic thesis returned `title_ar` and `abstract_ar` and both were written to `papers`. The prompt now states both JSON keys explicitly (`BUG_HISTORY.md` #15's rule).
- **K** — year coercion stranding an extraction. Fixed; `BUG_HISTORY.md` #18.
- **L** — unchecked `papers` updates swallowing write errors. Fixed; `BUG_HISTORY.md` #19.

## Technical debt

- No CI wired to `scripts/test-docx-extraction.js` or `scripts/test-year-normalization.js` — both exist, both pass standalone, neither runs on anybody's schedule.
- `README.md` describes the project as "Step 2" and points to a nonexistent `DEPLOYMENT_GUIDE.md` (identified 2026-09-13 in `CLEANUP_PLAN.md`, still unfixed).
- `.env.local.example`'s `GEMINI_MODEL` comment is stale (`gemini-2.5-flash` vs. the actual default `gemini-3.6-flash`).
- `GEMINI_MODEL` appears unset in production — failure rows recorded `model_used: null`. Harmless (the code default applies) but failure rows don't self-document which model failed.
- `methodology`/`keywords`/`themes` columns remain in `papers`, unused since extraction scope was simplified — intentionally dead, documented, leave alone.
- `supabase/functions/*.sql` mirrors `schema.sql` with nothing enforcing they stay in sync.
- Preview deployments write into the **same** database as production (only one Supabase project exists). An accepted near-zero-budget tradeoff; be aware test submissions from preview branches land in the real `papers` table.

## Next recommended priorities

1. **Repair paper `bb6db427`** — *only after the K/L fix is live in production.* Set it back to `pending` so the confirmation page's own safety-net re-trigger can claim it. Repairing it before the fix deploys would strand it again on the identical value, since the extraction would re-read the same `٢٠١٩م`.
2. **Fix the 429 retry (bug M).** Contained to `callGemini()` in `lib/ai/providers/gemini.js`: split 429 from 503, honour the server-stated delay, cap it, and don't retry a 429 on pass 2 at all. Zero token cost; supersedes the earlier bug I.
3. **Decide on a recovery path for stalled or failed extractions (bug J)** — now proven materially harmful, not theoretical. Needs a deliberate decision across the route, an RPC, and the confirmation UI.
4. **Bug N** — set `failure_code` on the `not_research` path. Cosmetic; do it whenever that file is next open.
5. Only after 1–3: resume paused roadmap work. Per `PHASE_2_PLAN.md` the recommended first feature is the **phone input redesign**, ahead of the landing page/design system or Step 4 article generation.
