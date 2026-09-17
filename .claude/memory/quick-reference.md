# Quick reference: symptom → likely cause

A fast lookup table, not a replacement for `BUG_HISTORY.md`. If a symptom below matches, go read the referenced entry there in full before acting — this table is intentionally too compressed to act on alone.

| Symptom | Check first | Bug # |
|---|---|---|
| Confirmation page needs a manual refresh | Is the poll loop actually running, or checking `pending` instead of `pending`/`processing`? | 5 |
| Researcher list incomplete, then correct after refresh | Is `researchers` state re-derived on every poll tick, not just the first load? | 6 |
| Any extraction error shows "We couldn't read this document" | Check `papers.failure_code` — is it null even though the error is specific? That's the old catch-all resurfacing. | 7 |
| A field is `not_found` that's clearly visible in the source document | Check the actual key Gemini returned (`result_data` in `ai_generations`) before assuming the model failed to find it — it may be under a different key name entirely. | 15 |
| Supervisor missing on a thesis specifically | Is `document_type` actually classified as `thesis`? Supervisor only triggers pass 2 when it is. | 8 |
| University/faculty/degree missing on a DOCX | Check whether the source `.docx` actually has this content in a header — `mammoth` never reads headers; confirm via `extractHeaderText()` directly against the real file. | 16 |
| Researcher count drops between passes | Check whether `mergeResults()` is being called with the actual `missingFields` list — a field pass 2 wasn't asked about must never be accepted. | 13 |
| PDF extraction fails after tens of seconds with no clear reason | Check `finishReason` and `httpStatus` in the logged diagnostics before guessing — this has been both a Google 503 and (in earlier, now-fixed builds) an unset `maxOutputTokens`. | 9 |
| Extraction status is `partial` | This is not a bug by itself — it means pass 1 succeeded and pass 2 failed after its own retry. Check `pass2Failure` in the stored diagnostics for why, don't treat `partial` itself as the problem. | 10 |
| `gen_random_bytes` / `digest` "does not exist" | `search_path` on the function — must include `extensions`, not just `public`. | 1 |
| `DOMMatrix is not defined` | This should be structurally impossible now (`pdf-parse` was removed entirely) — if it recurs, something reintroduced a `pdf.js`-based dependency. | 2 |
