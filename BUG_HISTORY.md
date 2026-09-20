# BUG_HISTORY.md

**Generated:** September 12, 2026. Sixteen bugs, in the order they were found and fixed. Feature additions (WhatsApp field, extraction-scope simplification) are documented in `CLAUDE_CODE_HANDOVER.md` instead — this file is bugs only: something was broken, it was diagnosed, it was fixed, it was tested.

**Production-verified 2026-09-13** (see `CURRENT_STATUS.md` for full evidence): bugs #13, #15, and #16 below were previously confirmed only against mock data or a single forensic test file. A direct query of live `ai_generations`/`papers` rows from real submissions dated 2026-09-11 and 2026-09-13 now confirms all three fixes are deployed and working correctly on real Gemini calls in production — 14/15 recent generations return `supervisor_name` correctly, recent real theses show `university`/`faculty`/`degree_type` populated from DOCX headers, and a real 6-researcher thesis survived a two-pass merge intact. Bugs #7 and #10 (typed `failure_code`, `partial` status) remain **unexercised** in production — no failure of any kind has occurred since 2026-09-09, so neither is confirmed working nor confirmed broken; do not treat them as verified.

A pattern worth noting before the list: bugs 13–16 were all found by querying real, live `ai_generations` records via a direct Supabase connection rather than reasoning from synthetic test cases, and two earlier hypotheses in that same investigation (a DOCX text-box content-loss theory, and a general Gemini-nondeterminism theory for the supervisor field) were explicitly **disproven** by real data and replaced with the actual causes below. Where that happened, it's called out.

---

## 1. `gen_random_bytes` / `digest` not found (pgcrypto search_path)

**Root cause:** Supabase installs the `pgcrypto` extension into an `extensions` schema, not `public`. Every SECURITY DEFINER function in this project explicitly sets `search_path = public` (a deliberate security measure against search-path injection), which excludes the one schema pgcrypto actually lives in. Unqualified calls to `gen_random_bytes()` and `digest()` inside those functions failed to resolve.

**Investigation summary:** Reported via a production error: `function gen_random_bytes(integer) does not exist`. Reproduced by building a local Postgres database with pgcrypto deliberately installed into a separate `extensions` schema (matching Supabase's real layout) rather than assuming the cause — the reproduction produced the exact same error message before any fix was written. Independently confirmed the same root cause affected `get_paper_for_confirmation` and `confirm_researcher_metadata` too (both also call `digest()`), not only `submit_paper`, by testing each in isolation before touching any code.

**Fix implemented:** Widened `search_path` to `public, extensions` in all three affected functions. No logic changes, no parameter or return-type changes — a `CREATE OR REPLACE` only.

**Files modified:** Database migration only (`fix_pgcrypto_search_path.sql`); no application code changed. `schema.sql` (fresh-install canonical schema) updated to match.

**Regression testing performed:** Reproduced the failure against a realistic simulation before fixing; reran all three functions after the fix and confirmed success; reconfirmed a wrong/invalid token was still correctly rejected (security unchanged by the fix); reran the full canonical `schema.sql` fresh-install against the same pgcrypto-in-extensions layout to confirm no regression for new installs.

---

## 2. `pdf-parse` crashes in production with `DOMMatrix is not defined`

**Root cause:** `pdf-parse` (v2) is built on `pdf.js`, which references browser-only globals (`DOMMatrix`) at module-load time for its rendering path — a structural incompatibility with Node/serverless runtimes, not something a bundler flag can fix. This is a widely documented issue across multiple `pdf.js`-based libraries, confirmed via search rather than assumed.

**Investigation summary:** First appeared as a Next.js **build-time** bundling error. An initial fix (`serverExternalPackages: ['pdf-parse']`) resolved the build but not the actual **runtime** crash — confirmed distinctly when the identical `DOMMatrix is not defined` error resurfaced in production logs after that fix was deployed. Verified `pdf-lib` (used separately for page slicing) does not share this problem, since it manipulates PDF structure and never renders anything.

**Fix implemented:** Removed `pdf-parse` from the project entirely rather than searching for another workaround. PDF text extraction was never actually necessary once Gemini's native document understanding was used as the primary input method for PDFs — `pdf-lib` remains, used only for page-count and page-range slicing.

**Files modified:** `lib/extraction/pdf.js` (rewritten, `extractTextLayer` removed, `slicePages` retained), `lib/extraction/orchestrator.js` (PDF pass-2 path changed from "keyword-scan a text layer" to "send a broader native slice"), `package.json` (`pdf-parse` dependency removed), `next.config.mjs` (`serverExternalPackages` workaround removed as no longer needed).

**Regression testing performed:** Full production build with `pdf-parse` absent from `node_modules` entirely (382 packages installed vs. 389 before). Grepped the compiled `.next/server` output directly for `DOMMatrix` and `pdf-parse` — the only match found was a code *comment* preserved in a debug sourcemap, not executable code. Re-ran the full mock-provider extraction pipeline for both PDF and DOCX to confirm no functional regression.

---

## 3. Gemini API authentication and default model were stale

**Root cause:** The Gemini provider used a `?key=` query-parameter authentication style and defaulted to an older model. Neither was broken, but both were behind current documented practice at the time they were re-checked.

**Investigation summary:** Discovered while fixing bug #2 — re-verified the Gemini REST API shape directly against current documentation rather than trusting what had been written earlier, and found the documented method is a header (`x-goog-api-key`), not a query parameter, and that Google's own current examples use a newer model than what was hardcoded.

**Fix implemented:** Switched to header-based auth. Updated the default model. Confirmed the project should stay on the stable `generateContent` API rather than Google's newer Interactions API, which is explicitly documented as beta with breaking-change risk — not appropriate for something running unattended.

**Files modified:** `lib/ai/providers/gemini.js`.

**Regression testing performed:** Full production build; confirmed the request shape change didn't alter any other behavior by re-running the mock-provider suite (the mock provider is unaffected by this file, but the full route/orchestrator path was re-verified end to end).

---

## 4. Missing `SUPABASE_SERVICE_ROLE_KEY` crashed with no diagnostic trail

**Root cause:** `getSupabaseAdmin()` throws explicitly when the service-role key is unset, but that call happened *before* the route's only `try/catch` block. The exception was uncaught, producing a bare Vercel 500 with zero outgoing requests logged and `extraction_status` left untouched at `pending` — indistinguishable from a still-in-progress extraction.

**Investigation summary:** Diagnosed entirely from the *shape* of a production error before any live access was available: a 500 with "no outgoing requests," fast execution duration, and `extraction_status` stuck at `pending` (never reaching `processing`) was traced by reading the route's actual code and finding the uncaught call, then reproduced locally by running the server with the env var deliberately unset — producing an identical 500 with an identical lack of outgoing calls.

**Fix implemented:** Wrapped `getSupabaseAdmin()` in its own `try/catch`, returning a clean, explicitly labeled `config`-coded 500 instead of an unhandled crash. Because the failure now happens *before* the paper is claimed (CAS-updated to `processing`), the paper is left safely retryable rather than stuck.

**Files modified:** `app/api/extract/route.js`.

**Regression testing performed:** Reproduced the exact original failure condition (server started with the env var unset) and confirmed the response changed from an unhandled crash to a clean `{"error":"Server configuration error."}` with the specific cause now visible in the server log. Also added, in the same pass, a client-side retry mechanism on the confirmation screen so a paper left in this recoverable `pending` state would be retried automatically once the underlying configuration was fixed.

---

## 5. Confirmation page required a manual refresh to show results

**Root cause:** The only automatic re-check on the confirmation page fired when `extraction_status === 'pending'`. The server's compare-and-swap claim flips status to `processing` within milliseconds of the original request — before the browser typically finishes navigating to the confirmation page — so that condition was almost never true in the normal flow. There was no actual polling loop, just one narrow, rarely-true one-shot check.

**Investigation summary:** Confirmed by reading the component's actual `useEffect` condition rather than guessing at "probably needs polling" — the exact logical gap (checking for `pending` when the real waiting state is `processing`) was identified directly in the code before any fix was written.

**Fix implemented:** Replaced the one-shot check with a genuine recurring poll (every ~3 seconds, capped at roughly 2 minutes) that continues until the status leaves `pending`/`processing`.

**Files modified:** `components/ConfirmationScreen.jsx`.

**Regression testing performed:** Simulated the exact real poll sequence (a first check returning `processing`, a later check returning `completed`) against the extracted state-update logic directly, confirming the UI would resolve automatically without requiring a page reload.

---

## 6. Researcher list showed incomplete data on first display, correct only after a refresh

**Root cause:** The narrow retry path introduced in bug #5's precursor called `setPaper(data)` on a fresh fetch but never re-derived the `researchers` state array from that same data — only the very first page load's `load()` function did that derivation. Any state update *after* the initial load left the researcher list frozen at whatever it was when the page first rendered (typically just the submitter, since extraction hadn't produced a result yet at that point).

**Investigation summary:** Traced by reading the component's state-management code line by line rather than assuming a server-side race condition, despite the server-side write-ordering initially looking like the more likely suspect. Confirmed by simulating the exact real poll sequence (processing → completed) against the actual derivation logic and observing the researcher list stay stale across the transition.

**Fix implemented:** Replaced the two separate, inconsistent code paths (`load()` and the narrow retry) with one function that derives the *entire* UI state — both `paper` and `researchers` — from every fetch result, called uniformly by the initial load and by every poll tick (see fix #5). A `researchersSeeded` ref locks the researcher list once a final extraction state is reached, so it can never be overwritten later if the submitter is mid-edit.

**Files modified:** `components/ConfirmationScreen.jsx`.

**Regression testing performed:** Simulated the exact real-world sequence (poll 1: `processing`, only the submitter in the researcher list; poll 2: `completed`, the full extracted list available) against the extracted logic directly, confirming the full list renders correctly on the very first completed render, not after an additional refresh.

---

## 7. Every extraction failure showed the same misleading message

**Root cause:** A single `catch` block in the API route spanned storage download, the Gemini call, JSON parsing, and every database write. Every failure, regardless of actual cause, set `extraction_status: 'failed'` with no further distinction, and the UI rendered one fixed message ("We couldn't read this document") for that status regardless of what had actually happened — including cases where the file had been read successfully and a later stage failed.

**Investigation summary:** A user report ("this message appears after extraction had already started, so the file was clearly read") was traced directly against the route's actual code structure, confirming there was genuinely only one failure branch, not a misfire of a more specific one.

**Fix implemented:** Introduced a typed `ExtractionError` class carrying a `.code` (`max_tokens`, `malformed_json`, `api_error`, `timeout`, `empty_response`, `config`, `encrypted_document`, `not_research`, `internal`), a `failure_code` column on `papers`, and a specific, accurate user-facing message per code instead of one generic string.

**Files modified:** `lib/extraction/errors.js` (new), `lib/ai/providers/gemini.js`, `lib/extraction/docx.js`, `app/api/extract/route.js`, `components/ConfirmationScreen.jsx`, plus a database migration adding `papers.failure_code` and updating `get_paper_for_confirmation` to return it.

**Regression testing performed:** Stubbed every documented Gemini failure shape (a 200 with `finishReason: MAX_TOKENS` and no content parts, a truncated-JSON 200, an HTTP 429, an HTTP 503, a network abort) and confirmed each produced its correct, distinct `.code`. Verified the migration against a realistic simulation of the live database with zero data loss.

---

## 8. An obvious, clearly-labeled supervisor was missed entirely

**Root cause:** The original prompt's guidance on the supervisor field was worded almost entirely as caution against inventing one ("often genuinely absent," "do not infer") with no positive guidance on what to look for. It also provided no document classification, so a missing supervisor on a thesis (where one should reliably exist) and a missing supervisor on a journal article (where one usually doesn't) were treated identically.

**Investigation summary:** A test case with the label "Supervised by: Prof. Hijjo Abdel-Wahid Hijjo Taha" clearly visible on the cover page still produced no extracted supervisor. Traced to the prompt's wording and its lack of document-type awareness, not to a genuine model failure to read the page (later investigation, see #15, would show the field actually was answered — just under the wrong key, an unrelated bug found much later).

**Fix implemented:** Rewrote the supervisor instruction to lead with explicit label patterns in English and Arabic ("Supervised by," "Under the Supervision of," "إشراف," "بإشراف," etc.) rather than leading with caution. Added document classification (`thesis`/`journal_article`/`conference_paper`/`research_report`/`not_research`) to the same prompt call, and made a missing supervisor a pass-2 trigger *only* when the document is classified as a thesis — a journal article's absent supervisor is usually correct, not a gap worth a second call.

**Files modified:** `lib/ai/schema.js`, `lib/extraction/orchestrator.js`, `lib/ai/providers/mock.js` (mock scenarios updated to cover thesis/article/not_research distinctly).

**Regression testing performed:** Verified via the mock provider that a thesis with a missing supervisor correctly triggers pass 2 and recovers it, while a journal article's missing supervisor correctly does *not* trigger a second call, and a non-research document correctly stops after one pass with no metadata mining attempted.

---

## 9. No retry on transient Gemini failures (503 / 429)

**Root cause:** The Gemini provider made exactly one attempt per call with no retry logic at all. A transient overload response from Google (confirmed in production logs: `"This model is currently experiencing high demand"`, HTTP 503) failed the entire extraction immediately.

**Investigation summary:** Confirmed via direct inspection of Vercel's aggregated runtime-error view, which surfaced Google's own error text, not an inferred cause. Explicitly ruled out other hypotheses (token exhaustion, preprocessing failure) that had been considered before this evidence was available.

**Fix implemented:** Exactly one bounded retry, triggered only by HTTP 503, HTTP 429, or a network-level failure (not aborts/timeouts). Not retried: `MAX_TOKENS`, malformed JSON, or timeouts — none of these have a principled reason to succeed differently on an identical retry.

**Files modified:** `lib/ai/providers/gemini.js`.

**Regression testing performed:** Stubbed five scenarios directly: a 503 followed by a success (confirmed exactly 2 fetch calls, correct recovered result), a 503 twice in a row (confirmed exactly 2 calls total, never a third — the "bounded" guarantee is a property of the code's control flow, not just a policy), and three deliberately non-retryable cases (HTTP 400, a timeout, `MAX_TOKENS`), each confirmed to make exactly one call.

---

## 10. A failed pass 2 discarded a fully successful pass 1

**Root cause:** `runExtraction()` had no `try/catch` around the pass-2 call. When pass 2 threw (for any reason, including the transient 503 from bug #9), the exception propagated all the way to the route's outer catch, and the entire extraction — including pass 1's already-complete, correct result — was marked `failed` and discarded.

**Investigation summary:** Identified by reading the orchestrator's control flow directly and confirming no `try/catch` existed around the pass-2 call — not inferred from symptoms alone, though the symptom (a paper that should have had partial data losing all of it on a transient failure) matched exactly.

**Fix implemented:** Wrapped the pass-2 call in its own `try/catch`. On failure, the function now returns pass 1's result completely unmerged and untouched, plus a `pass2Failure` object describing what went wrong. A new `extraction_status` value, `partial`, distinguishes this outcome from both `completed` (nothing lost) and `failed` (nothing usable at all). The confirmation screen treats `partial` as a normal, reviewable state — not a blocking error — with an honest note that not everything could be automatically verified.

**Files modified:** `lib/extraction/orchestrator.js`, `app/api/extract/route.js`, `components/ConfirmationScreen.jsx`, plus a database migration widening the `extraction_status` check constraint to include `partial` and updating `get_paper_for_confirmation` to return `failure_code`.

**Regression testing performed:** Constructed a mock provider whose pass 1 succeeds normally and whose pass 2 always throws a simulated 503, and confirmed the real pass-1 title, researchers, university, and abstract all survived completely intact in the final result — verified field by field, not just at the status-code level. Re-verified the two unaffected paths (full 2-pass success, single-pass-sufficient) still produced `extractionStatus: 'completed'` correctly after the change.

---

## 11. Encrypted DOCX files produced a misleading generic error

**Root cause:** A password-protected `.docx` file is not a ZIP archive at the container level at all — Word wraps it in the legacy OLE Compound File Binary format instead. `mammoth` failed on such a file with a generic "is this a zip file?" error, indistinguishable from genuine file corruption, and that generic error fell into the same catch-all described in bug #7.

**Investigation summary:** Diagnosed by directly testing what `mammoth` does when given a non-ZIP-parseable buffer, then researching the actual byte-level structure of Microsoft's encrypted Office format to find a specific, evidence-based detection method rather than pattern-matching on mammoth's error string (which is also produced by unrelated corruption).

**Fix implemented:** Checks the file's first 8 bytes for the OLE Compound File signature (`D0 CF 11 E0 A1 B1 1A E1`) before mammoth is ever invoked, throwing a specific `encrypted_document`-coded error with the message "This document is password-protected and cannot be processed automatically." Disclosed, accepted limitation: this signature also matches a legacy `.doc` file mislabeled with a `.docx` extension — both are equally unprocessable today, so treating them identically was judged acceptable rather than building a deeper, more complex distinguishing check.

**Files modified:** `lib/extraction/docx.js`, `app/api/extract/route.js` (added the specific failure message), `components/ConfirmationScreen.jsx` (added the specific UI branch).

**Regression testing performed:** Tested against three cases: a synthetic file carrying the exact OLE signature (correctly flagged as encrypted), a real, valid, unencrypted `.docx` (correctly *not* flagged), and genuine random-byte garbage (correctly falls through to the generic error rather than being mislabeled as encrypted).

---

## 12. Real thesis testing revealed inconsistent supervisor/researcher/faculty extraction (led to bugs 13–16)

This entry documents the investigation itself, since it produced four distinct downstream fixes (13–16), two of which corrected earlier incorrect hypotheses formed during this same investigation.

**Root cause (as initially, incorrectly hypothesized):** A synthetic test document with content placed in a header, a footer, and a genuine OOXML drawing text box (`w:txbxContent`) showed mammoth dropping all three location types. This led to an initial report concluding the production issue was headers/footers and text-boxes being silently dropped.

**Investigation summary (correction):** When the *actual* real production thesis file was directly unzipped and inspected, it contained **zero text boxes** (`w:txbxContent` occurred 0 times), and the supervisor and all six researchers were confirmed present, correctly, in `mammoth`'s plain-text output all along. The header hypothesis partially held (university, faculty, and degree genuinely existed only in `word/header2.xml`), but the text-box hypothesis was flatly wrong for this file. This was stated explicitly and corrected in the record rather than left standing.

**Further investigation (via direct Supabase queries against real `ai_generations` records, not synthetic data):** Traced the actual stored JSON for the four most recent real extraction runs (2 DOCX, 2 PDF) and found two entirely separate, previously unsuspected bugs: pass 2 was returning a truncated, unrequested answer for `researchers` that was overwriting pass 1's correct answer (bug #13), and the supervisor field was present and correct in Gemini's raw response in 12 out of 12 records inspected — under the key `supervisor`, never `supervisor_name` (bug #15). This directly disproved an intermediate hypothesis that the supervisor's absence was Gemini nondeterminism.

**Fix implemented:** See bugs 13–16 individually.

**Files modified:** See bugs 13–16 individually.

**Regression testing performed:** See bugs 13–16 individually. The meta-lesson recorded here: prefer real production data and real uploaded files over synthetic test cases whenever both are available, and treat any root-cause conclusion as provisional until checked against real data.

---

## 13. Pass 2 overwrote a correct 6-person researcher list with a truncated 3-person list

**Root cause:** `mergeResults()` accepted *any* key present in pass 2's response and merged it if its status rank was equal or better than pass 1's. Pass 2 was never actually asked about `researchers` (it was targeted at `title_ar, abstract_ar, supervisor_name, university, faculty, degree_type`), but volunteered an answer for it anyway — sourced from a text excerpt that only contained the tail of the researcher list — and that truncated, unrequested answer overwrote pass 1's complete, correct list of six names.

**Investigation summary:** Found by querying the real `result_data` for pass 1, pass 2, and the merged generation for a specific failing paper. Pass 1's six names and pass 2's three names were compared directly: pass 2's three were confirmed to be exactly the *last three* of pass 1's six, renumbered from 1 — proving the excerpt window, not model reasoning, was the proximate cause, and that the merge logic's acceptance of an unrequested field was what let the bad answer through.

**Fix implemented:** `mergeResults()` now takes the actual list of fields requested for pass 2 and discards any key pass 2 returns outside that list, regardless of what pass 2 volunteered.

**Files modified:** `lib/extraction/orchestrator.js` (the `mergeResults` signature and one call site).

**Regression testing performed:** Reconstructed the exact real production data (the true 6-name pass-1 list and the true 3-name pass-2 list from the actual failing paper) and confirmed the old code reproduced the bug (3 names survive) while the fixed code correctly preserved all 6, in the correct order. Separately confirmed the fix does not break legitimate behavior: a field pass 2 *was* asked about and correctly improved still merges in, and the existing protection against a field being downgraded (e.g., `ambiguous` → `not_found`) still holds.

---

## 14. DOCX pass-2 excerpt window too narrow for multi-line content

**Root cause:** The keyword-scan excerpt window around a matched marker was ±100/+400 characters. Against the real thesis file, the "Supervised by" marker sat at character offset 325; the resulting window (225–725) began *after* the researcher list (which spans offsets 140–320) had already started, so only its tail was ever visible to pass 2 — the second contributing mechanism behind bug #13, independent of the merge-filtering issue itself.

**Investigation summary:** Confirmed by computing the exact window bounds the real marker offset would produce and checking which known content fell inside versus outside that range, using the real file's actual character offsets rather than an assumed document layout.

**Fix implemented:** Widened the window to −300/+500 characters. Verified this specific choice against the real file: it now captures all six researchers and the supervisor's value together in one excerpt.

**Files modified:** `lib/extraction/keywordScan.js`.

**Regression testing performed:** Ran the widened window against the real thesis file's actual extracted text and confirmed all six researcher names and the supervisor's value now fall inside the same excerpt sent to pass 2. Noted as defense-in-depth alongside fix #13: the merge-filtering fix already prevents the *researchers* field specifically from ever being corrupted this way again, but a narrow window could still degrade a field pass 2 legitimately needs to answer (e.g., a long supervisor name or title that happens to sit near a window boundary).

---

## 15. Supervisor field returned under the wrong JSON key

**Root cause:** The prompt introduced every field with a prose section header (`TITLE:`, `RESEARCHERS:`, `YEAR:`, `SUPERVISOR:`, etc.) and relied on the model inferring the intended JSON key from that header word. For every field except one, the header word already matched the intended key exactly (`title`→`title`, `year`→`year`). The supervisor section was headed `SUPERVISOR:`, but the code expected the key `supervisor_name` — a mismatch never explicitly resolved anywhere in the prompt. The only field whose JSON shape was ever stated explicitly in the prompt was `researchers`.

**Investigation summary:** This bug was found only after an intermediate hypothesis (Gemini nondeterministically omitting the field) was directly tested against real data and disproven: querying `ai_generations.result_data ? 'supervisor_name'` across 12 real records (both file types, both passes) returned `false` in every single case, while `result_data ? 'supervisor'` returned `true` in every single case, with an identical, correct value each time. A field returned identically correct 12/12 times is not a nondeterminism problem — it's a naming problem. Once this was found, a systematic audit compared all 10 fields any code expects against the real, actual keys Gemini returns across the same real records: 9 of 10 matched exactly, and `supervisor_name`/`supervisor` was confirmed as the *only* mismatch, not one of several.

**Fix implemented:** Two changes, deliberately layered. First, the prompt's supervisor section now states the intended JSON key explicitly ("use the JSON key \"supervisor_name\" for this field"), addressing the root cause. Second, a normalization step was added at the single point every Gemini response passes through, renaming a `supervisor` key to `supervisor_name` if present — kept as a safety net, since an LLM's adherence to a stated key name on every future call isn't guaranteed, and the normalization costs nothing when the key is already correct. A third, smaller change addressed backward compatibility: records already stored in the database before this fix use the old key, so the confirmation screen also gained a read-side fallback to display them correctly without needing to re-extract.

**Files modified:** `lib/ai/schema.js`, `lib/ai/providers/gemini.js`, `components/ConfirmationScreen.jsx`.

**Regression testing performed:** Reconstructed the exact real production response shape (the literal JSON recorded in Supabase for a real failing paper) and confirmed the normalization correctly renamed the field. Separately confirmed the normalization is a true no-op when a response already uses the correct key — it does not alter or duplicate anything in that case.

---

## 16. University, faculty, and degree were unrecoverable for any DOCX

**Root cause:** `mammoth.extractRawText()` never reads header or footer XML parts under any circumstances — this is a scope limitation of the library, not a configuration option. In the real production thesis, university, faculty, and degree type existed *exclusively* inside `word/header2.xml` and were completely absent from mammoth's 114,872-character body-text output, with **zero warnings raised** — nothing in the existing pipeline had any signal that this content had been lost.

**Investigation summary:** Confirmed by directly unzipping the real thesis file's OOXML and inspecting each part: `word/header1.xml` had no text runs, `word/header2.xml` contained exactly one run of text — "Bachelor of Business Administration & FinanceSchool of Management StudiesUniversity of Khartoum" — and none of it appeared anywhere in mammoth's separately-computed output. This was evidence, not inference: the same three strings were searched for directly in both the raw header XML and the full mammoth output.

**Fix implemented:** Added direct reading of `word/header1.xml`, `word/header2.xml`, and `word/header3.xml` via `jszip` (already present as a transitive dependency of `mammoth`, now declared as a direct project dependency), extracting visible text with the same `<w:t>` run-matching approach used to establish the finding. The extracted header text is decoded for XML entities (a real, separately-caught bug: `&amp;` was initially being left un-decoded) and prepended to mammoth's body output, clearly labeled ("Document header: ..."), so the model can distinguish institutional header content from a running title repeated on every page rather than treating it as more body content. The whole header-reading step is wrapped so that any failure degrades to no header text rather than breaking an extraction that previously worked — this can only ever *add* information, never remove any.

**Files modified:** `lib/extraction/docx.js`, `package.json` (`jszip` added as an explicit dependency).

**Regression testing performed:** Ran directly against the real thesis file and confirmed university, faculty, and degree type are now present in the text sent to Gemini, while the title, all six researchers, and the supervisor (already correctly present) remained unaffected. Confirmed the XML-entity-decoding fix produces "Administration & Finance" rather than "Administration &amp; Finance". Tested graceful degradation against a garbage (non-ZIP) buffer — returns an empty string, never throws — and against a real, valid `.docx` fixture known to have no header at all, confirming no spurious "Document header:" prefix is added when there's nothing to add. A permanent regression script (`scripts/test-docx-extraction.js`) was added, runnable against any real `.docx` file, to catch a future regression of this specific behavior.

---

## 17. Any file with an Arabic (or otherwise non-ASCII) filename failed to upload, silently

**Root cause:** `components/SubmissionForm.jsx` built the Supabase Storage object key directly from the uploaded filename, replacing only whitespace: `` `${crypto.randomUUID()}-${file.name.replace(/\s+/g, '_')}` ``. Storage object keys accept only a conservative ASCII subset, so a file named in Arabic script — the common case for this platform's own users — produced an invalid key and the upload was rejected outright.

**Why it was invisible:** the upload is the *first* step of submission, before `submit_paper` runs. A rejection there means no storage object, no `papers` row, no `researchers` row, no `ai_generations` row — **nothing to query afterwards**. Every other bug in this file was diagnosable because it left a record; this one left none. The user-facing message compounded it by saying "Please check your connection and try again", sending the submitter to chase a network problem that did not exist.

**Investigation summary:** After the database was rebuilt on 2026-09-18, a test session submitted the same English thesis twice (once PDF, once DOCX) — both completed correctly — and an Arabic document, which "did not work". Direct queries confirmed the asymmetry precisely: `storage.objects` contained exactly two objects, both the English file; `papers` contained exactly two rows, both the English file; the only Arabic text anywhere in the database was the submitter's own name (`سام`), written into `researchers` through the RPC, proving Arabic text itself round-trips through Postgres without trouble. The failure was therefore upstream of the database entirely, isolating it to the upload call and its one user-controlled input: the object key.

**Confidence note:** the object-key rejection was not reproduced directly against the Storage API — the environment available at the time blocked outbound requests to `*.supabase.co`, so the decisive HTTP test could not be run. The evidence above narrows the failure to the upload step and the key is the only user-controlled part of it, but this is one step short of the direct proof preferred elsewhere in this file. Recorded as such deliberately.

**Fix implemented:** Added `buildFilePath()`, which keeps the random UUID, preserves the file extension (the only load-bearing part — `app/api/extract/route.js` selects the PDF or DOCX parser from it), and reduces the readable portion to `[a-zA-Z0-9._-]`, dropping it entirely when nothing survives. An Arabic filename now yields a clean `<uuid>.pdf`. Separately, the fallback upload error message no longer blames the connection.

**Files modified:** `components/SubmissionForm.jsx`.

**Regression testing performed:** Ran the sanitizer against nine real-shaped cases — Arabic names with and without spaces and hyphens, the project's own long English test filename, a numeric filename, accented Latin (`résumé étude.pdf`), URL-hostile characters (`report#1?v=2.pdf`), a degenerate `....pdf`, and an uppercase `.PDF` — and asserted every output matches a conservative key-safe character set. The extension survived in all nine; the uppercase extension is normalised to lowercase, which `detectFileType()` already expected. The long English filename is truncated to 80 characters of label, changing the stored key for such files but not their behaviour.

---

## 18. An Arabic year value stranded an entire extraction in `processing`

**Root cause:** `papers.year` is an `integer` column and is the only non-text field in `APPLIABLE_FIELDS` (`lib/extraction/applyResult.js`). Every other appliable field is `text` and accepts whatever the model reports verbatim. `buildPapersUpdate()` passed the model's raw value straight through, so a real Arabic thesis whose cover page reads `٢٠١٩م` produced `{ year: "٢٠١٩م", ... }`. Postgres rejected the whole UPDATE with `22P02` (invalid input syntax for type integer) — taking the correctly extracted Arabic title, abstract, university (`جامعة النيلين`) and degree (`الماجستير في الاقتصاد`) down with it. The paper never left `processing`.

**Investigation summary:** Paper `bb6db427` sat in `processing` while Vercel's runtime log showed the function returning **HTTP 200** in ~14 s — so the function completed; nothing was killed mid-flight. Two hypotheses were tested and disproven first: a client-disconnect race (refuted by the 200) and a missing `'partial'` value in the `papers_extraction_status_check` constraint (refuted by reading the live constraint, which includes it). The `ai_generations` row was present and complete, proving pass 1 had succeeded and the result had been recorded — so the only remaining step between a complete result and a stuck row was the `papers` UPDATE itself. Its stored `result_data` contained `year: "٢٠١٩م"`, the single value in that payload that cannot be cast to `integer`.

**Fix implemented:** `normalizeYear()` converts Arabic-Indic (`٠-٩`) and Eastern Arabic-Indic/Persian (`۰-۹`) digits to ASCII, then accepts a value only when exactly one distinct in-range 4-digit run is present, bounded to 1900–2100. Deliberately conservative in two ways. The range check is not optional: a Hijri year `١٤٤٥` converts to the perfectly valid integer 1445, which would otherwise be written silently as a Gregorian year. And a span like `١٩٩٥ – ٢٠١٧م` has no single correct answer, so it is omitted rather than guessed. When normalization fails, the field is **omitted from the update, never nulled and never guessed** — the raw value is still recorded in `ai_generations` and still shown on the confirmation screen for the submitter to correct by hand. One unusable year can no longer take the other eight fields with it.

**Files modified:** `lib/extraction/applyResult.js`, `scripts/test-year-normalization.js` (new).

**Regression testing performed:** `node scripts/test-year-normalization.js` — 26 checks, all passing, exit 0; usable as a CI step. Covers the real production value `٢٠١٩م → 2019`, Persian digits, plain ASCII, an already-integer value, an embedded year in a sentence; and on the omission side Hijri in both scripts, spans in both scripts, `n.d.`, empty string, Arabic text with no digits, two digits, a non-integer number, and both range boundaries. Two further assertions run the real stranded thesis's actual payload through `buildPapersUpdate()` and prove the Arabic title, university and degree all survive alongside the coerced year, that `not_found` and `ambiguous` fields stay out of the update, and that an unusable year yields no `year` key at all.

---

## 19. Every `papers` update in the extract route discarded its error

**Root cause:** `app/api/extract/route.js` wrote to `papers` at four points and destructured none of the returned errors. Supabase's JS client does not throw on a failed statement — it resolves with `{ data, error }` — so a rejected UPDATE was indistinguishable from a successful one. The route then continued and returned **HTTP 200**. This is what made #18 so expensive to diagnose: every observable signal (200 response, complete `ai_generations` row, no log line) said the extraction had succeeded, while the row itself said `processing`. The CAS claim guard had a second form of the same fault — it read only `data` and treated any falsy result as "another request already claimed this paper", so a genuine query error was reported as a benign race.

**Fix implemented:** `assertPapersWrite(error, stage)` raises an `Error` carrying `code = 'internal'` and `diagnostics = { stage, pgCode, details, hint }`, applied at the three success-path writes (`unsupported_file_type`, `not_research`, `apply_result`). The failure is then handled by the route's existing error path, so the submitter sees the established generic message and the real cause reaches the logs and `papers.failure_code` — existing failure handling is preserved, not replaced. The CAS claim now destructures its error separately and returns a 500 logged as `stage: 'claim_failed'` rather than misreporting it as a race. One deliberate exception: the write inside the catch block logs `stage: 'failure_status_write_failed'` and does **not** throw — a double fault escaping the catch would return an empty 500 and lose the original error, which is strictly worse than a logged secondary failure.

**Files modified:** `app/api/extract/route.js`.

**Regression testing performed:** Audited all seven `papers` accesses in the route and confirmed every one now destructures an error. Simulated the #18 control flow and confirmed a write error now surfaces as `code = 'internal'`, `pgCode = '22P02'`, `stage = 'apply_result'`, HTTP 500, with the user-facing message unchanged. `npx eslint` clean; `npm run build` compiles. Scope was held deliberately: adding `failure_code` to the `not_research` path is a real inconsistency but is tracked separately as open bug N, not folded in here.

---

## 20. The confirmation screen never showed the Arabic title, so a submitter typed a sentence into the English one

**Root cause:** Two independent faults in `components/ConfirmationScreen.jsx`, compounding.

First, its local `METADATA_FIELDS` list — which drives both what is rendered and what is sent back as corrections — contained `title` and `abstract` but **not** `title_ar` or `abstract_ar`. Every other layer already handled them: `lib/ai/schema.js` asks for them, `buildPapersUpdate()` applies them, `papers` has the columns, `get_paper_for_confirmation` returns them in its allowlist, and `confirm_researcher_metadata` accepts them as corrections. The confirmation screen was the only place they were missing, so an Arabic title was extracted correctly, stored correctly, returned correctly by the RPC — and then never rendered.

Second, `handleConfirm()` hard-required an English title: `if (!values.title?.trim())` blocked submission entirely. For a paper written only in Arabic there is no English title to give, so the form could not be completed honestly.

Together these produced the failure exactly: the submitter saw an empty **Title** field labelled *"Not found in your paper. Tap to add it."*, could not proceed without filling it, and could not see that their real title had in fact been found.

**Investigation summary:** The reported symptom was "title extraction failed on my Arabic paper". The stored data said otherwise. For paper `d5c7b51e`, all three `ai_generations` rows (pass 1, pass 2, merged) recorded `title: {"status":"not_found"}` and `title_ar: {"status":"found", value: "دور التمويل الزراعي في التنمية الاقتصادية في السودان (دراسة حالة ولاية الخرطوم (١٩٩٥ – ٢٠١٧م))", source: "title page"}`. `papers.title_ar` held that value. So extraction did not fail — it was correct, and correct to report no English title, because the document has none.

`papers.title` held the literal string `"No title appeared for this research"`, quote marks included. That string appears nowhere in the codebase and in no `result_data`, and `buildPapersUpdate()` cannot write a field whose status is `not_found`. The only remaining writer was `confirm_researcher_metadata`, and `metadata_confirmed_at` was set to 19 minutes after the paper was created — a human typing into the box the form would not let them leave empty.

**Fix implemented:** `title_ar` and `abstract_ar` added to `METADATA_FIELDS` with bilingual labels and per-field `dir="rtl"` (an Arabic title in a left-to-right form renders its punctuation in the wrong place otherwise). The confirm guard now requires a title **in either language**. A new `LANGUAGE_PAIRS` concept marks `title`/`title_ar` and `abstract`/`abstract_ar` as "at least one of": when one side is found, a plain absence on the other is no longer flagged, no longer counted in the "N fields need your attention" banner, and shows *"Your paper doesn't appear to have this in this language. You can leave it empty."* instead of an instruction to add it. That suppression is deliberately narrow — it applies only to `not_found`, so an `ambiguous` or `conflicting` entry keeps its flag and its candidate chips, because those mean the model really did find competing values a human still has to resolve.

Two related corrections went in alongside. The client-side year check was `^\d{4}$`, which rejects the Arabic-Indic digits this platform's own documents use; it now runs the same `normalizeYear()` the server does. And `confirm_researcher_metadata` only accepts a year matching `^[0-9]{4}$`, silently keeping the old value otherwise, so the year is now normalized to ASCII before being sent rather than being dropped without an error.

**Files modified:** `components/ConfirmationScreen.jsx`.

**Regression testing performed:** `npx eslint` clean, `npm run build` compiles. The language-pair rule is covered by `scripts/test-language-pairs.js` (11 checks) at the orchestrator level, including the real payload from `d5c7b51e`, the mirrored English-only case, a title missing in both languages (still chased), and the ambiguous/conflicting boundaries. No database change was required — every RPC already supported these fields, which is what made this a frontend-only fix.

**Not fixed here:** `papers.title` on `d5c7b51e` still holds the typed sentence. It is the submitter's own confirmed data, so it is theirs to correct on the confirmation screen, which now shows the Arabic title beside it.

---

## 21. Pass 2 spent a paid provider call re-confirming an absence that was already correct

**Root cause:** `getMissingCriticalFields()` in `lib/extraction/orchestrator.js` treated `title` as unconditionally critical: a `not_found` there always triggered a second Gemini call. For a paper written only in Arabic, `title` is *correctly* `not_found` and always will be, so the second call could only ever return `not_found` again.

**Investigation summary:** Visible directly in the stored record for paper `d5c7b51e`, whose pass-2 row is annotated `"Pass 2, targeted at: title"` and returned `title: {"status":"not_found"}` — the same answer pass 1 gave, from a document that does not contain an English title. Pass 1 had already found `title_ar`, `abstract`, `abstract_ar`, `university`, `faculty`, `degree_type`, `year` and `researchers`, so nothing else needed chasing; the entire second call existed to re-confirm one absence.

**Fix implemented:** `isMissingConsideringLanguage()` treats `title`/`title_ar` and `abstract`/`abstract_ar` as one requirement each: a field counts as missing only when **neither** language has it. Both `getMissingCriticalFields()` (which decides whether pass 2 runs at all) and `getAllMissingFields()` (which decides what it is asked about) now use it. On this project's budget a call avoided is the point, not a micro-optimisation. The two-call ceiling is unchanged — this only ever reduces calls, never adds one.

**Files modified:** `lib/extraction/orchestrator.js`.

**Regression testing performed:** `scripts/test-language-pairs.js`, 11 checks, all passing, exit 0. Asserts the real Arabic thesis now triggers no second call; the mirrored English-only case likewise; a title absent in both languages is still chased; `year`, `researchers` and `supervisor_name` (no language partner) are unaffected; an `ambiguous` partner does **not** satisfy the pair, while a `conflicting` one does; and `not_research` still short-circuits before any of this runs.

---

## 22. The submission form accepted any WhatsApp number and reported the rejection only after upload

**Root cause:** `components/SubmissionForm.jsx` rendered the WhatsApp field as a bare `<input type="tel">` with a `+249...` placeholder and no validation of any kind. The only check anywhere was the SQL pattern `^[+0-9][0-9+\-\s()]{5,24}$` inside `submit_paper`, which is a shape check rather than a validity check — it accepts `00000000000` — and, critically, it runs **after** the file has already been uploaded to storage. A number it rejected therefore cost a full upload first, then surfaced as a late form-level error, and the successful upload had to be rolled back.

The number was also stored exactly as typed, so `0912345678`, `+249912345678` and `09 123 456 78` were three different strings for one phone number, with nothing able to tell they matched.

**Fix implemented:** A shared `lib/validation/phone.js` built on `libphonenumber-js/min`, which carries Google's own per-country numbering metadata — phone validity is genuinely not a regex problem, and Sudan's own mobile prefixes have been renumbered. It exposes one entry point returning `empty` / `valid` / `invalid`, where `empty` is valid because the field is optional. Numbers are normalized to E.164 for storage, so one phone number now has one representation.

The form validates live from the first keystroke, marks the field with `aria-invalid`, shows the message directly beneath the field it refers to, and keeps the submit button disabled until every required field is genuinely valid. Because a disabled button with no explanation is a dead end, a line underneath lists exactly what is still outstanding. Errors are only *displayed* once a field has been touched, so the form does not open covered in red, while validity itself is computed immediately — which is what keeps the button honest.

Distinct failure types get distinct messages, per `BUG_HISTORY.md` #7: "too short" and "not valid for the country selected" send someone to different fixes.

**Database compatibility:** no migration. An E.164 string always satisfies the existing SQL check — it starts with `+` and its 7–15 remaining digits sit inside the 5–24 window — and numbers already stored in the looser format keep validating. This is asserted by the test suite rather than assumed, and `lib/validation/phone.js` carries a warning not to tighten the SQL pattern without first migrating the existing rows.

**Files modified:** `components/SubmissionForm.jsx`, `components/PhoneField.jsx` (new), `components/PhoneField.module.css` (new), `lib/validation/phone.js` (new), `package.json`.

**Regression testing performed:** `scripts/test-phone-validation.js`, 23 checks, all passing, exit 0. Covers the optional-empty cases; Sudanese numbers with and without the national leading zero and with human-typed spaces; an already-E.164 value; numbers whose own `+` prefix must override the selected country; five rejection cases including the shape-valid-but-impossible `00000000000` that the SQL check alone lets through; that the two rejection messages differ; the full country list; round-tripping a stored number back to its country; and that as-you-type formatting never drops a digit. One check exists purely to guard the migration-free claim: every number the module is willing to store is run against the live `submit_paper` pattern.

---

## 23. Country code was a free-text placeholder rather than a picker

**Root cause:** there was no country control at all — just the hint `+249...` in the placeholder attribute, leaving the submitter to know and type their own international dialling code.

**Fix implemented:** `components/PhoneField.jsx`, a native `<select>` of all 245 countries with flag, English name and dial code, paired with a national-format number input.

**Library recommendation and why:** the validation metadata comes from **`libphonenumber-js`** (the `/min` build, its smallest), which is the right dependency because it is pure data — no UI, no CSS, no runtime service — and correct phone validation genuinely cannot be hand-rolled. The **dropdown itself is deliberately not** a packaged component. `react-phone-number-input` and its peers ship their own stylesheet, their own flag sprite or SVG set, and their own focus and keyboard behaviour to override, all of which this bilingual form would then have to fight for visual consistency. A native `<select>` is already accessible, keyboard-navigable, and on a phone opens the OS picker, which is better than any custom listbox. Flags are regional-indicator emoji derived from the ISO code, so there is no image asset to ship or fail to load. Measured cost: the largest client chunk is ~70 KB gzipped. This tradeoff is recorded explicitly because `CLAUDE.md` requires dependency weight to be a deliberate decision.

**A hazard deliberately avoided:** formatting the number as the person types inserts and removes spaces while the caret sits mid-string, which makes backspace jump in a controlled React input unless the caret is restored by hand. Since this change could not be exercised in a real browser from the build environment, formatting is applied on blur instead, where caret position does not matter. Validation remains live on every keystroke, which is the part the person actually needs.

**Files modified:** `components/PhoneField.jsx` (new), `components/PhoneField.module.css` (new), `components/SubmissionForm.jsx`.

**Regression testing performed:** covered by `scripts/test-phone-validation.js` as above — the country list is asserted to be complete, sorted, duplicate-free, and to resolve both English and Arabic names, with Sudan's dial code checked explicitly.

---

## 24. A validation message rendered its own escape sequence as literal text

**Root cause:** the inline email error in `components/SubmissionForm.jsx` was written as JSX *text*:

```jsx
<p ...>That doesn’t look like an email address. Please check it.</p>
```

`’` is a JavaScript **string** escape. JSX text is not a string literal, so nothing interprets it — React rendered the six characters `’` verbatim, and the submitter saw *"That doesn’t look like an email address."*

Every other message in the file is correct, because every other one sits inside a real string literal (`setErrorMsg('...isn’t supported...')`), where the escape does apply. The distinction is invisible on a quick read, which is exactly why this one slipped through: the same characters are right in one position and wrong in the other. It was introduced in this session, alongside the field itself.

**Investigation summary:** reported from a screenshot of the live form. A repo-wide grep for `’` found nine occurrences; eight are inside string literals and render correctly, and exactly one — the JSX text node — does not. Confirmed by position rather than by reading each message.

**Fix implemented:** the JSX text node now uses the HTML entity `&rsquo;`, which is the correct mechanism in that position and matches what the rest of the file's JSX already does (`We weren&rsquo;t certain about this one`). The eight string-literal uses were deliberately left alone: they are correct, and rewriting them would be churn.

**Files modified:** `components/SubmissionForm.jsx`.

**Regression testing performed:** re-ran the grep and confirmed the only remaining `’` occurrences are inside string literals, including one inside a JSX `{...}` expression (`{extracting ? '...' : 'Here’s what we found'}`), which is a string literal and renders correctly. `npx eslint` clean, `npm run build` compiles.

---

## 25. The confirmation screen showed two title boxes for a paper written in one language

**Root cause:** fix #20 added `title_ar` and `abstract_ar` to the confirmation screen, which was necessary — they had never been rendered at all — but it rendered them *unconditionally*. So a paper written only in Arabic now showed its Arabic title **and** an empty English title box, and the same for the abstract. That is an improvement on hiding the Arabic title entirely, but it still puts an empty box in front of a submitter for a language their document is not written in, which is the precondition for the original failure: a real submitter answered exactly such a box by typing a sentence into it.

**Fix implemented:** the pair now renders only the languages the paper actually has. One box for a monolingual paper; both for a genuinely bilingual one, so real data is never hidden; and for a pair empty on both sides, exactly one fallback box rather than two.

Because that fallback box has no language attached, what gets typed into it is routed to the matching column by script at confirm time — Arabic text lands in `title_ar`, Latin text in `title` — so the submitter is never asked to pick a language themselves. The routing is deliberately narrow: it acts only when the partner column is empty, because if both boxes were on screen the submitter's own choice of box is authoritative and must not be second-guessed.

A field is also only labelled by language ("Title (English)") when both halves are visible. A lone box labelled that way would invite the same *"so where does my Arabic title go?"* confusion this exists to remove; a lone box is just "Title / العنوان".

The logic was extracted to `lib/fields/languagePairs.js` rather than left inside the component, because it decides whether a submitter is shown a box their document has no content for — the exact thing that went wrong in #20 — and that deserves to be tested directly rather than trusted by reading it.

**Files modified:** `components/ConfirmationScreen.jsx`, `lib/fields/languagePairs.js` (new).

**Regression testing performed:** `scripts/test-field-pairs.js`, 19 checks, all passing, exit 0. Covers the Arabic-only case (one box, the Arabic one), the mirrored English-only case, a bilingual paper (both boxes — real data is never hidden), a pair empty on both sides (exactly one box, never two), whitespace not counting as content, missing keys not throwing, both labelling rules, script detection including Arabic-Indic digits, routing in both directions, routing refusing to overwrite a partner that already has content, and that routing does not mutate its input. One check restates the original failure directly: an Arabic-only paper must render no empty English title box.

---

## 26. The country picker was a native `<select>`, which cannot be searched or styled

**Root cause:** `<option>` content is rendered by the operating system, not the page. 245 countries each rendered as one unbroken line of "flag name +code", with the dial code pushed to wherever the longest country name left room, and no way to find a country except holding down a letter key.

**Fix implemented:** `components/CountrySelect.jsx`, a combobox following the WAI-ARIA pattern rather than an invented one: a compact trigger showing just the flag and dial code (the country name is already implied by the flag, and repeated in the list), and a popup with a search field that matches on country name in English or Arabic, ISO code, or dial code with or without the leading `+` — so "249", "+249", "sd" and "sud" all find Sudan.

Keyboard support is the part that makes it usable rather than decorative: Arrow keys move the active option, Enter selects, Escape closes, Home/End jump, and focus stays in the search input throughout while `aria-activedescendant` tells a screen reader which option is active. The list is a fixed row height with the flag in a fixed-width box, so every row aligns on one edge regardless of how wide a platform draws each emoji.

Two details that are bugs if missed: options commit on `mousedown` rather than `click`, because `click` fires after `blur` and the popup would close before the choice registered; and the popup closes on `pointerdown` outside rather than `click`, so it is gone before a click on something behind it lands. `Enter` calls `preventDefault()` so choosing a country never submits the surrounding form.

The popup animation is disabled under `prefers-reduced-motion`.

**Files modified:** `components/CountrySelect.jsx` (new), `components/CountrySelect.module.css` (new), `components/PhoneField.jsx`, `components/PhoneField.module.css`.

**Regression testing performed:** `npx eslint` clean, `npm run build` compiles. The country data this renders is covered by `scripts/test-phone-validation.js` (complete, sorted, duplicate-free, both name languages resolving). **The interaction itself is not covered by an automated test** — there is no DOM test harness in this project and the build environment cannot reach the deployed app, so the keyboard and pointer behaviour above is reasoned from the ARIA pattern and not empirically verified. Recorded as a real gap rather than glossed over; it is the first thing to exercise by hand on the deployed preview.

---

## 27. An extraction that lost its function was stuck in `processing` forever

**Root cause:** the claim in `app/api/extract/route.js` is a compare-and-swap that only ever matched `extraction_status = 'pending'`. That is right for preventing a double extraction, but it also meant a paper that reached `processing` and then lost its function — a timeout, an instance killed mid-run, a deploy landing mid-extraction — could never be claimed by anything again. The confirmation page's own "Try again" could not rescue it either, because that called the same route and hit the same guard; it only reloaded the page and polled for another two minutes.

**Why this is the amplifier behind the "six minutes" report.** The server has never taken more than 32 seconds. But a stuck paper produced this loop: poll for ~2 minutes → "This is taking longer than usual" → "Try again" → full page reload → poll for another ~2 minutes → and so on. Two or three rounds of that is a five-to-six-minute wait on top of an extraction that either finished in seconds or was never going to finish at all. This was the open bug **J**, proven materially harmful on paper `bb6db427`, which had to be repaired by hand with a direct database write.

**Fix implemented:** `papers.extraction_started_at` records when the route claimed a paper (migration `0008`). A paper in `processing` whose claim is older than `STALE_CLAIM_MS` may be claimed again.

Two constraints shaped this and both matter:

- **`STALE_CLAIM_MS` (360s) must stay strictly greater than `maxDuration` (300s).** At 300s the platform has already killed the original invocation, so reclaiming at 360s cannot produce two live extractions of the same paper. If that ordering were ever reversed, a retry could start a second extraction while the first was still running, doubling the provider calls and breaking the two-call ceiling this project enforces everywhere else. There is a test asserting the inequality directly against the source, because the invariant is not obvious from either constant alone.
- **A new column rather than reusing `created_at`.** The two are usually seconds apart but not always — `bb6db427` was claimed a day after submission. Judging staleness from `created_at` would let a second request reclaim a paper whose first extraction was still legitimately running. The claim time is the only honest basis for "has this been running too long".

The reclaim is itself an exact compare-and-swap: it matches on the prior status **and** on the exact `extraction_started_at` it read, so two requests racing to reclaim the same abandoned paper cannot both win. Rows claimed before the column existed carry null, and fall back to `created_at` — safe, because such a row can only have been claimed by code that is no longer deployed. Reclaims are logged as `stale_claim_reclaimed`: if that line starts appearing often it means extractions are dying, not that the recovery is working well.

"Try again" now asks the server to restart extraction and resumes polling in place, instead of reloading the page.

**Files modified:** `app/api/extract/route.js`, `components/ConfirmationScreen.jsx`, `supabase/migrations/0008_extraction_claim_timestamp.sql` (new), `supabase/schema.sql`, `supabase/migrations/README.md`.

**Migration applied to production** on 2026-09-20: additive, nullable, no default, no backfill, no rewrite of existing rows. Reversible with `alter table papers drop column extraction_started_at`.

**Regression testing performed:** `scripts/test-timing.js` asserts the `STALE_CLAIM_MS > maxDuration` inequality, that the reclaim still matches on both the prior status and the exact claim timestamp, and that every claim records its own time. Column type and nullability verified against the live database after the migration. `npx eslint` clean, `npm run build` compiles. **The reclaim path itself has not been exercised end to end in production** — doing so requires an extraction to actually die, which cannot be staged from here. Recorded as a real gap.

---

## 28. Nothing measured the part of the wait the submitter actually experiences

**Root cause:** every timestamp the system had was server-side, and the earliest of them — `papers.created_at` — is written by `submit_paper`, which runs **after** the file has finished uploading. So the two stages most likely to be slow for this platform's own users, on Sudanese connections, were invisible: the click itself, and pushing a multi-megabyte PDF up. "The logs say 11 seconds" was being compared against a wall-clock experience that included stages the system had never observed.

Measured server-side times, from real production rows (`papers.created_at` → first `ai_generations` row, all ten submissions to date): 5.2s, 8.8s, 13.1s, 14.2s, 15.2s, 16.1s, 17.1s, 23.4s, 23.8s, 32.0s. Median ~16s. Nothing anywhere near six minutes. The gap was never in the extraction.

**Fix implemented:** `lib/timing.js` marks eight stages in the browser — `submit_clicked`, `upload_complete`, `paper_created`, `extract_triggered`, `confirm_page_mounted`, `first_poll_response`, `extraction_observed`, `fields_visible` — and posts the per-stage durations to `/api/timing`, which writes them to the function log so client-observed and server-observed time finally appear in the same place.

Details that are bugs if missed: the marks cross a navigation (`/submit` → `/confirm/[token]`), so they live in `sessionStorage` keyed by the confirmation token, with the pre-token marks held in memory and adopted once `submit_paper` returns one. Safari in private mode *throws* on `sessionStorage` access rather than returning null, so every read and write is guarded — losing a measurement must never break a submission. The report uses `keepalive`, since it fires exactly when someone might navigate away. The token is truncated to 8 characters before it can reach a log, and truncated again server-side because a client is not a trustworthy place to enforce that. A stage never reached is reported as `missing` rather than as a zero duration, because a zero reads as "instant" when it means "never happened". `/api/timing` stores nothing and takes no credential; its entire job is to turn a measurement into a log line.

**Three real delays were found and removed while instrumenting:**

1. **The extraction trigger could be cancelled by its own navigation.** `SubmissionForm` fires `fetch('/api/extract')` without awaiting it and immediately navigates. Without `keepalive`, the browser is entitled to cancel that request as the page unloads — so extraction would not start until the confirmation page's safety net fired seconds later. Now `keepalive: true`.
2. **Two `/api/extract` invocations raced on every single submission.** The form fired one; the confirmation page fired another immediately at poll attempt 0. Only one could ever win the CAS. The safety net is now delayed by 2.5s and re-checks `pending` at fire time, so it only fires when the form's call genuinely did not land.
3. **A flat 2500 ms poll added up to 2.5s of pure lag to every submission**, waiting on an answer already sitting in the database. Polling now backs off — 600 ms for the first 6s, 1.2s to ~30s, then 3s — which covers the entire measured distribution tightly while keeping the same overall ~2 minute budget and *fewer* total requests on a metered plan.

**Files modified:** `lib/timing.js` (new), `app/api/timing/route.js` (new), `components/SubmissionForm.jsx`, `components/ConfirmationScreen.jsx`.

**Regression testing performed:** `scripts/test-timing.js`, 10 checks, all passing, exit 0. Covers the no-storage path (the same path private mode takes), token truncation, durations being taken between consecutive reached stages, unreached stages appearing as `missing` rather than zero, the file size riding along with the upload mark, fewer-than-two-marks yielding no summary at all (run in a clean subprocess, since the module holds pre-token marks in memory), and the stage ordering that puts the upload before the paper row. `npx eslint` clean, `npm run build` compiles, `/api/timing` present in the route manifest.

---

## 29. The 429 retry ignored the delay the server stated, and spent quota proving it

**Root cause:** `lib/ai/providers/gemini.js` treated 503 and 429 as one class (`RETRYABLE_STATUSES = [503, 429]`) and retried both after a fixed `RETRY_DELAY_MS = 1500`. It never read `response.headers`, so `Retry-After` was discarded, and it truncated the error body to 500 characters for logging without parsing it first, so `RetryInfo.retryDelay` was thrown away before anything could use it.

Those two statuses are not the same failure. A 503 means Google is overloaded: the failed call consumed nothing, and a quick retry is free. A 429 means quota is exhausted: a retry that arrives too early **fails and spends more of the quota that was just exhausted**.

**Investigation summary:** on 2026-09-19 a 429 said *"Please retry in 12.577097057s"* and the code retried after 1500 ms — roughly an eighth of the stated wait. The retry produced a second 429 stating *"retry in 10.830900339s"*. The 1.746 s difference between those two figures is the evidence: the window was rolling, and the retry landed inside it. It could not have succeeded.

**Fix implemented:** the policy moved to `lib/ai/retryPolicy.js`, separate from the transport so it can be tested against the error bodies Google actually returns.

- **503** → a short 2 s backoff with ±15 % jitter, so simultaneous submissions don't come back in lockstep.
- **429 on pass 1** → wait the server's stated delay, read from `Retry-After`, then `RetryInfo.retryDelay`, then the message text (which is where the real production 429 carried it). The body is now parsed **before** truncation.
- **429 on pass 2** → do not retry at all. Pass 1's result is already in hand and the run degrades to `partial` (`BUG_HISTORY.md` #10); spending more of an exhausted quota, and up to 30 s of the person's time, to improve an already-usable outcome is the wrong trade.
- **429 with no stated delay** → do not retry. Retrying blind against a quota limit is the exact mistake this exists to stop.
- **A stated delay above 30 s** → do not retry. An exhausted *daily* quota returns a delay measured in hours; honouring it would hold a serverless function open until the platform kills it, turning a clean failure into a stuck paper.

**A bug in the fix, caught by its own test.** The quota wait was initially jittered symmetrically, which on a 12.577 s stated delay produced a 12.029 s wait — back inside the very window the fix exists to clear. Jitter on a server-stated delay is now upward-only. A test draws 1000 times and asserts the wait always exceeds the stated delay.

**Cost and latency.** The retry budget is unchanged at one per pass, so the worst case is still 2 extraction calls and at most 2 HTTP attempts each. A pass-1 429 now costs up to ~15 s of added latency instead of a guaranteed-useless 1.5 s; a pass-2 429 costs *less* than before, since it no longer retries at all. `.retryable` was removed from `ExtractionError` — a boolean cannot carry a decision that depends on status, pass, and a server-stated delay.

**Files modified:** `lib/ai/retryPolicy.js` (new), `lib/ai/providers/gemini.js`, `lib/extraction/errors.js`.

**Regression testing performed:** `scripts/test-retry-policy.js`, 33 checks, all passing, exit 0. Built on the literal production 429 body. Covers all three delay sources and their precedence, an HTTP-date `Retry-After`, malformed and absent delays, every non-retryable status, the pass-1/pass-2 asymmetry, the 30 s cap, the one-retry budget, and the upward-jitter invariant. **Not verified in production:** reproducing a 429 on demand would mean deliberately exhausting the quota, which costs real money and real availability. The behaviour is proven against the recorded error shape, not against a live 429.

---

## 30. Preview deployments write to the production database, and it has already happened

**Root cause:** every environment variable on the Vercel project is scoped to **both** `production` and `preview`. Verified directly against the Vercel API on 2026-09-20: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `AI_PROVIDER`, and the four `GEMINI_*` tuning vars all carry `target: ["production", "preview"]`. There is one Supabase project and one Gemini key, so a preview build of any branch talks to the real database — with the service-role credential, which bypasses RLS entirely — and spends the real AI quota.

This was previously recorded as bug **P**, an accepted tradeoff. It is not a theoretical tradeoff.

**Proof that it has already occurred.** Two papers in the production `papers` table were written by preview deployments running unmerged code:

| paper | created | preview deployment | deployed at | passes |
|---|---|---|---|---|
| `0906ebe0` | 00:55:55Z | `4c47e352` | 00:40:20Z | 1 |
| `f8676a50` | 01:15:26Z | `e7797321` | 01:11:11Z | 1 |

Both are Arabic-only theses where `title` is `not_found` and `title_ar` is `found`. Production code (`83a56e59`) treats a missing English title as a critical gap and runs a second Gemini call; these ran **one**. One pass on that input is the behaviour of the unmerged language-pair fix (`BUG_HISTORY.md` #21) and of nothing else. Each was submitted minutes after the corresponding preview went live.

**Severity:** high for the credential exposure (any branch build holds a key that bypasses every RLS policy), medium for the data and quota effects today, given a single-maintainer repository with no outside contributors. The blast radius grows the moment anyone else can open a pull request.

**Fix implemented:** `lib/env.js` reads `VERCEL_ENV`, and `app/api/extract/route.js` refuses to run on a preview deployment before it touches the database or the provider, returning 503 with a specific reason and logging `extraction_blocked`. An explicit `ALLOW_PREVIEW_EXTRACTION=true` overrides it per deployment for the times that is genuinely wanted.

This is deliberately **not** a blanket block on database access. The submission form must still work on a preview for a preview to be worth having, and a submitted row is visible and attributable. What it stops is the expensive, mutating, hard-to-notice half: AI calls and the writes that follow them.

**What this does NOT fix, and why it needs a decision.** The service-role key is still present in the preview environment; any code on any branch could use it directly. Closing that means removing `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` from the preview target in Vercel, which would break preview extraction entirely even with the override, and/or creating a second Supabase project for preview (the free tier allows two). Both change the project owner's workflow, so both are recorded as recommendations rather than applied unilaterally.

**Files modified:** `lib/env.js` (new), `app/api/extract/route.js`.

**Regression testing performed:** `scripts/test-timing.js` asserts the guard exists and runs *before* the claim, not after. `npx eslint` clean, `npm run build` compiles. The block itself has not been exercised on a live preview deployment.

---

## 31. A run that extracted nothing at all was recorded as `completed`

**Root cause:** `extraction_status` answers "did the pipeline finish", not "did it find anything". Those are different questions and only the first was ever recorded, so a run that returned `not_found` for every single field was stored identically to one that found everything.

**Investigation summary:** paper `bdc6d112` was classified `research_report`, ran **two** passes over 21.3 s, and returned `not_found` for title, title_ar, abstract, abstract_ar, year, supervisor, university, faculty, degree and researchers — every field. It is stored as `completed`. Separately, paper `6e0d9728`'s pass-1 row contains parseable JSON with **none** of the expected keys present at all, and the pipeline carried on silently and relied on pass 2 to supply them.

**Fix implemented:** `extractionYield()` in the orchestrator counts how many fields a run actually resolved. The count is written into the merged generation's notes (`Fields found: 3/10.`) and a zero-yield run on a research document — `not_research` correctly yields nothing and is excluded — emits a `extraction_zero_yield` warning. Deliberately observability only: no status value changes, no UI changes, no behaviour changes. It makes "how often does extraction return nothing useful" answerable, which it previously was not.

**Higher-risk option, not taken:** a distinct `extraction_status` value for a zero-yield run would be more honest but touches the status CHECK constraint, both RPCs, and the confirmation UI's branching. Recorded in `CURRENT_STATUS.md` as a recommendation.

**Files modified:** `lib/extraction/orchestrator.js`, `app/api/extract/route.js`.

**Regression testing performed:** `npx eslint` clean, `npm run build` compiles. The yield figure will appear on the next real extraction; it has not yet been observed in production.

---

## 32. A stuck paper had no automatic recovery, only a button nobody might press

**Root cause:** the reclaim added in #27 works, but nothing calls it on its own. The confirmation page's safety-net trigger fires only when the paper is `pending`; a paper stuck in `processing` got no automatic re-trigger at all. Recovery depended entirely on a human noticing the page had stalled and pressing "Try again" — and if they closed the tab, the paper stayed stuck forever.

**Fix implemented:** once polling has run past the point where a healthy extraction would have finished (~30 s), the confirmation page re-triggers periodically, about once a minute. The **server** decides whether the claim is actually stale, so a nudge arriving too early is refused cheaply as `alreadyHandled` — it can never shorten the staleness window or cause a duplicate extraction.

**A second weakness fixed at the same time.** The reclaim originally matched on the exact `extraction_started_at` value it had read. Postgres stores microseconds and a JS ISO string carries milliseconds, so an equality match across that boundary is a quiet way to never match at all — the reclaim could have silently never fired. It now matches on `extraction_started_at < staleBefore`, which is equally atomic (once one request wins, the row's timestamp becomes `now()`, which is no longer inside the stale window, so a second concurrent request matches zero rows) and does not depend on a timestamp round-tripping byte-for-byte through PostgREST.

**Files modified:** `components/ConfirmationScreen.jsx`, `app/api/extract/route.js`, `scripts/test-timing.js`.

**Regression testing performed:** `scripts/test-timing.js` asserts the CAS matches on the staleness window, that the equality form is not reintroduced, that a null (pre-migration) claim timestamp is still reclaimable, and that `STALE_CLAIM_MS` still exceeds `maxDuration`. 12 checks, all passing. **Still not proven end to end in production** — see the assessment in `CURRENT_STATUS.md`.

---

## 33. Confirming a paper detached its own submitter from it

**Root cause:** `components/ConfirmationScreen.jsx` seeded its researcher list from extraction whenever extraction had found one — and that mapping dropped `researcher_id`:

```js
extracted.value.map((r) => ({ full_name: r.name, author_order: r.author_order, ... }))
```

`confirm_researcher_metadata` only takes its "update the existing row" branch when an id is supplied. With none, it **inserts** a brand-new researcher for every name, and then runs its reconciliation delete:

```sql
delete from paper_researchers
where paper_id = v_paper.id and researcher_id <> all(v_kept_ids);
```

Since the submitter's id was never in `v_kept_ids`, their link to their own paper was deleted — and replaced by a fresh, email-less duplicate of their name.

`CLAUDE_CODE_HANDOVER.md` §4 claimed this RPC "preserves the submitter's own email by matching on `researcher_id`, not by delete-and-recreate". The RPC does exactly that. **The client never gave it an id to match on**, so the guarantee never actually held in the one path that mattered. A correct statement about one layer hid a defect in another.

**Investigation summary:** confirmed across the entire production table, with a clean split and no exceptions.

| paper | confirmed | submitter still linked | linked researchers carrying an email |
|---|---|---|---|
| `f8676a50` | yes | **no** | 0 |
| `d5c7b51e` | yes | **no** | 0 |
| `c71a48b9` | yes | **no** | 0 of 6 |
| the other 7 | no | yes | 1 |

Three of three confirmed papers detached; zero of seven unconfirmed. The arithmetic corroborates it exactly: 18 researcher rows for 10 papers, of which 10 carry an email (one per paper) and **8 do not** — which is 1 + 1 + 6, precisely the three confirmations.

**Impact.** Not data loss: `papers.submitted_by` still points at the right researcher, so contact details remain recoverable. But `paper_researchers` — the join the confirmation RPC reads and any future admin view will read — no longer contains the submitter, the authorship graph accumulates a duplicate of every author on every confirmation, and any social links previously stored against the real row are orphaned. On a platform whose completion screen promises "We'll reach out using the details you provided", the list that says who is on a paper silently stopped including the person who submitted it.

**Fix implemented:** `lib/fields/researcherSeed.js` carries `researcher_id` across wherever an extracted name matches somebody already on the paper, along with that person's stored social links. Name matching is deliberately conservative — trimmed, whitespace-collapsed, case-folded, nothing cleverer — because a *wrong* match would attach one person's contact details to another person's name, which is far worse than the current behaviour of failing to match. Each existing researcher can be claimed at most once, so two genuine authors sharing a name cannot collapse onto one row. A name extraction found that the paper does not already know stays id-less, which is correct: that author really is new and should be inserted.

**Residual, documented not fixed:** if the submitter *is* an author but their name is spelled differently in the document than in the form, they still get a duplicate and still lose the link. Contact remains recoverable via `papers.submitted_by`. Closing that completely means either fuzzy name matching (which risks the wrong match described above) or an RPC change that never deletes the `submitted_by` link (which would keep a non-author submitter in the authorship list). Both are judgement calls above the bar for a low-risk fix.

**Files modified:** `lib/fields/researcherSeed.js` (new), `components/ConfirmationScreen.jsx`, `CLAUDE_CODE_HANDOVER.md` (the false guarantee corrected).

**Regression testing performed:** `scripts/test-researcher-seed.js`, 17 checks, all passing, exit 0. Covers the submitter keeping their id and their social links, a genuinely new co-author correctly getting none, case/whitespace/Arabic matching, a different person *not* being matched, two authors sharing a name not collapsing, one row not being claimed twice, a confirmed paper never being reshaped by a later extraction, every fallback path, malformed input not throwing, and the real six-author `c71a48b9` shape end to end.

**Not repaired:** the three already-confirmed papers still have detached submitters and duplicate researcher rows. Repairing them means re-linking by `submitted_by` and deleting the duplicates — a data migration over real records, which needs the owner's decision rather than a unilateral write.

---

## 34. Correction: bug O nulls the year, it does not preserve it

**What was previously recorded.** `CURRENT_STATUS.md` described bug O as: `confirm_researcher_metadata` "accepts a corrected year only when it matches `^[0-9]{4}$` and otherwise **keeps the old value**, returning no error."

**What the live function actually does**, read from `pg_get_functiondef` on 2026-09-20:

```sql
year = case
         when p_corrections ? 'year' then
           case when nullif(trim(p_corrections->>'year'), '') ~ '^[0-9]{4}$'
                then (p_corrections->>'year')::int
                else null end          -- <-- nulls it
         else year
       end
```

The inner `CASE` has an explicit `else null`. A year that fails the pattern is **erased**, not preserved. The earlier description was wrong, and wrong in the safer direction, which is the worst way for a description to be wrong.

**Confirmed empirically** against the live database: `'٢٠١٩' ~ '^[0-9]{4}$'` → false, `'۲۰۱۹'` → false, `'٢٠١٩م'` → false, `'2019'` → true. So a submitter typing their own document's Arabic-Indic year would have had a correctly extracted year wiped.

**Why it is not currently reachable.** Since `BUG_HISTORY.md` #20, the confirmation screen normalizes the year through the same `normalizeYear()` the server uses before sending it, so `corrections.year` is now always either an ASCII four-digit string or an empty string. The empty string is the deliberate "the submitter cleared this" signal, and nulling is the correct response to it. The destructive branch is unreachable from the only client that exists.

**Status:** still open, severity reduced from "medium, silent data drop" to "low, unreachable from the current client, but a trap for any future caller". A proper fix is a migration that either accepts Arabic-Indic digits server-side or raises a real error instead of nulling silently. Recorded rather than applied, because it changes RPC behaviour and this audit's remit was low-risk fixes.

---

## 35. The last function without a pinned search_path

**Root cause:** `prevent_premature_publish()` — the trigger that stops a paper reaching `published` without passing through review — had no `search_path` set. Flagged by Supabase's own database linter (`0011_function_search_path_mutable`) during this audit.

Materially lower risk than `BUG_HISTORY.md` #1, because this one is `SECURITY INVOKER`: it runs as the calling role, so a mutable `search_path` cannot be used to escalate the way it could in a `SECURITY DEFINER` function. Still worth closing — a trigger that resolves its own table and operator references through a caller-controlled path is a latent correctness problem as much as a security one, and the fix is one line.

**Fix implemented:** migration `0009` sets `search_path = public`. Deliberately **not** `public, extensions`: unlike the three RPCs, this function calls nothing from pgcrypto, and granting it a wider path than it needs would be the opposite of the point.

**Files modified:** `supabase/migrations/0009_trigger_search_path.sql` (new), `supabase/migrations/README.md`.

**Migration applied to production** on 2026-09-20. Verified after: the linter no longer reports `function_search_path_mutable`, and all three `SECURITY DEFINER` RPCs were re-confirmed as carrying `search_path=public, extensions` in `pg_proc.proconfig` — so `BUG_HISTORY.md` #1 remains structurally prevented, not merely absent.

---

## 36. A provider outage was reported to the submitter as "we couldn't read this document"

**Root cause:** three separate faults, each of which alone would have been survivable.

On 2026-09-20 two real submissions failed within seconds of each other. The cause was entirely upstream:

```
{"code": 503, "status": "UNAVAILABLE",
 "message": "This model is currently experiencing high demand.
             Spikes in demand are usually temporary. Please try again later."}
```

Nothing was wrong with either document. One was an English PDF, one Arabic; both had been extracted successfully before.

**1. The retry ladder was far too short for what a 503 actually is.** The policy fired correctly — attempt 1 → 503, waited 2193 ms and 1931 ms (the new jittered backoff, working exactly as designed), attempt 2 → 503, gave up. Total elapsed under ten seconds on both. But a demand spike lasts minutes, not two seconds, so a single short retry could never have cleared one. The fix for `BUG_HISTORY.md` #29 correctly separated 429 from 503 and then gave 503 a budget sized for a 429.

**2. The failure message blamed the submitter's document.** `papers.failure_code` was set correctly to `api_error`, but `ConfirmationScreen` only branched on `not_research` and `encrypted_document`; everything else fell through to *"We couldn't read this document... This sometimes happens with unusual formats or scanned pages of low quality."* Someone who had just uploaded a perfectly good thesis was told their work was unreadable because Google was busy. This is precisely the collapse of distinct failures into one message that `BUG_HISTORY.md` #7 exists to prevent — the typed code was there, and nothing read it.

**3. A failed paper was a permanent dead end.** The reclaim added in #27 covers `processing` only. A paper that reached `failed` could never be claimed again by anything: not the automatic nudge, not "Try again" — that screen had no retry control at all. A temporary outage produced a permanently dead submission.

**Investigation summary:** read directly from the stored diagnostics and the function log. Both `ai_generations` rows carry `httpStatus: 503`, `attempt: 2`, `retryAlsoFailed: true`, and the verbatim Google message. The log shows the full sequence per request: `gemini_request` attempt 1 → `gemini_response` 503 → `gemini_retry` (`reason: overloaded`, `delayMs: 2193`) → `gemini_request` attempt 2 → `gemini_response` 503 → `gemini_retry_failed` → `extraction_failed`. The instrumentation added in #28 made this a five-minute diagnosis instead of a hypothesis.

**Fix implemented:**

- **A real ladder for 503.** `OVERLOAD_BACKOFF_MS` is now `[2000, 9000]` — two retries with escalating, jittered waits, rather than one. A 503 returns no content and is billed for nothing, so the extra attempt is free; the whole ladder adds at most ~12 s against a 300 s ceiling. 429 is deliberately **unchanged** at one retry, because unlike a 503 it spends the quota it just exhausted. `callGemini` became a bounded loop driven by the policy's attempt count instead of a hand-written single retry.
- **A distinct screen for a transient failure.** *"We couldn't finish reading it just now — there's nothing wrong with your document. Our reading service was temporarily busy and didn't respond in time."* With a working **Try again** button.
- **Transient failures are re-claimable.** The extract route now accepts a paper in `failed` whose `failure_code` is one of `api_error`, `timeout`, `empty_response`, `malformed_json`, `internal` — after a 30 s cooldown so the button cannot be used to hammer the provider, and as the same compare-and-swap shape as every other claim so two clicks cannot both start an extraction. `not_research`, `unsupported_file_type` and `encrypted_document` are deliberately excluded: re-running those spends a provider call to get the identical answer. Every claim now also clears `failure_code`, so a retried paper that succeeds does not keep looking like it failed.

**This does not affect the two-provider-call ceiling.** That ceiling counts extraction *passes*, enforced by the orchestrator. A 503 returns no content and costs nothing, so re-sending it is not a third extraction — it is the same pass still trying to happen.

**Files modified:** `lib/ai/retryPolicy.js`, `lib/ai/providers/gemini.js`, `components/ConfirmationScreen.jsx`, `app/api/extract/route.js`.

**Regression testing performed:** `scripts/test-retry-policy.js` (38 checks) now builds on the literal production 503 body and asserts that a 503 gets more than one retry, that the waits escalate, that the ladder is bounded, that the whole ladder stays far inside the time budget, and that a 429 still gets exactly one retry. `scripts/test-timing.js` asserts the transient/permanent split of failure codes, the cooldown, the compare-and-swap on the failed-retry claim, and that a claim clears `failure_code`. All 7 suites pass; `eslint` clean; build compiles.

**Not verified in production:** reproducing a 503 on demand would mean waiting for Google to be overloaded again. The ladder and the retry path are proven against the recorded error shape, not against a live outage.
