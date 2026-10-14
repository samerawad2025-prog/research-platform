# CURRENT_STATUS.md

> **Release order and steps live in [`docs/release-runbook.md`](docs/release-runbook.md)** (authoritative since 2026-09-30). This file explains the reasoning; where the two differ, the runbook wins.

**Last updated:** 2026-10-15 (Khartoum). Phases 1 and 2 are closed. Phase 3 submission code is live; the founder administrator has been bootstrapped and the private admin area enabled. The public catalogue is still off. The dated entries below are historical evidence, not pending release instructions.

## Current administrator rollout

- Founder approved the first administrator and private admin activation. The confirmed Auth account was bootstrapped through the owner-only function; exactly one active administrator exists.
- Production `ADMIN_REVIEW=enabled`; deployment `dpl_CgnfFgZNZ2hd7nzBuZHionJizAep` is READY on application commit `15f94476`, Frankfurt. The live `/admin` page displays the staff login. Founder sign-in verification is pending.
- The founder reported creating the password privately and disabling public Auth sign-ups. The connector independently verified the confirmed account, password presence and staff role; it cannot read Auth dashboard configuration.
- Four synthetic release records are withdrawn using the audited review function. Research data, acceptance evidence and AI history are retained.
- Version 4 EN/AR and automatic free-tier Gemini remain in force. Manual entry remains available. Stage E (0014) is complete. Public publication and volunteer access remain disabled.
- Work is cloud-only through GitHub, Supabase, Vercel and hosted browser checks. The isolated test project is inactive; do not run test submissions against a Preview that points to production.
- Next: verify the founder can open the queue; decide on a private request log, volunteer onboarding only if needed, and the public launch separately.

---

## Update 2026-10-05 — released (the runbook has the detail)

- **Production release, 2026-10-05 05:44 UTC:** `15f94476` (the reviewed stack #16–#23, one production deploy, `dpl_HLAiNGzahHCpqG11DmhQN2LSYmP6`, `fra1`). Version 4 (EN + AR) is active; Gemini reads the document by default under the free tier (`gemini-3.5-flash-lite`), with "Enter details manually" as the alternative. Verified in production with three clearly marked synthetic submissions (text PDF, manual, scanned PDF): correct acceptance records, no provider call for manual entry, thank-you only after Confirm. Admin review and the public site stay off.
- **Stage E done 2026-10-07:** 0014 applied by the founder; anonymous upload and `submit_paper` refused from outside; a signed submission still completes.
- **Next:** administrator setup (stage F) and the public site (stage G).

### Earlier on 2026-10-05

- **Stage A2 applied to production** (0018, 0019, 0020) by the founder on 2026-10-04, 23:50–23:51 UTC; all 13 checks passed and were re-verified independently (read-only): existing papers, researchers, AI history, agreements and acceptances unchanged; every agreement version (1–4) **inactive**; `extraction_policy` manual; production code still `f45dc690` and serving.
- The real Gemini test (R1) passed on the Preview on 2026-10-04 (3 requests, Production model).
- **Next:** founder approval of agreement version 4 (D2), then the release session (`docs/release-runbook.md` §4, stages B + D). Preview key cleanup is with the founder (runbook §8, item 2a).

## Update 2026-10-04 (release preparation; the runbook has the detail)

- **Stage A applied to production** (0011–0013, 0015–0017), verified, data unchanged (`docs/release-runbook.md` §7). Production code is still `f45dc690`.
- **Founder decisions of 2026-10-04:** Gemini reading is the default with "Enter details manually" as the alternative; acceptance of the applicable agreement version and the researcher's choice are enforced on the server before any Gemini call; the premature thank-you screen is fixed.
- **The Gemini API project is confirmed free tier.** Gemini reads the document itself (first pages or Word text, scans included; authors and supervisor extracted; working Production model `gemini-3.5-flash-lite`). Agreement **version 4** (EN/AR) says what is sent and that Google may use it to improve its products, with human review; manual entry sends nothing. An excerpt-only design (version 3) was withdrawn the same day. Built on the release-prep branch with migrations **0018 + 0019 + 0020** (applied to production on 2026-10-04 as Stage A2; every version inactive).
- **Until the release, production (`f45dc690`) sends every new paper's front pages to Gemini under the free tier without an agreement that says so**; the release session puts version 4 in front of every automatic reading (`docs/release-runbook.md` §4, §8).

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

**Phase 3 M6 (2026-09-30):** citation export (text, RIS, BibTeX) and aggregate activity counts on public pages (`docs/public-research.md` §7a, migration `0017`). It is on branch `claude/phase3-m6-citations-metrics`, in a PR stacked on M5 (#21). **Not merged, not deployed, off** (same `PUBLIC_RESEARCH` flag); 0017 **not applied**. Verified with mocked checks (CI), independent RIS/BibTeX parsers (local), real local Postgres (concurrency, dedup, eligibility, retention) and the local Supabase stack with Chromium, including the expiry of a real signed Storage link.

**Phase 3 M5 (2026-09-30):** public research pages, browse/search and approved file access (`docs/public-research.md`, migration `0016`). It is on branch `claude/phase3-m5-public-pages`, in a PR stacked on M4 (#20).
- It is **not merged, not deployed and off**: `PUBLIC_RESEARCH` unset 404s every public route; migration 0016 is **not applied**; no real record is approved; the full-text legal restriction stays active.
- Verified with mocked checks (CI), real local Postgres 16 in every review state, and the local Supabase stack with real Storage and Chromium (EN/AR, 320–1440 px). Not verified: hosted Storage signed-link behaviour and any CDN in front of the site.

**Phase 3 M4 (2026-09-29):** the protected admin review workflow (`docs/admin-review.md`, migration `0015`, `/admin`, `/api/admin/*`). It is on branch `claude/phase3-m4-admin-review`, in a PR stacked on M2B/M3 (#19).
- It is **not merged, not deployed and inactive**: `ADMIN_REVIEW` unset 404s every route; migration 0015 is **not applied**; no account exists; the volunteer confidentiality version is seeded inactive.
- Administrators review, decide (needs changes, reviewed, approve, decline, withdraw, reopen) and manage staff, institutions and documents. Volunteers see only assigned submissions, after acknowledging the confidentiality text, and prepare recommendations only. **Nothing is published; there are no public pages (M5/M6).**
- UofK's 21 faculties and schools are seeded from the official directory as retrieved in the founder's review on 2026-09-30 (English names only). A blocking issue suspends an approval at once, and a fresh approval is needed after it is resolved.
- Not done: no submitter notification; the full-text legal condition stays an active release restriction that Approve cannot lift.
- Verified with mocked checks (CI), real local Postgres 16, and the local Supabase stack with real GoTrue tokens plus Chromium in EN/AR at 360–1440 px. Not verified: hosted Auth settings, hosted Storage signed-URL behaviour and CORS.

**Phase 3 M2B + M3 (2026-09-27):** the submission form on the acceptance flow, depositor-declared authors, Facebook removal and the LinkedIn display choice (migration `0013`), plus the prepared cutover migration `0014`. It is on branch `claude/phase3-m2b-m3-submission`, in a PR stacked on M2A (#18).
- It is **not merged, not deployed and inactive**: `SUBMISSION_ACCEPTANCE_FLOW` unset serves the legacy form.
- **Acceptance is not enforced in production** until 0014 is applied at cutover (`docs/submission-flow.md`, "Cutover").
- Verified with mocked checks (CI), real local Postgres, the local Supabase stack (PostgREST + Storage API, before and after 0014), and Chromium browser-to-database runs in EN/AR at 360–1440 px with the mock AI provider.
- Not verified: hosted Storage link lifetime, the hosted gateway/CORS, and the S3 backend.

**Phase 3 M2A:** the server-controlled acceptance and upload foundation (`docs/submission-flow.md`, migration `0012`). It is on branch `claude/phase3-m2a-acceptance-upload`, in a PR stacked on M1.
- It is **not merged, not deployed and inactive**: the endpoints need `SUBMISSION_ACCEPTANCE_FLOW=enabled`, and every agreement row is seeded inactive.
- The old anonymous upload and `submit_paper` path is unchanged and still open, so **M2A does not secure production**.
- Corrected on 2026-09-27 after review: cleanup now waits for the upload authorization's own expiry plus a margin (intent expiry does not revoke it); an authorized depositor is no longer made an author; acceptance is bound to a server-signed processing offer, so processing broader than what was shown is never recorded.
- Verified at three tiers: mocked checks in CI; a real local Postgres with a storage substitute (`run-0012.sh`); and a real **local** Supabase stack (PostgREST + Storage API, `supabase/tests/local-stack/`). Not verified on a hosted project: the authorization lifetime there (documented as 2 hours; the Storage default is 60 s), Kong and the S3 backend. See `docs/submission-flow.md`.


**Phase 3 M1:** configurable extraction (`EXTRACTION_MODE=automatic|manual`) and a complete manual metadata path. It is on branch `claude/phase3-m1-extraction-mode`, in a PR stacked on the M0 documentation PR. It is **not merged and not in production**, and migration `0011` is **not applied**.

After the correction passes:
- the manual decision (by server mode or by the researcher) is stored durably in `papers.manual_entry_at` / `manual_entry_source`;
- every provider request is preceded by a re-check that stops it once manual entry or a confirmation is recorded (already-dispatched requests cannot be recalled);