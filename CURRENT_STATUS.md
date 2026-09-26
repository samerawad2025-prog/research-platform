# CURRENT_STATUS.md

**Last updated:** September 26, 2026 (Phase 3, Milestone 0; documentation only). **Phases 1 and 2 are closed. Phase 3 is planned in `PHASE_3_PLAN.md` and not yet started in code.** The 2026-09-26 section below is current. Everything under it is dated history and says so.

---

## Status as of 2026-09-26

Four labels are used here and in `PHASE_3_PLAN.md`. Product intent comes from the founder's latest decisions. Implementation status comes only from code, migrations and deployment evidence.

### Implemented and verified

- **Production** serves commit `f45dc690` (merge of PR #15, the last Phase 2 PR).
  - Vercel project `research-platform-5zpu`, production branch `research-platform`.
  - Checked against the Vercel API on 2026-09-26: the public alias `research-platform-5zpu.vercel.app` points to deployment `dpl_77r2jpmzju3aEd93mjsDG7SFsj7S`, which is READY, targets production, was built from `f45dc690`, and was created 2026-09-25 21:21 UTC with `source: redeploy`.
  - It replaced `dpl_5gnPshTXaWZ6BVaNMHm5X7NBkrvz`, the deployment verified when PR #15 merged. The code is the same commit. Who triggered the redeploy, and whether any environment variable changed with it, is **unverified** (see below).
- **The Phase 1 pipeline:** submission → two-pass extraction → confirmation. Evidence is in "Phase 1 closure" below. Nothing in it has changed since.
- **Phase 2 (interface, accessibility, bilingual support, brand): complete.** The evidence is under "Phase 2 closure" below.

### Built and verified, not deployed (2026-09-26)

**Phase 3 M1:** configurable extraction (`EXTRACTION_MODE=automatic|manual`) and a complete manual metadata path. It is on branch `claude/phase3-m1-extraction-mode`, in a PR stacked on the M0 documentation PR. It is **not merged and not in production**, and migration `0011` is **not applied**.

Verified by:
- `scripts/test-extraction-mode.js` (the real route logic against an in-memory database and a network spy);
- `scripts/test-confirmation-view.js`;
- the migration test against a local Postgres;
- localhost Chromium runs in EN/AR at 360–1280px.

Production still runs automatic extraction exactly as before. Before merging, `EXTRACTION_MODE=automatic` must be set in production (`docs/deployment.md` "Rollout"). Details: `PHASE_3_PLAN.md` M1.

### Approved, not built

The founder's Phase 3 decisions of 2026-09-26:
- submissions from any institution;
- UofK-only publication at first;
- two publication settings;
- one acceptance checkbox;
- Facebook removed and LinkedIn visibility made explicit;
- administrative review;
- public pages;
- citation export;
- truthful activity counts.

These are recorded in `PHASE_3_PLAN.md` §1 as milestones M1–M6. Apart from M1 (above, built but not deployed), none of them exists in code yet.

The submission agreement in `docs/legal/` is **written but not active**. See `docs/legal/README.md` for what must be true before it can be activated.

### Proposed for later

See `PHASE_3_PLAN.md` §4: research directions, citation alerts, similarity screening, optional integrations, and the items deferred from Phase 2.

### Unverified

- **The Gemini API project's billing and data-use arrangement.** Nobody has checked it. The free-tier quota behaviour recorded on 2026-09-21 (below) is not accepted as proof of it either way. This decides whether external extraction is compatible with the agreement's no-training commitment (`PHASE_3_PLAN.md` M1).
- **The 2026-09-25 production redeploy.** Its trigger, and whether environment variables changed, are unknown.
- **Supabase plan, backup settings and storage region.** The region was recorded as `eu-central-1` on 2026-09-18; the plan and backups were never recorded.
- The rest are listed in `PHASE_3_PLAN.md` §5, each with the milestone it affects.

### Known gaps in the running system (relevant to Phase 3)

These are facts about current code, not new bugs. Each is scheduled in `PHASE_3_PLAN.md`.

- **Storage upload is not tied to the form.** Storage allows anonymous uploads into the `papers` bucket with no condition beyond the bucket name (`supabase/schema.sql`, policy "anon can upload research files"). `submit_paper` is granted to `anon`. So the form's consent and scope checks are client-side only. Scheduled in M2.
- **Social links depend on the article scope.** `confirm_researcher_metadata` stores LinkedIn and Facebook links only when `publication_scope` contains `metadata_and_article`. Scheduled in M3, which must land no later than M2.
- **Processing permission is not a real choice.** `permission_to_process` is `true` on every row. The form requires the box to be checked, and `submit_paper` rejects any other value. Under the new agreement this is replaced by the single acceptance (M2). The legacy column is kept as evidence.

### Open items carried forward

- **Bug N is still open.** The `not_research` path in `app/api/extract/route.js` sets no `failure_code`. It is cosmetic.
- **The Gemini default model is stale.** The code default in `lib/ai/providers/gemini.js` is still `gemini-3.6-flash`. Production overrides it through `GEMINI_MODEL`.
- **Correction:** `.env.local.example` does **not** exist in the repository. The technical-debt entry below that describes its `GEMINI_MODEL` comment is wrong about the file existing. `README.md` referred to it as well; as of this update `README.md` no longer does. *(M1 branch: an accurate, non-secret `.env.local.example` is added, and `README.md` points to it.)*
- **Previews share the production database.** A separate Supabase project for previews is still recommended.

---

## Phase 2 closure — 2026-09-23

**Phase 2 is closed.** It was delivered as seven milestones in ten pull requests, each merged to `research-platform` after CI and founder review:

| PR | Merge commit | Date | Content |
|---|---|---|---|
| #6 | `8d43c67f` | 2026-09-22 | M1: design token foundation |
| #7 | `eaf1341a` | 2026-09-22 | M2: submission UI migrated to tokens |
| #8 | `73be872e` | 2026-09-23 | M2: confirmation UI migrated to tokens |
| #9 | `0970112b` | 2026-09-23 | M2: button primitive |
| #10 | `5892728d` | 2026-09-23 | M2: accessible names |
| #11 | `436c745f` | 2026-09-23 | M3: site shell and landing page |
| #12 | `65cb6fb2` | 2026-09-23 | M4: bilingual EN/AR with RTL |
| #13 | `9e6ab277` | 2026-09-23 | M5: submission UX |
| #14 | `061125d8` | 2026-09-23 | M6: confirmation UX |
| #15 | `f45dc690` | 2026-09-23 | M7: brand foundation (official name, favicon) |

**Scope evidence, from the repository.** `git diff 8d43c67f^1 f45dc690` touches no file under:
- `supabase/`
- `app/api/`
- `lib/ai/`
- `lib/extraction/`
- `package.json`
- `package-lock.json`

So Phase 2 changed no migration, RPC, API route, extraction logic or dependency. The Phase 1 pipeline evidence still applies to the running code.

**Production evidence at closure.**
- Deployment `dpl_5gnPshTXaWZ6BVaNMHm5X7NBkrvz` was READY and built from `f45dc690`, and the public alias resolved to it.
- The served English pages, CSS, dictionary and favicon matched the merged code.
- Arabic rendering was verified on localhost, not in production: the production browser attempt was blocked by the session's network tunnel. The Arabic strings were confirmed in the deployed bundle.
- Production verification made GET requests only. It wrote nothing to the database or storage and made no extraction calls.

**Deferred out of Phase 2** (these did not keep it open):
- SARP name clearance, and any compact mark;
- visible SARP use, if it is ever cleared;
- the final domain;
- the Open Graph image;
- per-page titles;
- the missing space in the footer email link's accessible name ("Email:sarpcontact…").

These are carried in `PHASE_3_PLAN.md` §4.

---

> **Everything below this line is dated history** (2026-09-18 to 2026-09-21). It stays accurate for what it says, as of when it was said. Where it conflicts with the 2026-09-26 section above, the section above is current.

**Last verified (historical header):** September 21, 2026. **Phase 1 is closed.** See "Phase 1 closure" below for the evidence.

**Originally generated:** September 18, 2026, by direct query against the **current** live Supabase production database (project `mzpkiuovjppmavqkppem`, region `eu-central-1`). This supersedes the "Known issues" section of `CLAUDE_CODE_HANDOVER.md` as the current source of truth; that file's history sections remain accurate for *how* things were found and fixed.

> ## ⚠️ Read this before trusting any pre-2026-09-18 claim
>
> **The original Supabase project (`jyqvhaqyrsfqkkcxiwth`) was deleted on 2026-09-18.** It was rebuilt from `supabase/schema.sql` into a new project the same day. The schema, all six tables, all four RPCs, the RLS policies, and the `papers` storage bucket were all verified correct on the new project.
>
> **All 44 papers and 77 `ai_generations` rows are gone.** They were the founder's own test submissions, so nothing of product value was lost — but that data was the *evidence base* for several claims in `BUG_HISTORY.md` and in earlier versions of this file (the supervisor-key fix #15, DOCX header extraction #16, merge filtering #13).
>
> Those claims are still **true** — each was verified against real production data at the time and documented with specifics — but they can **no longer be re-verified by query**. For a project whose first principle is "check the database rather than trusting notes", treat them as *historical, documented, and no longer requeryable*. Do not cite them as live evidence.

---

---

## Phase 1 closure — 2026-09-21

**Phase 1 is closed.** The closing evidence is five consecutive real submissions, queried live:

| Paper | Created | Title | `title_ar` | Year | Model | Seconds to first generation |
|---|---|---|---|---|---|---|
| `32385ac2` | 15:47 | ✅ | — | 2026 | `gemini-3.5-flash-lite` | 7 |
| `230e19d6` | 15:46 | ✅ | — | 2026 | `gemini-3.5-flash-lite` | 6 |
| `dc6aa173` | 15:45 | ✅ | ✅ | 2026 | `gemini-3.5-flash-lite` | 8 |
| `c7052281` | 15:44 | — | ✅ | 2026 | `gemini-3.5-flash-lite` | 15 |
| `23e55a72` | 15:43 | ✅ | — | 2025 | `gemini-3.5-flash-lite` | 13 |

Five for five `completed`, 6–15 seconds each. `c7052281` is Arabic-only and correctly carries **no** English title — the exact case that used to force a submitter to type "No title appeared for this research" (`BUG_HISTORY.md` #20). `dc6aa173` is genuinely bilingual and carries both. Every one has a year.

The owner confirmed all four paths — PDF and DOCX × English and Arabic — working on the live deployment.

### What changed to get here

- **`GEMINI_MODEL` → `gemini-3.5-flash-lite`.** The previous `gemini-3.6-flash` exhausted its free-tier quota (5 RPM / 35 RPD, observed at 5/5 and 35/35) and produced six consecutive `api_error` / `timeout` failures between 14:45 and 15:23 on 2026-09-21. Flash-Lite's free tier is 15 RPM / 500 RPD. Those six failures are upstream quota, not defects.
- **`GEMINI_TIMEOUT_MS` deleted from Vercel**, falling through to the code default, lowered to 45s in `bbebf8b1`. At the previous 120s a 3-attempt 503 ladder would have run 371s against a 300s `maxDuration` and stranded the paper.
- **Bug P fully closed.** `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` now target `production` only — verified against the Vercel API 2026-09-21. `MOCK_SCENARIO` and `ALLOW_PREVIEW_EXTRACTION` are gone. Six variables remain, exactly the six that should.
- **Bug O closed** by migration `0010`, applied to production 2026-09-21.
- **CI added** — `.github/workflows/checks.yml` runs lint, build and all seven runnable suites on every push and PR.

### Live snapshot (queried 2026-09-21)

32 papers: 22 `completed`, 7 `failed`, 3 `pending`, 0 `partial`. 3 confirmed. 11 carry `title_ar`, 21 carry a year. 40 researchers, 8 without an email. 64 `ai_generations` rows.

Six of the seven failures are the 2026-09-21 quota window above (`fc5d676e`, `69ab58e5`, `55cc8520`, `f33a832e`, `fb6c03a8` — `api_error`; `d699bde4` — `timeout`). The seventh is `3f67ed08`, the CV correctly classified `not_research`. **All six quota failures are retryable** — their `failure_code` is in `TRANSIENT_FAILURE_CODES`, so opening each paper's confirmation link re-runs it against the working model.

Three papers sit at `pending` with no claim ever taken (`b36c31ec`, `3bf48456`, `bb6db427`). They need their confirmation link opened once each to trigger extraction.

### Phase 1 data cleanup — 2026-09-21, complete

Audited against production. **Zero rows written, zero rows deleted** — because the evidence said no write was warranted, not because the work was skipped.

**Bug Q.** No orphan researcher rows exist (`select count(*) ... where not linked and not submitted_by` returns **0**). The eight email-less rows are legitimate extracted co-authors — co-authors never have an email, because the platform only ever collects one from the submitter. `papers.submitted_by` is `not null` and was never touched, so all three submitter rows still carry their email and WhatsApp. Re-linking the submitter on `d5c7b51e` and `f8676a50` would have credited them as an author of a thesis written by `سامي إدريس علي حميدي`. And on `c71a48b9` the present state is exactly what today's fixed code produces, so "repairing" it would make the record diverge from the code. `BUG_HISTORY.md` #40.

**The nine "recoverable" papers.** All nine are byte-identical duplicates of documents that already extracted successfully — proven by joining `papers.file_path` to `storage.objects.metadata->>'size'`, which is necessary because Arabic filenames are sanitized to a bare UUID (#17). Retrying them would have spent free-tier quota to produce rows the database already holds. The tenth non-completed paper is the CV correctly classified `not_research`, deliberately not re-claimable. All are **superseded, not lost**. `BUG_HISTORY.md` #41.

**Final verification (live, 2026-09-21):**

```
papers                        32   (22 completed, 7 failed, 3 pending)
stuck in processing            0
researchers                   40
orphan researchers             0
author links                  37
papers missing submitter row   0
dangling author links          0
confirmed papers whose
  submitter is not an author   3   <- correct, see #40
```

### What Phase 1 does NOT include

Closure means the submission → extraction → confirmation pipeline is verified working, not that everything is done. Explicitly still open: bug N, and everything in `PHASE_2_PLAN.md`. (Bug Q and the nine "recoverable" papers were both audited on 2026-09-21 and both needed no action — see "Phase 1 data cleanup" below.)

---

## Deployment state (historical, 2026-09-20; superseded by "Status as of 2026-09-26" above)

**Production now serves `4c2f9755` (PR #4, merged 2026-09-20).** Deployment `dpl_4mPPSz2t` is READY on the production alias.

**Important for reading everything below:** the audit that produced these findings was carried out while production still served `83a56e59` (PR #3), because PR #4 had never been merged. So a finding marked "verified in production" was verified against `83a56e59` unless it says otherwise, and the fixes merged in PR #4 are **deployed but not yet exercised by a real submission**. The first real submission after this deploy is the evidence that closes them.

**Migration `0008` (`papers.extraction_started_at`) was applied to the production database before the code that writes it.** The code is now live, so the gap is closed. No existing row carries a claim timestamp yet (verified: 0 of 10), which is expected — the column is populated on the next claim.

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
| O | ~~`confirm_researcher_metadata` NULLS a year it doesn't like~~ | Was real: the live body had an explicit `else null`, so `'٢٠١٩'`, `'۲۰۱۹'` and `'٢٠١٩م'` all erased a year the submitter had just confirmed. | **CLOSED 2026-09-21.** Migration `0010` applied to production. A new `normalize_year_text()` matches `lib/extraction/applyResult.js` `normalizeYear` exactly (Arabic-Indic folding, 1900–2100, exactly one in-range year), and an unparseable year now KEEPS the existing value. Verified against the live function on all 14 forms. |
| Q | ~~Confirming a paper detaches its submitter~~ | Audited against production 2026-09-21. The forward fix (`BUG_HISTORY.md` #33) is deployed and proven. The "damage" was **misdescribed by me**: there are **zero** orphan researcher rows, the eight email-less rows are legitimate extracted co-authors, and `papers.submitted_by` was never touched — all three submitter rows still exist with their email and WhatsApp intact. | **CLOSED 2026-09-21, no repair needed.** Re-linking would have fabricated authorship on two papers. `BUG_HISTORY.md` #40. |
| P | ~~Preview deployments write to the production database~~ | Was real and confirmed by timestamp correlation: two production papers (`0906ebe0`, `f8676a50`) were written by preview deployments. | **CLOSED 2026-09-21.** Both halves fixed: extraction is blocked on preview in code (`BUG_HISTORY.md` #30), and `SUPABASE_SERVICE_ROLE_KEY` / `GEMINI_API_KEY` now target `production` only — verified against the Vercel API. |
| N | `not_research` path never sets `failure_code` | `app/api/extract/route.js` sets `extraction_status='failed'` and `document_type='not_research'` but leaves `failure_code` null, contradicting `CLAUDE_CODE_HANDOVER.md` §4, which lists `not_research` as a valid value. Live evidence: the CV submitted 2026-09-19 has `failure_code: null`. | **Open, cosmetic.** No user-facing impact — the 422 message is still correct and specific. Diagnostic/contract inconsistency only. |

## Items closed

**Closed 2026-09-18**

- **D** — GitHub MCP connectivity. Worked across every session since 2026-09-15.
- **E** — Vercel project ambiguity. Fully closed: the two stray projects were deleted, and `research-platform-5zpu`'s Production Branch setting was confirmed correct by observing a `production`-target deploy fire from a `research-platform` push.
- **A** — typed `failure_code`, closed by real production evidence (above).
- **`BUG_HISTORY.md` #17** — Arabic/non-ASCII filenames failed to upload silently. Fixed in `components/SubmissionForm.jsx`.

**Closed 2026-09-20**

- **#36** — a Gemini 503 outage was reported to submitters as "we couldn't read this document", after a retry ladder too short to clear a demand spike, with no way to retry afterwards. 503 now gets two escalating retries; transient failures get their own honest screen and a working Try again; a transiently-failed paper is re-claimable after a 30s cooldown.

- **M** — the 429 retry ignored the server-stated delay. Split from 503, honours `Retry-After` → `RetryInfo` → message text, caps at 30s, never retries a 429 on pass 2, never retries blind. `BUG_HISTORY.md` #29. *Proven against the recorded production error body; not reproducible live without deliberately exhausting quota.*
- **#31** — a run that extracted nothing was stored identically to one that found everything (`bdc6d112`: 2 passes, 0/10 fields, `completed`). Field yield is now recorded and zero-yield runs are logged.
- **#32** — a stuck paper had no automatic recovery, only a button. The confirmation page now re-triggers periodically and the server decides staleness. Also fixed a latent flaw in the reclaim's own compare-and-swap.

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

## Known upstream condition

**Free-tier Gemini quota is the platform's one hard external dependency.** On 2026-09-20 `gemini-3.6-flash` returned HTTP 503 "experiencing high demand"; on 2026-09-21 the same model exhausted its free quota outright (5/5 RPM, 35/35 RPD) and failed six consecutive submissions. Production now runs **`gemini-3.5-flash-lite`** (15 RPM / 500 RPD free), which closed the outage immediately — five for five afterwards. This is capacity and quota on Google's side, not a defect here or in the documents. The system's *response* to it is now correct (`BUG_HISTORY.md` #29, #36, #37): 503 gets an escalating retry ladder, a 429 honours the server-stated delay, and a transient failure gets an honest screen with a working Try again. The condition itself will recur and cannot be fixed from here. If 500/day stops being enough, the options are a fallback model or a paid tier — both cost money and are the owner's call.

## Recommendations needing an owner decision

1. ~~**Remove `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` from the `preview` target in Vercel.**~~ **Done by the owner, 2026-09-21**, and verified against the Vercel API. Both now target `production` only. Note the side effect: the `development` target lost them too, so local `npm run dev` needs a git-ignored `.env.local`.
2. **Create a second Supabase project for preview.** The free tier allows two. This is the real fix, and it also removes the "test submissions land in the real papers table" problem. Costs setup time, not money.
3. **A distinct `extraction_status` for a zero-yield run.** More honest than `completed`, but touches the status CHECK constraint, both RPCs, and the confirmation UI's branching — medium risk, deferred deliberately (`BUG_HISTORY.md` #31).
4. ~~**Bug O**~~ **Closed 2026-09-21** by migration `0010`. No decision left to make.
5. ~~**Repair the three detached papers.**~~ **Audited 2026-09-21 — no repair needed, and the earlier description of this item was wrong.** See `BUG_HISTORY.md` #40.

## Technical debt

- ~~No CI wired to the test scripts.~~ **Done 2026-09-21**: `.github/workflows/checks.yml` runs `npm ci`, lint, build and all seven runnable suites on every push and pull request, each suite as its own named step. `npm test` runs the same set locally. `test-docx-extraction.js` is deliberately excluded — it requires a real `.docx` path as an argument and there is no fixture in the repo, so it cannot run unattended.
- `lib/extraction/keywordScan.js` has no markers for `year`, so a DOCX missing only its year falls through to the 12,000-character fallback slice rather than a targeted excerpt. Harmless (the fallback works) but wasteful.
- **No DOM/component test harness exists.** Pure logic is well covered, but nothing exercises a rendered component, so `CountrySelect`'s keyboard and pointer behaviour is reasoned from the ARIA pattern rather than verified. Exercise it by hand on the preview.
- **No DOM/component test harness** still means `CountrySelect`'s keyboard and pointer behaviour is reasoned from the ARIA pattern, not verified by a test. (The old note here about the confirmation poll being unable to rescue a stuck paper is obsolete: bug J is closed, and the screen now re-triggers extraction server-side.)
- ~~`README.md` describes the project as "Step 2" and points to a nonexistent `DEPLOYMENT_GUIDE.md`~~ **Fixed 2026-09-26** (Phase 3 M0): `README.md` rewritten as a short pointer to the current docs.
- *(Corrected 2026-09-26: `.env.local.example` does not exist in the repository; only the code default below is real.)* `.env.local.example`'s `GEMINI_MODEL` comment and the code default in `lib/ai/providers/gemini.js` both still say `gemini-3.6-flash`, while production now runs `gemini-3.5-flash-lite` via the env var. The env var wins, so behaviour is correct, but the two defaults should be updated to stop them misleading the next reader.
- `methodology`/`keywords`/`themes` columns remain in `papers`, unused since extraction scope was simplified — intentionally dead, documented, leave alone.
- `supabase/functions/*.sql` mirrors `schema.sql` with nothing enforcing they stay in sync.
- Preview deployments write into the **same** database as production (only one Supabase project exists). An accepted near-zero-budget tradeoff; be aware test submissions from preview branches land in the real `papers` table.

## Next recommended priorities (historical, 2026-09-21)

> Superseded. Phase 2 was delivered as the design-system and UX milestones in the "Phase 2 closure" table above. Items 1 and 2 below are still open and are carried in `PHASE_3_PLAN.md` §4. The next work is `PHASE_3_PLAN.md` M1.

1. **Bug N** — set `failure_code` on the `not_research` path. Cosmetic; do it whenever that file is next open.
2. **Update the two stale `gemini-3.6-flash` defaults** in `lib/ai/providers/gemini.js` and `.env.local.example` to match what production actually runs.
3. **Watch `/api/timing` output on the next few real submissions.** Still new and lightly exercised; the upload stage in particular has little data.
4. Only after the above: resume roadmap work. Per `PHASE_2_PLAN.md` the recommended first feature is the landing page / design system, the phone input redesign having been completed early.
