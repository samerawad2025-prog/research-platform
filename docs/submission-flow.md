# Submission flow (Phase 3 M2A): acceptance, upload, finalization

**Status: backend foundation, built and tested in isolation; not deployed; inactive by default.** The live form still uses the old path: an anonymous storage upload, then `submit_paper`. **M2A alone does not secure production.** Direct requests can still bypass acceptance until the old path is closed at M2B cutover (see "Cutover" below).

Code: `lib/submission/acceptanceHandlers.js`, `app/api/submissions/*`, and `lib/extraction/extractHandler.js` (the document-hash check). Database: `supabase/migrations/0012_submission_acceptance.sql`. Tests: `scripts/test-submission-acceptance.js` (CI, no database) and `supabase/tests/run-0012.sh` (real local Postgres plus a storage substitute).

## Flow

1. **`GET /api/submissions/terms`.** Returns:
   - the active agreement versions: id, language, version label and date, SHA-256;
   - the two publication settings and the default `record_abstract`;
   - the claimed roles;
   - file limits;
   - a **preview** of the processing decision a new submission would get now.
2. **`POST /api/submissions/intent`.** Acceptance and choice. The body may contain only these fields:

   `{ agreementId, accepted: true, publicationSetting, claimedRole, fullName, email, whatsapp?, whatsappCountry?, file: { name, size, type } }`

   Any other field is refused (`400 unexpected_field`). That includes any attempt to name a processing mode, path, hash, legal text or timestamp.

   The server checks:
   - `accepted` is exactly `true`;
   - the agreement id is in the application registry (`lib/submission/agreements.js`) **and** is an active row in `agreement_versions` with the same language and hash;
   - the setting, role, contact details, file extension, declared MIME type and size (at most 20 MB).

   It then records a **`submission_acceptances`** row containing:
   - the agreement version, language and hash;
   - `accepted_at` in server time;
   - the claimed role, with `identity_verified = false`, because an anonymous declaration is not identity verification;
   - the publication setting;
   - the processing decision snapshot;
   - contact details;
   - a **server-chosen** object path `intents/<acceptance id>/<random>.<ext>`;
   - the declared size, and an expiry 30 minutes ahead.

   The response gives the browser:
   - `intentId` and `intentToken`. The token is a secret; only its hash is stored.
   - `processing.decision`, which is **authoritative**.
   - an upload authorization for that one path: `upload.path`, `upload.token` and `upload.signedUrl`, created with `upsert: false`.
3. **Upload.** The browser uploads the file with that authorization, for example with `supabase.storage.from('papers').uploadToSignedUrl(path, token, file)`. The bucket stays private.
4. **`POST /api/submissions/finalize`** with `{ intentId, intentToken }`. The server:
   - reads the object at the recorded path, never at a path the browser names;
   - checks its size equals the declared size;
   - checks its content is a real PDF (`%PDF-`) or a DOCX (a ZIP containing `word/document.xml`);
   - computes its SHA-256;
   - calls `finalize_submission_intent`.

   That function locks the acceptance row and creates the researcher, the paper and the link **exactly once**. The paper carries:
   - `submission_acceptance_id`;
   - `publication_setting`;
   - `file_sha256` and `file_size`;
   - the processing decision.

   A repeated or concurrent call returns the same paper and the same confirmation token and creates nothing. The response is `{ confirmationToken, alreadyFinalized, processing: { decision }, extraction: { mayStart } }`.
5. **Extraction.** The browser calls `/api/extract` only when `extraction.mayStart` is true. The route enforces the same rule itself.
   - For these papers it also checks that the stored object still has the accepted SHA-256 before anything can be sent. On a mismatch it fails with `document_mismatch`, and nothing is sent.
   - The existing claim compare-and-swap prevents duplicate extraction jobs.

**Transport versus finalization.**
- The upload authorization is **not single-use**. It can be retried until an object exists at the path or the authorization expires, which is Supabase's lifetime, not ours.
- What is one-time is **finalization**: one paper per acceptance, bound to one document hash.
- Once an object exists, `upsert: false` prevents replacing it through the authorization. If the object were replaced by other means, the extraction route's hash check refuses to send it.

**Tokens.**
- Only hashes of the intent token and the confirmation token are stored.
- The confirmation token is derived as `HMAC(SUBMISSION_TOKEN_SECRET, intentToken)`. A retried finalization can therefore return the same token, and a copy of the database alone cannot produce it.
- No token, signed URL, secret or contact detail is written to logs. This is tested.

## The processing decision: one authority

`papers.submission_extraction_policy` is the single, immutable record of whether a paper may ever be processed automatically. `papers.submission_decision_source` records where it came from:

| Source | Set by | Decision |
|---|---|---|
| `server` | the new path | `automatic` only if `EXTRACTION_MODE=automatic` **and** `extraction_policy.mode = 'automatic'` at acceptance. Anything else, including unset, invalid or unknown values, is `manual`. The insert trigger can only **lower** it, if the policy row turned `manual` before finalization. |
| `database_policy` | the old path (`submit_paper`), until it is closed | the policy row alone, as in M1 |
| `null` | rows older than 0011 | pre-M1 form, with its processing consent; unchanged behaviour |

Automatic extraction additionally needs `EXTRACTION_MODE=automatic` at extraction time. That is the operational switch: it can stop processing later, but it can never broaden what was recorded.

**The conflict case** is the application in manual mode while the policy row says automatic.
- **New path:** recorded `manual`, so the paper is never extracted, even if every later request fails and automatic mode returns. This is tested on a real database.
- **Old path:** the database cannot see the application's mode, so the stamp comes from the policy row. This residual gap exists only while the old path is open. Until cutover, operate by the rule: when `EXTRACTION_MODE` is `manual`, set the policy row to `manual` too.

**How M1's pieces fit.** The `extraction_policy` row stays as the database-side restriction that both paths respect. The M1 trigger is extended rather than duplicated. After cutover it applies to server-path inserts only; the `database_policy` source then only exists on historical rows.

## Interface contract for M2B

- **Before acceptance:** show the agreement text rendered from `docs/legal/` for the `agreementId` returned by `/terms`, in the active language; one unchecked acceptance checkbox; the publication setting as a separate choice, defaulting to "Record and abstract only"; and the `/terms` processing preview.
- **After `/intent`:** show `processing.decision` from its response, which is the recorded decision, not the preview. If it differs from the preview, the form says so before uploading.
- **Upload with the returned authorization, then call `/finalize`:**
  - Retry `/finalize` on network failure; it is safe to repeat.
  - On `410 intent_expired`, start again.
  - On `409 upload_missing`, re-upload with the same authorization, then finalize.
- **Navigate** to `/confirm/<confirmationToken>`. Call `/api/extract` only if `extraction.mayStart`.
- **Errors** are typed (`reason`) and need EN/AR wording in M2B:
  - `acceptance_required`
  - `agreement_unknown` and `agreement_not_active`
  - `publication_setting_invalid`
  - `file_type_invalid` and `file_size_invalid`
  - `object_size_mismatch` and `object_type_invalid`
  - `rate_limited`
  - `database_not_ready`

## Limits and housekeeping

- **Request limits** per client address per hour: `terms` 120, `intent` 10, `finalize` 30.
  - The key is an HMAC of the forwarded address. The address itself is not stored.
  - If the limit table cannot be read, the endpoint fails closed with 503.
- **Abandoned acceptances:**
  - Each `/intent` call runs a bounded cleanup of at most 5 per call. It marks acceptances expired more than an hour ago, and removes **only** each one's own object at `intents/<id>/…`.
  - A finalized acceptance, and any object outside that prefix (including every old-path upload), is never touched.
  - The acceptance record itself is kept as evidence.
- **Not handled:** uploads made through the old anonymous path and never submitted. There is no cleanup for them yet; that closes with the path.

## Configuration

| Variable | Meaning |
|---|---|
| `SUBMISSION_ACCEPTANCE_FLOW` | `enabled` serves the new endpoints; anything else returns 404. Leave it unset in production until M2B. |
| `SUBMISSION_TOKEN_SECRET` | At least 32 characters, server-only, **Production scope only**. Rotating it changes the token a retried finalization would return; papers already created keep working. |

The agreement rows are seeded `active = false`. Activating one is the founder's decision after the conditions in `docs/legal/README.md` are met, not a deployment step.

## Assumptions (unverified against Supabase itself)

The tests use a storage substitute that models these behaviours. They have **not** been verified against a real Supabase Storage project, and must be checked on a preview project before cutover:

1. A signed upload authorization only permits upload to its own path.
2. With `upsert: false`, an upload to a path that already has an object is refused.
3. The authorization's lifetime (believed to be 2 hours) is independent of our 30-minute acceptance expiry. The finalization check is ours and does not rely on it.
4. `download()` with the service-role client returns the stored bytes.

PostgREST's handling of these RPCs was not exercised either. Tests run the same calls as SQL through `psql`.

## Cutover (staged)

1. **M2A, this change.** Apply 0011 and 0012. Deploy with `SUBMISSION_ACCEPTANCE_FLOW` unset. Nothing visible changes, and the old path stays open. **Production is not secured by this step.**
2. **M3, required before M2B's release.**
   - Remove Facebook collection.
   - Make LinkedIn visibility independent of `publication_scope`. New-path papers have an empty `publication_scope`, so under today's `confirm_researcher_metadata` their LinkedIn links would silently not be saved.
3. **M2B.**
   - Build the new form on the contract above.
   - Verify the storage assumptions on a preview project.
   - Enable the flow on a preview, then in production.
   - Activate the agreement only when its conditions are met.
4. **Close the old path**, in a separate migration after M2B is verified in production:
   - drop the storage policy "anon can upload research files";
   - revoke `execute` on `submit_paper` from `anon`.

   Then verify that a direct anonymous upload and a direct `submit_paper` call are both refused.
5. After that, `database_policy` stamps stop being created, and every new paper's decision is server-made.
