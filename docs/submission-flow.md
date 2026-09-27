# Submission flow (Phase 3 M2A): acceptance, upload, finalization

**Status: backend foundation, built and tested in isolation; not deployed; inactive by default.** The live form still uses the old path: an anonymous storage upload, then `submit_paper`. **M2A alone does not secure production.** Direct requests can still bypass acceptance until the old path is closed at M2B cutover (see "Cutover" below).

Code: `lib/submission/acceptanceHandlers.js`, `app/api/submissions/*`, and `lib/extraction/extractHandler.js` (the document-hash check). Database: `supabase/migrations/0012_submission_acceptance.sql`. Tests, by tier:

| Tier | File | What is real |
|---|---|---|
| Mocked (CI) | `scripts/test-submission-acceptance.js` | Nothing external: validation, offers, token parsing, migration text |
| Real Postgres | `supabase/tests/run-0012.sh` → `submission-postgres.test.js` | Postgres 16 and every SQL function; supabase-js calls translated to SQL; **a storage substitute** |
| Real local Supabase | `supabase/tests/local-stack/start.sh`, then `supabase-local.test.js` | Supabase's Postgres image, **PostgREST, the Storage API** and supabase-js itself, on localhost. Not a hosted project |

## Flow

1. **`GET /api/submissions/terms`.** Returns:
   - the active agreement versions: id, language, version label and date, SHA-256;
   - the two publication settings and the default `record_abstract`;
   - the claimed roles;
   - file limits;
   - `processing.decision`: what a new submission would get now;
   - **`offer: { token, decision, expiresAt }`**: a server-signed record of what was shown (see "The processing offer").
2. **`POST /api/submissions/intent`.** Acceptance and choice. The body may contain only these fields:

   `{ offerToken, agreementId, accepted: true, publicationSetting, claimedRole, fullName, email, whatsapp?, whatsappCountry?, file: { name, size, type } }`

   Any other field is refused (`400 unexpected_field`). That includes any attempt to name a processing mode, path, hash, legal text or timestamp.

   The server checks:
   - `accepted` is exactly `true`;
   - the offer is genuine, unexpired, and showed this agreement with this hash;
   - processing now is not broader than the offer (else `409 offer_stale`, before anything is recorded);
   - the agreement id is in the application registry (`lib/submission/agreements.js`) **and** is an active row in `agreement_versions` with the same language and hash;
   - the setting, role, contact details, file extension, declared MIME type and size (at most 20 MB).

   It then records a **`submission_acceptances`** row containing:
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
   - `processing: { decision, offered, changedFromOffer }`. `decision` is **authoritative**.
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

   A repeated or concurrent call returns the same paper and the same confirmation token and creates nothing. The response is `{ confirmationToken, alreadyFinalized, processing: { decision }, extraction: { mayStart } }`.
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
| `author` | as a researcher, position 1 |
| `coauthor` | as a researcher, position unset (the confirmation step places them) |
| `authorized_depositor` (a librarian, a volunteer) | **not linked.** The confirmation step collects the actual authors. |

All of these are unverified declarations (`identity_verified = false`). The confirmation step (`confirm_researcher_metadata`) sets the final list and order. It adds only the people it is given, so a depositor who is not listed is never reinserted. `seedResearchers` starts an empty paper from one blank row, not from the depositor.

## The processing decision: one authority

`papers.submission_extraction_policy` is the single, immutable record of whether a paper may ever be processed automatically. `papers.submission_decision_source` records where it came from:

| Source | Set by | Decision |
|---|---|---|
| `server` | the new path | `automatic` only if `EXTRACTION_MODE=automatic` **and** `extraction_policy.mode = 'automatic'` at acceptance **and** the accepted offer said `automatic`. Anything else, including unset, invalid or unknown values, is `manual`. The insert trigger can only **lower** it, if the policy row turned `manual` before finalization. |
| `database_policy` | the old path (`submit_paper`), until it is closed | the policy row alone, as in M1 |
| `null` | rows older than 0011 | pre-M1 form, with its processing consent; unchanged behaviour |

Automatic extraction additionally needs `EXTRACTION_MODE=automatic` at extraction time. That is the operational switch: it can stop processing later, but it can never broaden what was recorded.

**The conflict case** is the application in manual mode while the policy row says automatic.
- **New path:** recorded `manual`, so the paper is never extracted, even if every later request fails and automatic mode returns. This is tested on a real database.
- **Old path:** the database cannot see the application's mode, so the stamp comes from the policy row. This residual gap exists only while the old path is open. Until cutover, operate by the rule: when `EXTRACTION_MODE` is `manual`, set the policy row to `manual` too.

**How M1's pieces fit.** The `extraction_policy` row stays as the database-side restriction that both paths respect. The M1 trigger is extended rather than duplicated. After cutover it applies to server-path inserts only; the `database_policy` source then only exists on historical rows.

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

## Interface contract for M2B

- **Before acceptance:**
  - Show the agreement text rendered from `docs/legal/` for the `agreementId` returned by `/terms`, in the active language.
  - Show one unchecked acceptance checkbox.
  - Show the publication setting as a separate choice, defaulting to "Record and abstract only".
  - Show the processing behaviour from `offer.decision`.
  - Keep `offer.token` and send it with `/intent`.
- **On `409 offer_stale`:** fetch `/terms` again, show the new agreement and processing information, and ask for acceptance again. Never resubmit silently with a new offer.
- **After `201` from `/intent`:** show `processing.decision`. If `changedFromOffer` is true, say before uploading that the document will not be read automatically and details will be entered by hand. That can only be a narrowing.
- **Roles:** offer author / co-author / authorized depositor. For a depositor, the confirmation page must ask for the actual authors, since none is pre-filled.
- **Upload with the returned authorization, then call `/finalize`:**
  - Upload promptly. The authorization's lifetime is Storage's (confirm on the preview project); the intent's is 30 minutes.
  - Retry `/finalize` on network failure; it is safe to repeat.
  - On `410 intent_expired`, start again from `/terms`.
  - On `409 upload_missing`, re-upload with the same authorization, then finalize.
- **Navigate** to `/confirm/<confirmationToken>`. Call `/api/extract` only if `extraction.mayStart`.
- **Errors** are typed (`reason`) and need EN/AR wording in M2B:
  - `acceptance_required`
  - `offer_invalid` and `offer_stale` (with `staleBecause`)
  - `agreement_unknown`
  - `publication_setting_invalid` and `claimed_role_invalid`
  - `name_required`, `email_invalid` and `whatsapp_invalid`
  - `file_type_invalid` and `file_size_invalid`
  - `object_size_mismatch` and `object_type_invalid`
  - `upload_missing` and `intent_expired`
  - `rate_limited`
  - `database_not_ready` and `upload_authorization_failed`

## Limits

- **Request limits** per client address per hour: `terms` 120, `intent` 10, `finalize` 30.
  - The key is an HMAC of the forwarded address. The address itself is not stored.
  - If the limit table cannot be read, the endpoint fails closed with 503.

## Configuration

| Variable | Meaning |
|---|---|
| `SUBMISSION_ACCEPTANCE_FLOW` | `enabled` serves the new endpoints; anything else returns 404. Leave it unset in production until M2B. |
| `SUBMISSION_TOKEN_SECRET` | At least 32 characters, server-only, **Production scope only**. It signs offers and derives confirmation tokens. Rotating it invalidates outstanding offers (researchers see `offer_invalid` and reload the terms) and changes the token a retried finalization would return; papers already created keep working. |

The agreement rows are seeded `active = false`. Activating one is the founder's decision after the conditions in `docs/legal/README.md` are met, not a deployment step.

## Verified against real Supabase services, and what is not

**Verified on a local Supabase stack** (Supabase Postgres 17.6.1.011, PostgREST 12.2.12, Storage API 1.28.0 with the file backend, supabase-js from this repository; `supabase-local.test.js`):
1. The handlers reach every new function with the service role through PostgREST.
2. `anon` and `authenticated` cannot call any of the seven functions, and read nothing from the acceptance, agreement, limit, policy, paper or researcher tables.
3. A signed upload authorization uploads only to its own path; another path, a sibling path, or a token edited without the secret is refused.
4. With `upsert: false`, an existing object, before or after finalization, cannot be replaced through the authorization, even when the client asks for upsert. The finalized bytes are unchanged.
5. An expired authorization is refused. Intent expiry does not revoke an authorization.
6. The authorization's expiry is readable from its token and is what the server records.
7. Concurrent upload and finalization, then a retry, create exactly one paper. Concurrent finalizations with the object in place return one token.
8. Cleanup removes an abandoned object from real Storage only after authorization expiry plus margin, and leaves finalized and unrelated objects.
9. The bucket is private to `anon`. The old anonymous upload path is still open (expected until cutover).

**Still unverified, to check on a preview project before cutover:**
- The authorization lifetime on this project's hosted Storage. Hosted Supabase documents 2 hours; the Storage API's own default is 60 seconds. The code reads it from the token either way; the interface wording depends on it.
- The hosted API gateway (Kong) and the S3-backed Storage backend. Locally, a small gateway and the file backend stand in for them.
- Vercel's forwarding of client addresses to the request limits.

## Cutover (staged)

1. **M2A, this change.** Apply 0011 and 0012. Deploy with `SUBMISSION_ACCEPTANCE_FLOW` unset. Nothing visible changes, and the old path stays open. **Production is not secured by this step.**
2. **M3, required before M2B's release.**
   - Remove Facebook collection.
   - Make LinkedIn visibility independent of `publication_scope`. New-path papers have an empty `publication_scope`, so under today's `confirm_researcher_metadata` their LinkedIn links would silently not be saved.
3. **M2B.**
   - Build the new form on the contract above, including the stale-offer reacceptance and the depositor's author entry.
   - On a preview project: confirm the upload authorization lifetime, and re-run the local Supabase checks' scenarios (path binding, overwrite, expiry, cleanup) against hosted Storage.
   - Enable the flow on a preview, then in production.
   - Activate the agreement only when its conditions are met.
4. **Close the old path**, in a separate migration after M2B is verified in production:
   - drop the storage policy "anon can upload research files";
   - revoke `execute` on `submit_paper` from `anon`.

   Then verify that a direct anonymous upload and a direct `submit_paper` call are both refused.
5. After that, `database_policy` stamps stop being created, and every new paper's decision is server-made.
