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
