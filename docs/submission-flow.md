# Submission flow (Phase 3 M2A + M2B): acceptance, upload, finalization

> **Release order and steps live in [`docs/release-runbook.md`](release-runbook.md)** (authoritative since 2026-09-30). This file explains the reasoning; where the two differ, the runbook wins.

**Status (2026-09-27): built and tested locally; not deployed; inactive by default.**
- **M2A** (PR #18) is the server side: terms, intent, signed upload, finalization.
- **M2B/M3** (the PR stacked on it) adds:
  - the submission form on that flow;
  - depositor-declared authors;
  - Facebook removal and an independent LinkedIn display choice (migration 0013);
  - the prepared cutover migration 0014, which closes the legacy anonymous path.

**Acceptance is not enforced in production until 0014 is applied.** Until then, a direct request can still upload anonymously and call `submit_paper` without accepting anything, whatever the form does. See "Cutover" below.

Code:
- Server: `lib/submission/acceptanceHandlers.js`, `app/api/submissions/*`, `lib/submission/agreementText.js`, and `lib/extraction/extractHandler.js` (the document-hash check).
- Browser: `components/AcceptanceSubmissionForm.jsx`, `lib/submission/clientFlow.js`, `components/AgreementText.jsx` with `lib/submission/agreementMarkdown.js`, and `components/ConfirmationScreen.jsx`.
- Database: `supabase/migrations/0012_submission_acceptance.sql`, `0013_linkedin_visibility_declared_authors.sql` and `0014_close_legacy_submission_path.sql` (the last applied only at cutover).

Tests, by tier:

| Tier | File | What is real |
|---|---|---|
| Mocked (CI) | `scripts/test-submission-acceptance.js`, `scripts/test-submission-client.js`, `scripts/test-researcher-seed.js` | Nothing external: validation, offers, the browser flow's decisions, the agreement parser, LinkedIn rules, migration text |
| Real Postgres | `supabase/tests/run-0012.sh` → `submission-postgres.test.js` | Postgres 16 and every SQL function (0011–0013); supabase-js calls translated to SQL; **a storage substitute** |
| Real local Supabase | `supabase/tests/local-stack/start.sh`, then `supabase-local.test.js` and `supabase-cutover.test.js` | Supabase's Postgres image, **PostgREST, the Storage API** and supabase-js itself, on localhost. Not a hosted project |
| Browser to database | `supabase/tests/run-browser-e2e.sh` → `browser-e2e.test.js` | Chromium driving the built app against the local stack, with the in-repository mock AI provider. Not a hosted project, and no request to Gemini |

The local stack's gateway is a small stand-in for Supabase's hosted gateway (Kong), including its CORS answers to the browser. Hosted gateway and Storage behaviour are release checks (see "Cutover"), not something these tests establish.

## Flow

1. **`GET /api/submissions/terms`.** Returns:
   - the active agreement versions: id, language, version label and date, SHA-256, and the **exact text**. The text is read from `docs/legal/` on the server, and served only if its hash still matches the registry; otherwise that agreement is not offered. The response also includes the acceptance sentence taken from that text;
   - the two publication settings and the default `record_abstract`;
   - the claimed roles;
   - file limits;
   - `processing.decision`: what a new submission would get now;
   - **`offer: { token, decision, expiresAt }`**: a server-signed record of what was shown (see "The processing offer").
2. **`POST /api/submissions/intent`.** Acceptance and choice. The body may contain only these fields:

   `{ offerToken, agreementId, accepted: true, publicationSetting, claimedRole, processingChoice, fullName, email, whatsapp?, whatsappCountry?, authors?, file: { name, size, type } }`

   `processingChoice` (migration 0018) is the researcher's own choice, made before anything is sent anywhere: `automatic` (Gemini reading, the default) or `manual` ("Enter details manually"; the document is never sent to Gemini). It is always explicit: a missing or unknown value is refused (`400 processing_choice_invalid`), never read as consent, and `automatic` against an offer that only allowed manual entry is refused too.

   `authors` (1–50 names, each at most 200 characters) is required for `authorized_depositor` and refused for anyone else.

   Any other field is refused (`400 unexpected_field`). That includes any attempt to name a processing mode, path, hash, legal text or timestamp.

   The server checks:
   - `accepted` is exactly `true`;
   - the offer is genuine, unexpired, and showed this agreement with this hash;
   - processing now is not broader than the offer (else `409 offer_stale`, before anything is recorded);
   - the agreement id is in the application registry (`lib/submission/agreements.js`) **and** is an active row in `agreement_versions` with the same language and hash;
   - the setting, role, contact details, file extension, declared MIME type and size (at most 20 MB).

   It then records a **`submission_acceptances`** row containing the fields below. For a depositor, it then records the declared authors on that row (`record_declared_authors`, once, immutable) **before** any upload link exists; if that fails, no link is issued.
   - the agreement version, language and hash;
   - `accepted_at` in server time;
   - the claimed role, with `identity_verified = false`, because an anonymous declaration is not identity verification;
   - the publication setting;
   - the processing decision, the offered decision and when the offer was issued;
   - contact details;
   - a **server-chosen** object path `intents/<acceptance id>/<random>.<ext>`;
   - the declared size, an intent expiry 30 minutes ahead, and the upload authorization's own expiry (below).

   The response gives the browser:
   - `intentId` and `intentToken`. The token is a secret; only its hash is stored.
   - `processing: { decision, offered, choice, changedFromOffer }`. `decision` is **authoritative**. `changedFromOffer` compares the decision with what the offer and the researcher's choice allowed together, so a researcher's own manual choice is never reported as a change.
   - an upload authorization for that one path: `upload.path`, `upload.token` and `upload.signedUrl`, created with `upsert: false`.
3. **Upload.** The browser uploads the file with that authorization, for example with `supabase.storage.from('papers').uploadToSignedUrl(path, token, file)`. The bucket stays private.
4. **`POST /api/submissions/finalize`** with `{ intentId, intentToken }`. The server:
   - reads the object at the recorded path, never at a path the browser names;
   - checks its size equals the declared size;
   - checks its content is a real PDF (`%PDF-`) or a DOCX (a ZIP containing `word/document.xml`);
   - computes its SHA-256;
   - calls `finalize_submission_intent`.

   That function locks the acceptance row and creates the researcher, the paper and, when authorship was declared, the link **exactly once** (see "Depositor and authorship"). The paper carries:
   - `submission_acceptance_id`;
   - `publication_setting`;
   - `file_sha256` and `file_size`;
   - the processing decision.

   A repeated or concurrent call returns the same paper and the same confirmation token and creates nothing. The response is `{ confirmationToken, alreadyFinalized, processing: { decision, choice }, extraction: { mayStart } }`. When the researcher chose manual entry (and automatic reading had been offered), the paper is created with that decision already recorded (`manual_entry_source = 'researcher'`) in the same transaction, so no request can ever start reading it, and `mayStart` is `false`.
5. **Extraction.** The browser calls `/api/extract` only when `extraction.mayStart` is true. The route enforces the same rule itself.
   - For these papers it also checks that the stored object still has the accepted SHA-256 before anything can be sent. On a mismatch it fails with `document_mismatch`, and nothing is sent.
   - The existing claim compare-and-swap prevents duplicate extraction jobs.

**Transport versus finalization.**
- The upload authorization is **not single-use**. It can be retried until an object exists at the path or the authorization expires.
- What is one-time is **finalization**: one paper per acceptance, bound to one document hash.
- Once an object exists, `upsert: false` prevents replacing it through the authorization, including when the client asks for upsert. Verified against the real Storage API. If the object were replaced by other means, the extraction route's hash check refuses to send it.

**Tokens.**
- Only hashes of the intent token and the confirmation token are stored.
- The confirmation token is derived as `HMAC(SUBMISSION_TOKEN_SECRET, intentToken)`. A retried finalization can therefore return the same token, and a copy of the database alone cannot produce it.
- No token, signed URL, secret or contact detail is written to logs. This is tested.

## Three different expiries

These are separate clocks. Only the third decides when an object may be deleted.

| | Set by | Length | What it stops |
|---|---|---|---|
| **Intent expiry** (`expires_at`) | this application | 30 minutes | **Finalization.** An expired intent can never create a paper. It does **not** revoke the upload authorization. |
| **Upload authorization expiry** (`upload_authorization_expires_at`) | Supabase Storage, inside the token | Storage configuration (`UPLOAD_SIGNED_URL_EXPIRATION_TIME`). Hosted Supabase documents 2 hours; the self-hosted Storage default is 60 seconds | **Uploads** to the path. Read by the server from the token Storage issued and recorded; if it cannot be read, it stays null and counts as a full day. |
| **Cleanup eligibility** | derived | authorization expiry **+ 60 minutes** | Nothing; it is when removal becomes safe: no authorization can start an upload, and one that started just before expiry has had an hour to land. |

So an intent that expires at 30 minutes (or is marked expired during finalization) keeps its object for as long as the authorization plus margin. A still-valid authorization could otherwise recreate the object after cleanup deleted it, leaving an orphan that nothing looks for. This was reproduced against the real Storage API: after the intent expired, the original token still uploaded.

**Cleanup.** Each `/intent` call runs `expire_submission_intents(5, 3600)`:
1. Marks at most 5 open, past-expiry acceptances `expired`. The update itself is bounded (`limit … for update skip locked`), not only the returned list.
2. Returns at most 5 cleanup candidates: never finalized, past cleanup eligibility, and either not yet removed or removed *before* that point (so an object that landed after an early removal is found again).

The server then removes **only** each candidate's own object at `intents/<id>/<24 hex>.<ext>` and records `object_removed_at`. A finalized acceptance, any other path (including every old-path upload) and the acceptance row itself are never touched.

**Not handled:** uploads made through the old anonymous path and never submitted. There is no cleanup for them yet; that closes with the path.

## Depositor and authorship

The person submitting is always recorded: in `papers.submitted_by` and in the acceptance (claimed role, contact details). **Authorship is separate.**

| Claimed role | Linked on the paper at finalization |
|---|---|
| `author` | the submitter, position 1 |
| `coauthor` | the submitter, with no position (the confirmation step places them) |
| `authorized_depositor` (a librarian, a volunteer) | **not the submitter.** The authors they declared are linked in their declared order, as names only, with no contact details. |

All of these are unverified declarations (`identity_verified = false`).

The confirmation step (`confirm_researcher_metadata`) sets the final list and order:
- It adds only the people it is given, so a depositor is never reinserted.
- For a depositor's paper, the confirmation screen starts from the declared authors rather than from what automatic extraction found, because those names were typed by a person. The depositor can still correct them there.

## LinkedIn and Facebook (M3, migration 0013)

- **Facebook is no longer collected.** It is gone from the confirmation screen. `confirm_researcher_metadata` ignores any `facebook_url` it is sent, and `get_paper_for_confirmation` no longer returns it. The column and its historical values are unchanged.
- **LinkedIn is optional, and stored whatever the publication permission.** Only an `https://…linkedin.com/in/<name>` address is accepted. The browser tidies `linkedin.com/in/x` into that form; the database enforces the same rule.
- **Display is a separate choice, `researchers.linkedin_public`, default false.**
  - Existing values are private: nothing is inferred from a legacy `publication_scope`.
  - Only the submitter can turn it on, and only for their own row as a listed author.
  - A LinkedIn link that anyone else adds (for example a depositor adding an author) stays private until that person chooses otherwise, which M4/M5 will provide.
  - Clearing the link clears the choice.
- **Shared researchers are protected.** A researcher row linked to more than one paper is a shared identity: no single paper's private link can change its name, LinkedIn or display choice, and an attempt is refused with an explanation ("also listed on another submission… please contact us") rather than silently ignored. Sending it unchanged is fine, and rows exclusive to the paper edit as before. Naming someone never reaches another paper's row: rows are matched only among this paper's own links.
- **Public display is not built yet.** `publicLinkedIn()` in `lib/validation/linkedin.js` is the rule a public page will use: a link only when its owner chose to show it and it is still valid. Email and WhatsApp are never public fields.

## The processing decision: one authority

`papers.submission_extraction_policy` is the single, immutable record of whether a paper may ever be processed automatically. `papers.submission_decision_source` records where it came from:

| Source | Set by | Decision |
|---|---|---|
| `server` | the new path | `automatic` only if `EXTRACTION_MODE=automatic` **and** `extraction_policy.mode = 'automatic'` at acceptance **and** the accepted offer said `automatic` **and** the researcher chose automatic reading **and** the accepted agreement version describes the external AI arrangement the server attests to (`GEMINI_DATA_TERMS=unpaid` ↔ `agreement_versions.external_ai_processing = 'gemini_api_unpaid'`, version 4, migration 0020 — the launch arrangement; or `paid` ↔ `gemini_api_paid`, version 2, superseded). Anything else, including unset, invalid or unknown values, is `manual`. The insert trigger can only **lower** it, if the policy row turned `manual` before finalization. |
| `database_policy` | the old path (`submit_paper`), until it is closed | the policy row alone, as in M1 |
| `null` | rows older than 0011 | pre-M1 form, with its processing consent. **Since 0018 never read automatically**: they carry no acceptance of an agreement that describes it (see "The agreement gate"). Their history is not rewritten. |

Automatic extraction additionally needs `EXTRACTION_MODE=automatic` at extraction time. That is the operational switch: it can stop processing later, but it can never broaden what was recorded.

**The conflict case** is the application in manual mode while the policy row says automatic.
- **New path:** recorded `manual`, so the paper is never extracted, even if every later request fails and automatic mode returns. This is tested on a real database.
- **Old path:** the database cannot see the application's mode, so the stamp comes from the policy row. This residual gap exists only while the old path is open. Until cutover, operate by the rule: when `EXTRACTION_MODE` is `manual`, set the policy row to `manual` too.

**How M1's pieces fit.** The `extraction_policy` row stays as the database-side restriction that both paths respect. The M1 trigger is extended rather than duplicated. After cutover it applies to server-path inserts only; the `database_policy` source then only exists on historical rows.

## The agreement gate (migrations 0018–0020)

Founder decisions of 2026-10-04: Gemini reading is the default, manual entry is the researcher's alternative, and no document goes to Gemini unless the researcher accepted an agreement version that explains it. One database function, `external_ai_permission(paper)`, answers whether a paper may be read; the extraction route asks it before any download or provider call, and the confirmation read returns its answer as `automatic_processing`. It allows reading only for a paper created from a **finalized acceptance** whose decision was `automatic`, whose researcher chose automatic reading, and whose agreement version (same text hash) describes the arrangement recorded at acceptance (`ai_processing_terms`). Separately, the route requires the server's own attestation, `GEMINI_DATA_TERMS`, at the time of the request, naming the same arrangement.

| Paper | Read? | Why |
|---|---|---|
| New form, version 4 accepted, automatic chosen, `GEMINI_DATA_TERMS=unpaid` | yes (front pages / Word text) | the launch case |
| New form, version 2 accepted, automatic chosen, `GEMINI_DATA_TERMS=paid` | yes (front pages) | superseded; not used for this project |
| New form, version 2 accepted, server attests `unpaid` (or version 4 and `paid`) | never | `agreement_not_applicable`: the arrangement accepted is not the one in force |
| New form, manual chosen | never | recorded at creation; the document is never sent |
| New form, version 1 (2026-09-25) accepted | never | that text does not describe external AI reading |
| Legacy anonymous form (while it stays open) | never | no acceptance at all; since 0018 it is also stamped `manual` whatever the policy row says |
| Created before 0011 or before 0018 | never | no applicable acceptance; history unchanged |
| `GEMINI_DATA_TERMS` missing or anything but `unpaid`/`paid` | never | refused before the database is asked; recorded as the server's manual decision |

Every refusal is recorded as a manual decision (`manual_entry_source = 'mode'`), and the confirmation page opens straight into hand entry for a paper that can never be read, instead of waiting on a reading that cannot happen. A failed reading offers "Try again" and "Enter the details yourself"; switching to hand entry keeps the upload and everything already on the paper.

## The processing offer

What the researcher accepts includes how their document will be processed, so the recorded processing must never be broader than what was shown.

- `/terms` signs an offer: `base64url({v, iat, exp, d, a}) . HMAC(SUBMISSION_TOKEN_SECRET, "offer:" + payload)`. `d` is the decision shown; `a` is the list of `[agreementId, sha256]` shown; it is valid for 30 minutes.
- `/intent` requires `offerToken`, and before recording anything or issuing an upload authorization:

| Situation | Response |
|---|---|
| missing, malformed, tampered or signed with another secret | `400 offer_invalid` |
| older than 30 minutes | `409 offer_stale`, `staleBecause: offer_expired` |
| agreement not in the offer, or a different hash; or deactivated/replaced since | `409 offer_stale`, `staleBecause: agreement_changed` |
| mode or policy now `automatic` but the offer said `manual` | `409 offer_stale`, `staleBecause: processing_broadened` |
| mode or policy now `manual` but the offer said `automatic` | `201`, recorded `manual`, with `processing: { decision: 'manual', offered: 'automatic', changedFromOffer: true }` |

  Every `409 offer_stale` carries `refresh: '/api/submissions/terms'`.
- The browser cannot supply a decision: the offer is signed and the body is strict. The database also caps the decision by the offer (`create_submission_intent`) and a check constraint forbids a recorded `automatic` under a `manual` offer, so a change between the handler's check and the insert can only narrow.

## The submission form (M2B)

`/submit` serves `AcceptanceSubmissionForm` when `SUBMISSION_ACCEPTANCE_FLOW=enabled`, and the unchanged legacy form otherwise. When the new flow is selected but unavailable (no active agreement, database not ready, the endpoints off), the form says submissions are temporarily unavailable and submits nothing. **There is no fallback to the legacy anonymous path.**

**What the researcher sees and does:**
1. **About you:** name, email, and optional WhatsApp.
2. **Your role:** author, one of the authors, or submitting on behalf of the authors. A depositor must enter the authors' names in order; the form says they will not be listed as an author.
3. **The file** (PDF or DOCX, at most 20 MB).
4. **Publication permission,** two ordinary choices:
   - **Record and abstract only** (the default);
   - **Record, abstract and full text**, which readers may read online and download after approval.

   The form says nothing is published before review, and that no open (Creative Commons) licence is applied.
5. **How the document will be processed:** the server's offered decision. When it is automatic, a short explanation (what is sent to Google's Gemini, that Google does not use it to improve its products but keeps it up to 55 days for abuse monitoring, that suggestions can be wrong) and two choices: **Read my document with Gemini (recommended)**, preselected, and **Enter details manually**, which keeps the document away from Gemini. When it is manual, only the manual explanation. The browser never infers the decision.
6. **Agreement:**
   - The short summary.
   - An in-page disclosure with the full agreement text as served, in the interface language when that version is offered. Opening it keeps every input and the chosen file, and there is no forced scrolling.
   - One unchecked checkbox, labelled with the agreement's own acceptance sentence.
   - Submit stays disabled until every required field is valid and the box is ticked; a "Still needed" line says what is missing. The server enforces acceptance on its own.

**Offer changes and recovery:**

| Situation | What happens |
|---|---|
| The offer is about to expire, or `/intent` answers `offer_stale` / `offer_invalid` | The terms are reloaded, acceptance is cleared, inputs and file are kept, and a notice (focused, announced) explains that acceptance is needed again. Nothing is resubmitted by itself. |
| Processing became narrower (`changedFromOffer`) | Before any upload, the form explains that the document will not be read automatically. It uploads only after "Continue with upload". |
| The interface language changes | Before submitting: acceptance counts only for the agreement it was given to, so switching language shows the other text and withdraws acceptance, with a notice. While a submission is in progress (below), the accepted agreement stays shown in its own language, with a note, and acceptance stands. The recorded agreement is always the one shown when the box was ticked. |
| An intent exists (recording, awaiting "Continue with upload", uploading, finalizing) | **The form is locked to the accepted snapshot.** Every control is disabled, and the upload uses the File object captured with the intent, never whatever the file input holds later. The narrowed notice offers "Cancel and edit details", which drops the intent and unlocks the form. |
| Anything accepted changes afterwards: offer, agreement, setting, role, contact details, authors, or a new file selection (a new selection is always new, even with the same name and size) | A new intent (a new acceptance record). An unchanged retry reuses the open intent. |
| Upload fails | The error is explained; pressing Submit again reuses the same intent. |
| **Upload link expired** (Storage's own lifetime, read from the link, never assumed) | A distinct message. The next Submit takes a new intent and link. |
| **Submission expired** (the 30-minute intent) | A distinct message; inputs are kept, and Submit starts again. |
| Finalization response lost or failing | Retried automatically (it is idempotent). If still unanswered, the intent id and token, never the file or confirmation token, stay in this tab's `sessionStorage`, and the form offers "Complete submission" after a reload. **The server decides the outcome, whatever the browser thinks of the expiry**: a submission finalized before its answer was lost is recovered with the same private link, even after the intent has expired. The offer is cleared only on success, a definitive answer (expired and never finalized, a file that never arrived, a mismatched file) or "Start a new one instead"; a network failure, a temporary server failure or a rate limit keeps it, with a working retry. |
| Double clicks, Enter presses | One request at a time; the button is disabled while working. |

Messages exist in English and Arabic for each of these, and for rate limiting, unavailable service and success.

**After success:** the browser goes to the private confirmation page, `/confirm/<token>`, which shows a receipt:
- the research was received, and is private and unpublished;
- the next step is checking and confirming the details, then review;
- anything public later follows the chosen permission, and only after approval.

The page also says its address is a private link and not a public page for the research. The page carries `noindex` and `no-referrer`. No analytics exist on the site. The timing log records only an 8-character token prefix. The manual-entry flow and its safeguards are unchanged. The browser asks `/api/extract` to start only when `extraction.mayStart`, and the route enforces the same rule.

## Limits

- **Request limits** per client address per hour: `terms` 120, `intent` 10, `finalize` 30.
  - The key is an HMAC of the forwarded address. The address itself is not stored.
  - If the limit table cannot be read, the endpoint fails closed with 503.

## Configuration

| Variable | Meaning |
|---|---|
| `SUBMISSION_ACCEPTANCE_FLOW` | `enabled` serves the new endpoints **and** the new form at `/submit`; anything else returns 404 from the endpoints and serves the legacy form. Enabled only at cutover step 4, after an agreement is activated. |
| `SUBMISSION_TOKEN_SECRET` | At least 32 characters, server-only, **Production scope only**. It signs offers and derives confirmation tokens. Rotating it invalidates outstanding offers (researchers see `offer_invalid` and reload the terms) and changes the token a retried finalization would return; papers already created keep working. |

The agreement rows are seeded `active = false`. Activating one is the founder's decision after the conditions in `docs/legal/README.md` are met, not a deployment step.

## Verified locally, and what is not

**On the local Supabase stack** (Supabase Postgres 17.6.1.011, PostgREST 12.2.12, Storage API 1.28.0 with the file backend, supabase-js from this repository):
- **Service role:** the new functions are reachable only with the service role. `anon`/`authenticated` cannot call any of them, including `record_declared_authors`, and cannot read the acceptance, agreement, limit, policy, paper or researcher tables.
- **Signed uploads:** path binding; `upsert: false` refusing a second upload before and after finalization; expired links refused; intent expiry not revoking a link; the link's expiry recorded.
- **Concurrency:** concurrent uploads and finalizations create one paper.
- **Cleanup:** removes only abandoned objects, after link expiry plus margin.
- **Cutover (`supabase-cutover.test.js`):**
  - before 0014, anonymous upload and `submit_paper` work (today's production state);
  - 0014 aborts, changing nothing, while any permissive storage write policy reachable by a browser role (directly, through `public`, or through role membership; including `with check (true)` and an unscoped UPDATE policy) is not provably limited to another bucket, and accepts one written exactly as `bucket_id = '<another bucket>'`;
  - it revokes every `submit_paper` overload, including one reachable only through `PUBLIC`;
  - after it, anonymous and authenticated direct upload and `submit_paper` are refused through the real APIs;
  - after it, the signed flow still completes for an author and a depositor, and confirmation still works with the token.
- **In Chromium, browser to database (`browser-e2e.test.js`, before and after 0014):**
  - English and Arabic, keyboard-only submission, and 360/390/768/1280/1440 px without horizontal scrolling;
  - both publication settings; author, co-author and depositor, with the depositor's authors linked and the depositor not;
  - manual processing, and simulated automatic processing (mock provider);
  - stale offers (processing broadened, agreement deactivated), narrowed processing, and a language switch;
  - upload failure, upload-link expiry, submission expiry, a lost finalization response, recovery after reload, and duplicate clicks;
  - server-side enforcement of acceptance and the offer;
  - no Facebook field, LinkedIn validation, private by default, and only the submitter able to show their own;
  - no unexpected console errors.

**Not verified; release requirements:**
- The signed-upload lifetime on the hosted project. Hosted Supabase documents 2 hours; the Storage API default is 60 seconds. The code reads it from the link either way, and no lifetime is shown to researchers.
- The hosted gateway (Kong), including CORS for the production origin, and the S3-backed Storage backend.
- Vercel's forwarding of client addresses to the request limits.
- The `docs/legal/*.md` files being present in the deployed terms function. `next.config.mjs` includes them; if they were missing, the terms would offer no agreement and the form would say submissions are unavailable, never fall back.

## Cutover (staged)

Order matters. The legacy form uploads with the anonymous role, so closing that path before the new form is live would break every submission.

| Step | What | Depends on | If it fails |
|---|---|---|---|
| 1 | Apply 0011, 0012 and 0013 to production, in order. All additive. The currently deployed app keeps working: it reads `facebook_url` defensively, and a LinkedIn value it sends now has to be a valid profile address. | — | Roll back per each file; nothing is lost while no new-path paper exists. |
| 2 | Deploy this release with `SUBMISSION_ACCEPTANCE_FLOW` **unset** and `SUBMISSION_TOKEN_SECRET` set (Production scope). The legacy form is served; nothing visible changes except the confirmation screen (LinkedIn only, with its choice, and the private-link note). | 1 | Redeploy the previous build. |
| 3 | On a preview project, not production: run the local checks' scenarios against hosted Supabase: link lifetime, path binding, overwrite refusal, expiry, CORS from the site origin. | 2 | Fix before step 4. |
| 4 | **Founder decision:** activate an agreement version (`docs/legal/README.md` conditions), then set `SUBMISSION_ACCEPTANCE_FLOW=enabled` and redeploy. The new form is served. Make one real signed submission end to end. | 3 | Unset the flag and redeploy: the legacy form returns (the old path is still open). |
| 5 | Apply **0014**. It aborts, changing nothing, unless 0012 and 0013 are present and afterwards no `submit_paper` overload is executable by `anon`/`authenticated` (including through `PUBLIC`), no browser role can bypass RLS, and every permissive storage write policy a browser role can reach is provably limited to another bucket (the error names each offending policy). | 4, verified | Emergency rollback at the bottom of 0014 reopens the bypass, and is only paired with serving the legacy form again. |
| 6 | Verify from outside: an anonymous upload to `papers` and an anonymous `submit_paper` call are refused, and a signed submission still completes. | 5 | Investigate; do not reopen the bypass as a resting state. |

**Acceptance is enforced only from step 5.** Between steps 4 and 5 the bypass is still open; keep that window short. After step 5, `database_policy` stamps stop being created and every new paper's decision is server-made. Legacy rows keep their legacy consent columns unchanged.

