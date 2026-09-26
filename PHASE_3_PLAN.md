# PHASE_3_PLAN.md

**Prepared:** 2026-09-26, Phase 3 Milestone 0 (documentation only). Supersedes the forward-looking parts of `PHASE_2_PLAN.md` and the roadmap in `CLAUDE_CODE_HANDOVER.md` §13; both remain as history.

**How to read this file.** Product intent comes from the founder's latest decisions (below). Implementation status comes only from code, migrations and deployment evidence. Every item carries one of four labels:

- **Implemented and verified**: in the code on `research-platform`, deployed, and checked.
- **Approved, not built**: decided by the founder; no code yet.
- **Proposed for later**: a direction, not scheduled work.
- **Unverified**: a fact this plan depends on that nobody has confirmed.

A planning document is never evidence that something is built.

---

## 1. Confirmed product decisions (founder, 2026-09-26) — all *approved, not built* unless noted

1. **Who can submit.** Any institution, and independent researchers.
2. **Who is published first.** The submission experience is optimized for the University of Khartoum across all its faculties. Initially only approved UofK records are eligible for public publication. Institution eligibility is a property of the institution, kept separate from each record's own approval. Making an institution eligible never publishes its records automatically.
3. **Publication settings: exactly two.**
   - **Record and abstract only**: the default.
   - **Record, abstract and full text**: includes online reading and downloads of the approved document.
   - No Creative Commons licence is applied automatically. Public availability is never presented as an open licence.
4. **Legal acceptance.** One required acceptance checkbox, initially unchecked, using the exact sentence from the agreement in the active language. The publication setting is a separate ordinary choice, not an extra legal checkbox. The agreement text lives in `docs/legal/` (see `docs/legal/README.md` for its activation conditions; it is **not yet active**).
5. **Existing submissions stay private** until their permissions, metadata and publication eligibility are reviewed. Existing consent evidence is preserved. A migration never expands a permission.
6. **Social links.** Facebook collection is removed from the user flow. LinkedIn stays optional, with an explicit choice about public display.
7. **No charges.** Researchers and universities are not charged for repository participation.
8. **Review capacity.** Administrative review is done by the founder and volunteers. Review workload is tracked as capacity (time, backlog), not as a payroll cost.
9. **After submission.** A private receipt and status experience. The public research link exists only after publication approval, and is a different identifier from the private confirmation link.
10. **Activity counts.** Page views, document opens, downloads and citation exports are counted and labelled separately. None of them is presented as a citation.
11. **Domain.** A stable public domain is needed before permanent citation links are promoted. Until then, use stable record identifiers and a configurable site origin. The domain choice does not block early milestones.
12. **Review is not peer review.** Administrative review covers permissions, missing data, duplicates and publication quality. It is not academic peer review or an originality certificate.

## 2. Standing rules for all Phase 3 work

- **Private confirmation links stay private.** The `/confirm/[token]` link is a private editing credential. It must never become a public sharing link, appear in analytics or enter a search index. Public records get a separate public identifier and URL. This extends the existing CLAUDE.md rule that the confirmation credential is never the paper's UUID.
- **Publication restrictions apply on every path.** They cover pages, files, API responses, search results, sitemaps, citation exports and aggregate counts. Hidden links and `noindex` are not access control; the files stay in private storage behind server authorization.
- **Upload URLs are described exactly as built.** A signed upload URL is time-limited and bound to a path. It must not be called "single-use" unless the implementation demonstrably rejects a second use, and that must be verified, not assumed from provider documentation.
- **No backdated acceptance.** Acceptance records carry the server timestamp at the moment of acceptance. Legacy rows never receive a synthetic acceptance.
- **Evidence is preserved.** `ai_generations` stays append-only (CLAUDE.md). The legacy `permission_to_process` and `publication_scope` columns are retained as evidence, not rewritten.
- **Migrations follow the existing workflow** (`.claude/skills/supabase-migration-safety`).
  - Each live change is its own numbered file in `supabase/migrations/`. The next number is `0011`. Never re-run `schema.sql`.
  - Update `schema.sql` and `supabase/functions/*.sql` to match the final state.
  - Prefer additive, backward-compatible steps: add the new path, deploy code that uses it, then remove the old path.
  - Include a rollback script or a written rollback procedure.
  - Test with synthetic fixtures. No real private research goes to a new or unverified provider during testing.
  - Writing a migration file is not permission to apply it to production. Live application is a separate, explicitly approved step, followed by verifying the live definition.
  - Security-sensitive changes re-test that:
    - anonymous direct table access stays blocked;
    - a wrong token fails;
    - a bare paper UUID cannot stand in for the token.
- **Delivery process unchanged.** Each milestone is delivered on its own branch with CI, a preview on the exact SHA, localhost browser verification (EN/AR, narrow and wide), founder review, then PR and merge. After merge, production is verified by exact SHA.

---

## 3. Milestone sequence

| # | Letter | Milestone | Depends on | Blocks |
|---|---|---|---|---|
| M0 | — | Documentation reconciliation and this plan | — | — (this milestone) |
| M1 | A | Processing configuration and manual metadata path — **built, in review** (PR stacked on M0) | — | Provides the fallback for §6. It does not settle provider suitability. |
| M2 | B | Server-enforced acceptance, controlled uploads, two publication settings, legacy permissions | M1 recommended first | Supports §3/§4; M4 |
| M3 | C | Facebook removal and independent LinkedIn visibility | Must land **no later than** M2 (see M3) | Agreement activation |
| M4 | D | Administrative review, checks, institution eligibility, publication permissions | M2, M3 | M5 |
| M5 | E | Public research pages, approved downloads, withdrawal, browse/search | M4 | M6 |
| M6 | F | Citation export and truthful aggregate activity metrics | M5 | — |

**Activation is not a milestone count.** The agreement may be activated only when every commitment it makes is actually supported by the running system, verified in production. The conditions are listed in `docs/legal/README.md`. M1, M2 and M3 are expected to provide the technical support for the conditions that apply before publication exists. Marking those milestones complete does not by itself satisfy the conditions. In particular, §6 also needs a verified provider arrangement, or production running in manual mode for every new submission. Public full-text release has further conditions of its own.

---

### M1 (A): Processing configuration and manual metadata path

**Why.** Section 6 of the agreement promises that submitted content is not used for general-purpose AI model training. The Gemini API project's billing/data-use arrangement is **unverified**. Google's unpaid API terms permit product improvement and human review, so the promise must not be activated while possibly incompatible processing runs. The project also must not depend on buying an AI plan. So external extraction needs an off switch, and the confirmation flow needs to work without it.

**What the switch does not do.** It provides a fallback. It does not make the provider arrangement suitable, and it does not establish that it is. While production runs automatic extraction under an unverified arrangement, the §6 commitment is not supported, whatever the state of this milestone.

**Status (2026-09-26): implemented and verified on branch `claude/phase3-m1-extraction-mode`, not merged, not deployed.** What was built, where it differs from the plan below:
- **Setting.** `EXTRACTION_MODE=automatic|manual` (not `external|disabled`). A missing or unrecognised value means `manual`. It is read in `lib/env.js` (`resolveExtractionMode`). Production must set `automatic` **before** the merge, or the live workflow changes on deploy; see `docs/deployment.md` "Rollout".
- **Server enforcement.** The route's logic moved, otherwise unchanged, into `lib/extraction/extractHandler.js`, which `app/api/extract/route.js` wraps. The mode is checked first, before the preview guard, the database, the storage download or the provider. In manual mode no request of any kind leaves the server: not from the form's trigger, the page's safety net, the stuck nudge or "Try again", and not from a direct API call. The only write moves a still-`pending` paper to `manual`.
- **State.** Migration `0011` adds `extraction_status = 'manual'`. It is authored and tested locally (`supabase/tests/run-0011.sh`, Postgres 16), and **not applied to production**. The code works without it: the paper stays `pending`, the refusal is logged as `manual_status_not_recorded`, and the screen still shows hand entry. A `manual` paper is never claimed for extraction, even after a switch back to automatic. A confirmed paper never starts a provider call.
- **Human edits win.** Applying a result, and moving the applied-result pointer on any outcome, now happens in the same statement as the "not yet confirmed" condition. A result that arrives after the researcher confirmed is appended to `ai_generations`, and the confirmed values stay untouched.
- **Screen.** In manual mode the confirmation page opens straight into an editable form: no polling beyond the first read, no shimmer, no "needs attention" flags, and wording that never mentions configuration. In automatic mode every place automatic reading did not produce a result now also offers "Enter the details yourself": the transient-failure, encrypted and generic-failure screens, the two-minute timeout, and "unavailable here" (a preview, or a server configuration fault). Choosing it stops the poll at once. The not-research notice is unchanged. It uses the same fields, validation and confirm RPC in EN and AR.
- **Not done here (by design):** no provider call can be recalled once sent; typed-but-unconfirmed entries are not saved as drafts across a reload; a document the model classified as not research gets no manual path (the notice and contact route remain).

**Scope.**
- A server-side processing mode, for example `EXTRACTION_MODE=external|disabled`, read in `lib/env.js` next to the existing preview guard. When `disabled`, `/api/extract` performs no external provider call and sends no document content anywhere.
- A manual metadata path. A paper submitted while extraction is disabled moves directly to a state the confirmation screen renders as an editable, empty form. It is not left in `pending` forever, which is what happens today if extraction never runs. The screen explains in EN/AR that the details are entered by hand. The existing confirm RPC validation (title required in either language, year normalization, researcher rules) applies unchanged.
- The confirmation screen's safety-net trigger and stuck-processing nudge stay in place and must no-op cleanly in disabled mode. Timing constants are unchanged.
- The mode must be visible to the administrator (a logged notice), so "extraction didn't run" is never mistaken for a failure.

**Migration.** Likely one: add a status value (for example `manual`) to the `papers.extraction_status` CHECK constraint, or an equivalent flag. Reversible: drop the value once no rows use it. `ai_generations` untouched (append-only). If a record of "extraction skipped by configuration" is wanted, it is appended, never overwritten.

**Acceptance criteria.**
- With `disabled`: zero requests to `generativelanguage.googleapis.com`, verified by request interception in tests. The paper reaches the manual state. The confirmation page shows the editable form immediately in EN and AR. Confirm succeeds with hand-entered data.
- With `external`: behaviour identical to today, including retry and nudge.
- Switching the mode requires no code change.

**Verification.** Unit tests for the mode gate; localhost browser flow in both modes with mocked Supabase; confirm no provider call in disabled mode; existing test suite green.

**Rollback.** Set the mode back to `external`. Revert the migration only if no `manual` rows exist.

**Not in scope.** Choosing, paying for or replacing a provider. The billing check is the founder's, in the provider console; M1 does not depend on its outcome.

---

### M2 (B): Server-enforced acceptance, controlled uploads, two publication settings, legacy permissions

**Why.** Today the acceptance and scope checks run only in the page. Storage has an anonymous INSERT policy on the `papers` bucket whose only condition is the bucket name (`supabase/schema.sql`), and `submit_paper` is granted to `anon`. A direct request can upload a file or create a submission without accepting anything.

**Scope.**
- **Agreement registry.** A table of agreement versions: identifier, version label, language, content hash of the exact file in `docs/legal/`, version date, active flag. The server decides which agreement is active. A client never supplies legal text, only the identifier the server gave it.
- **Acceptance, upload and submission binding.** The required flow:
  1. The server validates the form and the acceptance (checkbox true, agreement identifier active and matching its stored hash, language, publication setting in the allowed pair). It records an **acceptance event** with the server timestamp, the claimed role (author, coauthor or authorized depositor), and `identity_verified = false`. Then it issues a time-limited signed upload URL for a **server-chosen path**, tied to an upload intent.
  2. The client uploads to that URL.
  3. The client calls a completion endpoint with the intent identifier. The server confirms the object exists at the bound path, records the file size (and a content hash where feasible), and only then creates the paper. The paper is bound to that acceptance event, agreement version, language, setting and file.
  4. External processing (per M1's mode) starts only after step 3.
- **Close the bypass.** Remove the anonymous storage INSERT policy. Revoke direct `anon` execution of the submission RPC; the server calls it. Rejected cases: no acceptance, forged or inactive agreement identifier, unknown setting, completion without an upload, upload to a path not issued by the server.
- **Publication setting.** A new column with exactly two values, `record_abstract` and `record_abstract_fulltext`. New submissions default to `record_abstract` in the form. A later change of setting is a **new** acceptance/grant event; the original is never rewritten.
- **Form.** One acceptance checkbox, initially unchecked, using the agreement's exact acceptance sentence. The short summary sits above it:
  - "Your submission remains private until reviewed. Publication follows your selected setting. Approved public full text can be read and downloaded."
  - It gets an Arabic equivalent.

  Terms open without losing entered data or the selected file, whether through an in-page disclosure or a new tab. There is no forced-scroll timer. Submit stays disabled until the checkbox and required fields are valid, keyboard submission works, and Arabic RTL works. The old processing-consent checkbox is removed from the form; its historical evidence stays in the database.
- **Rendering the agreement.** Rendered from `docs/legal/*.md` as the single source. The files use a small Markdown subset (headings, paragraphs, bold, bullets). Prefer a minimal in-repo renderer over a new dependency; flag the choice if a dependency turns out to be necessary.
- **Legacy permissions.** Existing rows keep `permission_to_process` and `publication_scope` untouched, get **no** acceptance record, and get **no** new publication setting (null means private, needs review). The migration defines only which legacy grants are *candidates* for which setting at review time. It never expands a grant:

  | Legacy `publication_scope` contains | Candidate after review (M4) |
  |---|---|
  | `full_paper` | May be considered for either setting. Full text only if the reviewer is satisfied the legacy consent covers public online reading **and download**; otherwise re-authorization under the current agreement is required. |
  | `abstract_and_citation` (without `full_paper`) | At most `record_abstract`. |
  | `metadata_and_article` only | At most `record_abstract`. It **never** implies full text, and permission for an AI-written article is not permission to publish the original. |

  Before writing this migration, count the actual combinations present (read-only query). The mapping above covers every value; the counts decide how much review work M4 inherits.

**Deployment order.** The live form uploads directly with the anonymous role and calls `submit_paper` from the browser. So the new server path must be deployed and verified before the anonymous storage policy and the `anon` grant are removed. If they were removed first, every live submission would fail. Use two steps:
1. An additive migration and the new code, which uses only the server path.
2. A second migration that revokes the old access. It is applied only after production is verified on the new path.

The bypass stays open between the two steps; keep that window short.

**Coupling with M3.** `confirm_researcher_metadata` currently stores LinkedIn/Facebook only when `publication_scope` contains `metadata_and_article`. New submissions under M2 will not carry that value, so if M2 ships without M3, LinkedIn links on new papers would silently stop saving. M3 must land before or together with M2.

**Acceptance criteria.**
- Unchecked and forged acceptance rejected at the server, not only in the UI.
- An anonymous direct storage upload is rejected.
- A direct submission-RPC call from the browser role is rejected.
- Every new paper has exactly one bound acceptance event with a server timestamp, agreement version and language, setting and file reference.
- A setting change creates a new event.
- Legacy rows are byte-identical in their legacy columns before and after the migration.
- The selected file survives opening the terms.
- The form works in EN/AR at 320–1280px.

**Verification.** Migration tested against a local/synthetic schema; negative tests for each rejection path; browser flow with mocked storage; a read-only production query confirms that legacy columns are unchanged after release.

**Rollback.** Keep a written rollback script. Note that restoring the anonymous INSERT policy also restores the bypass, so rollback is an emergency measure, not a resting state.

**Unverified.** Whether Supabase signed upload URLs reject a second upload to the same path in this project's configuration. Test it before describing the behaviour.

---

### M3 (C): Facebook removal and independent LinkedIn visibility

**Scope.**
- Stop collecting Facebook links in the confirmation UI, and have the confirm RPC ignore any `facebook_url` it receives. Existing Facebook values are retained, not displayed, and handled later under the agreement's retention review; the column is not dropped in this milestone.
- LinkedIn stays optional. Add an explicit "show on my public record" choice (for example a per-person display flag), default **off**. Storing a LinkedIn URL is no longer conditional on `publication_scope` containing `metadata_and_article`. Display is controlled only by the explicit choice, and only matters once public pages exist (M5).
- Legacy LinkedIn values are kept with display **off** until the person opts in.

**Migration.** Add the display flag (default false) and replace the scope condition in `confirm_researcher_metadata`. Reversible.

**Acceptance criteria.**
- No Facebook field in EN or AR.
- A crafted request with `facebook_url` does not change stored data.
- LinkedIn saves regardless of publication setting.
- The display flag defaults to false and is independent of the setting.
- Existing values are unchanged.

**Verification.** RPC tests with synthetic rows; browser flow; read-only check that legacy values are untouched.

---

### M4 (D): Administrative review, checks, institution eligibility, publication permissions

**Scope.**
- **Admin access.** Authenticated administrator and volunteer accounts (Supabase Auth; no new paid service) with roles. All admin reads and writes go through server authorization. Volunteers see only what their duties require. A confidentiality commitment is recorded per volunteer, with its date.
- **Institutions and academic units.** Extensible tables with aliases and provenance (source and retrieval date). UofK faculties are entered from the official faculty directory, not inferred from a headline count. Institution-level `public_collection_eligible`: UofK only, initially.
- **Record review.** Review status (for example pending, needs changes, approved, declined, withdrawn), separate from the institution's eligibility. Private reviewer notes. Review events are append-only (who, what, when), which also provides the capacity measure: time and backlog.
- **Checks.**
  - A missing-data checklist.
  - Duplicate candidates: same file hash from M2, plus normalized title and year similarity.
  - Rights: the setting and its evidence support the proposed publication.
  - Legacy rows go through the same queue using the M2 candidate mapping.
- **Dissemination copy.** For full text, the reviewer approves a specific document version, which may be a redacted copy. The original upload is never exposed if it contains signatures or unnecessary personal details.
- **Approval precondition.** Approval requires all of: an eligible institution, a permitted setting, complete metadata and, for full text, an approved dissemination copy.

**Migrations.** New tables for roles, institutions, units, review events and document versions; new columns on `papers`. Additive and reversible.

**Acceptance criteria.**
- A non-admin cannot read review data or reviewer notes through any API.
- Volunteer permissions are enforced server-side.
- Approval is refused when any precondition is missing.
- Every decision is logged.
- A non-UofK record cannot become public even if approved.

**Verification.** Role-based negative tests; synthetic fixtures only.

---

### M5 (E): Public research pages, approved downloads, withdrawal, browse/search

**Scope.**
- **Public identifiers.** A separate public identifier per published record: random, stable, never the UUID or the confirmation token. The route is something like `/research/[publicId]`, with the site origin configurable so a later domain choice does not break links.
- **One publication rule for every public path.** A record is public only when all of the following hold: publication approved, institution eligible, not withdrawn, embargo passed, and the accepted setting permits the content. The rule is enforced in the database or server layer and applies to:
  - page rendering;
  - the file route;
  - search results;
  - sitemap and robots;
  - citation export;
  - activity counts.
- **Files.** The approved dissemination copy stays in private storage. A server route checks the publication rule, then issues a short-lived signed URL or streams the file. Ordinary reading and offline download stay easy. Proportionate rate limiting is applied, with no copy-prevention or print-blocking claims.
- **Rights statement.** Shown per work, and never implies an open licence.
- **Withdrawal.** Withdrawal stops page and file delivery and removes the record from search and the sitemap. The effective delay (for example signed-URL lifetime or cache revalidation) is documented honestly. A minimal withdrawal notice may remain. Restrictions must be reapplied after any backup restore.
- **Browse and search.** Filters only where the data supports them (for example institution, faculty or unit, year, degree type, language). Search covers title and abstract.
- **Private links stay private.** `/confirm/*` is excluded from indexing and analytics.

**Acceptance criteria.** Each of the following returns not-found or is excluded on every public path — page, file, search, sitemap, export:
- a private record;
- a pending record;
- a record from another (ineligible) institution;
- a withdrawn record;
- a record under embargo;
- the full text of a `record_abstract` record.

In addition, a withdrawn record stops being served within the documented window, and no confirmation token appears in any public page, link or log the platform controls.

**Verification.** Path-by-path negative tests with synthetic records in each state; EN/AR pages at 320–1280px.

---

### M6 (F): Citation export and truthful aggregate activity metrics

**Scope.**
- **Citation export.** Citation text plus RIS and BibTeX, generated from **confirmed local metadata only**, with the stable record URL. Missing authors or years are omitted or marked, never invented. An existing valid DOI is included if one is recorded; no DOIs are invented, and DOI registration is not part of Phase 3. External lookups (Crossref) are not required.
- **Activity counts.** Aggregate counts per record for page views, document opens, downloads and citation exports, each labelled separately as service activity. Known bots, previews, test and admin actions, and obvious repeats are filtered where feasible. There is no invasive fingerprinting and no public individual reading history. The UI states that none of these counts is a citation.

**Acceptance criteria.**
- Exports parse in common reference managers.
- A record with missing fields exports without invented values.
- Counts for unpublished or withdrawn records are never exposed.
- The labels in EN/AR match the event actually counted.

---

## 4. Proposed for later (not scheduled)

- **Explore research directions.** Source-grounded suggestions from a small set of lawfully usable sources. Every suggestion carries the qualification **"A possible research direction based on the sources reviewed."** It cites evidence, distinguishes stated limitations from AI inference, preserves supervisor judgment and feasibility review, and makes no claim of exhaustive novelty. Public metadata comes first; private deposits are excluded by the current agreement.
- **Citation alerts** from verified external evidence, with a verified recipient relationship and notification preferences. "No citation found" is never reported as "zero citations".
- **Cross-institution similarity screening.** A separately authorized service with contextual human review. Nobody is labelled a plagiarist from a score alone. It is not authorized by the current agreement.
- **Optional external integrations, only when a milestone needs them.** None is connected today, and their absence blocks nothing:
  - Crossref: DOI validation and metadata;
  - OpenAlex: discovery and later citation enrichment;
  - an optional hosted model for research directions.
- **Deferred from Phase 2.** SARP name clearance and any compact mark; the final domain; the Open Graph image; per-page titles (a clean path exists once the language toggle can update route titles); the missing space in the footer email link's accessible name.
- **Open technical items carried from Phase 1.** Bug N (`not_research` sets no `failure_code`), the stale `gemini-3.6-flash` default in `lib/ai/providers/gemini.js`, and a separate Supabase project for previews.

## 5. Unverified facts and the milestones they affect

| Fact | Why it matters | Affects |
|---|---|---|
| Gemini API project billing and data-use arrangement | Decides whether the §6 no-training promise is compatible with external extraction. Historical free-tier rate-limit behaviour (`CURRENT_STATUS.md`, 2026-09-21) is noted but is **not** accepted as proof either way. | M1, agreement activation |
| Why production was redeployed on 2026-09-25 (same commit `f45dc690`, `source: redeploy`) and whether environment variables changed with it | A redeploy is how environment changes (keys, model, mode) take effect | M1 |
| Supabase plan, backup settings and storage region | Retention and withdrawal statements (backups) | M5, operations |
| Whether signed upload URLs reject reuse in this project | How the upload URL may be described | M2 |
| Actual counts of legacy `publication_scope` combinations | Size of the legacy review queue | M2, M4 |
| UofK official faculty directory (names, aliases) | Institution/unit data | M4 |
| Whether checkbox-only authorization suffices for public full-text release under Sudanese law | Legal condition for full-text publication | M5 (full text only) |
| Stable public domain | Permanent citation URLs | M6 promotion (not the build) |
