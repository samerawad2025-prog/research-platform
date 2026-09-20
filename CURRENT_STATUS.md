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

## Measured stage timings (2026-09-20)

Server-side, `papers.created_at` → first `ai_generations` row, all ten submissions to date: **5.2, 8.8, 13.1, 14.2, 15.2, 16.1, 17.1, 23.4, 23.8, 32.0 seconds** (median ~16s). Pure Gemini time, from the merged-row notes: 3.0–29.3s.

**No run has ever approached the ~6 minutes reported.** The gap was never in the extraction. It came from a stuck `processing` paper looping through a 2-minute poll and a reload-based "retry" that could not restart anything (bug J, now closed), on top of an upload stage nothing had ever measured. Client-side stage timings now land in the function log via `/api/timing`.

Vercel runtime logs for the relevant window are **not recoverable** — the logs API returns `ExceedsBillingLimitError` on this plan's retention. Per-request durations for those submissions are gone; the timings above come from database timestamps.

## Production status (live snapshot, 2026-09-20)

- **8 total papers**: 6 `completed`, 1 `failed` (a CV, correctly classified `not_research`), 1 back at `pending` (`bb6db427`, the paper stranded by bug K — reset after the fix deployed, awaiting a visit to its confirmation link to re-trigger).
- **The K/L fix is confirmed working on real data.** Paper `d5c7b51e`, submitted after the deploy, is the same Arabic thesis that stranded `bb6db427`. It completed, and `year` was written as **2019** from the cover page's `٢٠١٩م` — the exact value that previously rejected the whole UPDATE.
- **Two completed papers have `title_ar` populated** from real Arabic documents.
- **One paper carries a typed placeholder as its title.** `d5c7b51e`'s `title` is the literal sentence `"No title appeared for this research"`, typed by the submitter because the confirmation form would not let them leave an English title empty (bug #20, now fixed). It is confirmed submitter data, so it is theirs to correct — the screen now shows the Arabic title beside it.
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
| O | **`confirm_researcher_metadata` silently drops a year it doesn't like** | The RPC accepts a corrected year only when it matches `^[0-9]{4}$` and otherwise keeps the old value, returning no error. So an Arabic-Indic year typed on the confirmation screen was discarded without telling anyone. Worked around on the client (the year is now normalized to ASCII before being sent, bug #20), but the RPC itself is unchanged. | **Open, medium.** Needs a migration to either accept Arabic-Indic digits or raise a real error instead of failing silently. The client-side workaround means no user-visible impact today. |
| P | **Preview deployments write to the production database** | Only one Supabase project exists, so any branch preview's test submission lands in the real `papers` table. Accepted near-zero-budget tradeoff, recorded here as a risk rather than a bug. | **Open, accepted.** Revisit if a second environment ever becomes affordable. |
| N | `not_research` path never sets `failure_code` | `app/api/extract/route.js` sets `extraction_status='failed'` and `document_type='not_research'` but leaves `failure_code` null, contradicting `CLAUDE_CODE_HANDOVER.md` §4, which lists `not_research` as a valid value. Live evidence: the CV submitted 2026-09-19 has `failure_code: null`. | **Open, cosmetic.** No user-facing impact — the 422 message is still correct and specific. Diagnostic/contract inconsistency only. |

## Items closed

**Closed 2026-09-18**

- **D** — GitHub MCP connectivity. Worked across every session since 2026-09-15.
- **E** — Vercel project ambiguity. Fully closed: the two stray projects were deleted, and `research-platform-5zpu`'s Production Branch setting was confirmed correct by observing a `production`-target deploy fire from a `research-platform` push.
- **A** — typed `failure_code`, closed by real production evidence (above).
- **`BUG_HISTORY.md` #17** — Arabic/non-ASCII filenames failed to upload silently. Fixed in `components/SubmissionForm.jsx`.

**Closed 2026-09-20**

- **J** — a stalled extraction had no recovery path. A paper in `processing` whose claim is older than 360s (strictly above the 300s function ceiling) can now be claimed again, and "Try again" restarts extraction instead of reloading the page. `BUG_HISTORY.md` #27. **Migration 0008 applied to production.**
- **#28** — nothing measured the stages the submitter actually experiences. The upload was entirely invisible because the first server timestamp is written after it completes. Eight client-side stages now reported to `/api/timing`.

- **#24** — an inline validation message rendered `\u2019` as literal text (JSX text node vs. string literal).
- **#25** — the confirmation screen showed two title boxes (and two abstract boxes) for a paper written in one language. Now only the languages the paper actually has; a lone fallback box routes typed text to the right column by script.
- **#26** — the country picker was a native `<select>`, unsearchable and unstyleable across 245 entries. Replaced with an ARIA combobox with search.

- **#20** — the confirmation screen never rendered `title_ar`/`abstract_ar` and hard-required an English title. Root cause of the reported "Arabic title extraction failed", which was not an extraction failure at all. Frontend-only fix; no migration.
- **#21** — pass 2 burned a paid Gemini call re-confirming an absent English title on Arabic-only papers.
- **#22** — WhatsApp numbers had no validation before the upload, and were stored as typed.
- **#23** — no country picker existed; the dial code was a placeholder hint.
- **G** — WhatsApp field was plain text rather than a proper picker (carried from `CLAUDE_CODE_HANDOVER.md` §8 item 9). Closed by #22/#23.

**Closed 2026-09-19**

- **B** — missing `maxDuration` / stuck-`processing` risk. `export const maxDuration = 300` merged in PR #1 (`5b28d1e8`) and deployed; see the caveat under "Confirmed working" about reading the value back.
- **H** — `title_ar` / `abstract_ar` pipeline inconsistency. Closed by production evidence, not by inspection: a real Arabic thesis returned `title_ar` and `abstract_ar` and both were written to `papers`. The prompt now states both JSON keys explicitly (`BUG_HISTORY.md` #15's rule).
- **K** — year coercion stranding an extraction. Fixed; `BUG_HISTORY.md` #18.
- **L** — unchecked `papers` updates swallowing write errors. Fixed; `BUG_HISTORY.md` #19.

## Technical debt

- No CI wired to any of the six test scripts (`test-docx-extraction.js`, `test-year-normalization.js`, `test-language-pairs.js`, `test-phone-validation.js`, `test-field-pairs.js`, `test-timing.js`). All pass standalone; none runs on anybody's schedule. This is now the single highest-value piece of technical debt — there are enough tests to be worth running automatically.
- `lib/extraction/keywordScan.js` has no markers for `year`, so a DOCX missing only its year falls through to the 12,000-character fallback slice rather than a targeted excerpt. Harmless (the fallback works) but wasteful.
- **No DOM/component test harness exists.** Pure logic is well covered, but nothing exercises a rendered component, so `CountrySelect`'s keyboard and pointer behaviour is reasoned from the ARIA pattern rather than verified. Exercise it by hand on the preview.
- The confirmation screen's poll gives up after ~2 minutes and offers a manual retry, which reloads the page. With bug J still open, that retry cannot rescue a paper stuck in `processing`.
- `README.md` describes the project as "Step 2" and points to a nonexistent `DEPLOYMENT_GUIDE.md` (identified 2026-09-13 in `CLEANUP_PLAN.md`, still unfixed).
- `.env.local.example`'s `GEMINI_MODEL` comment is stale (`gemini-2.5-flash` vs. the actual default `gemini-3.6-flash`).
- `GEMINI_MODEL` appears unset in production — failure rows recorded `model_used: null`. Harmless (the code default applies) but failure rows don't self-document which model failed.
- `methodology`/`keywords`/`themes` columns remain in `papers`, unused since extraction scope was simplified — intentionally dead, documented, leave alone.
- `supabase/functions/*.sql` mirrors `schema.sql` with nothing enforcing they stay in sync.
- Preview deployments write into the **same** database as production (only one Supabase project exists). An accepted near-zero-budget tradeoff; be aware test submissions from preview branches land in the real `papers` table.

## Next recommended priorities

1. **Watch `/api/timing` output on the next few real submissions.** The instrumentation is new and unexercised by real users; the upload stage in particular has never been measured. If upload dominates, the next fix is client-side compression or a resumable upload, not anything in the extraction path.
2. **Finish repairing `bb6db427`** — it is back at `pending` and needs its confirmation link opened once to re-trigger extraction. Verified safe: the same document now extracts correctly (`d5c7b51e`).
3. **Fix the 429 retry (bug M).** Contained to `callGemini()` in `lib/ai/providers/gemini.js`: split 429 from 503, honour the server-stated delay, cap it, and don't retry a 429 on pass 2 at all. Zero token cost; supersedes the earlier bug I.
4. **Bug N** — set `failure_code` on the `not_research` path. Cosmetic; do it whenever that file is next open.
5. Only after the above: resume paused roadmap work. Per `PHASE_2_PLAN.md` the recommended first feature is the **phone input redesign**, ahead of the landing page/design system or Step 4 article generation.
