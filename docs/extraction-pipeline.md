# Extraction pipeline

Lives in `lib/extraction/orchestrator.js`. **Hard ceiling: exactly 2 provider calls per extraction, enforced by the function's own control flow** — there is no loop that could exceed this. Preserve that property in any future change; it's a deliberate cost control, not an accidental limitation.

## Pass 1

| File type | What happens |
|---|---|
| DOCX | `mammoth.extractRawText()` for body text + header/footer text read separately via `jszip` (mammoth never reads these — `BUG_HISTORY.md` #16), prepended and labeled. First 6000 characters sent as text. |
| PDF | First 10 pages sliced (`pdf-lib`), sent as **native document input** to Gemini. There is deliberately no PDF text-extraction step at all — `pdf-parse` was removed entirely after a confirmed runtime crash (`BUG_HISTORY.md` #2); Gemini reads the rendered page directly. |

The actual prompt sent is `EXTRACTION_INSTRUCTIONS` from `lib/ai/schema.js` — mirrored for reference in `prompts/metadata-extraction.md`. It asks for document classification first, then title, researchers, supervisor, year, university, faculty, degree type, and abstract, each returned as one of four shapes: `found` (value + source), `not_found`, `ambiguous` (candidates), or `conflicting` (multiple candidate/source pairs) — never a bare value.

## Deciding whether pass 2 runs

```js
ALWAYS_CRITICAL = ['title', 'researchers', 'year']
```

`supervisor_name` is added to the critical list **only** when `document_type === 'thesis'` — a journal article's missing supervisor is usually correct, not a gap worth a second call (`BUG_HISTORY.md` #8). `university`/`faculty`/`degree_type` have **no independent trigger** — they only get a second look if pass 2 fires for some other reason. This is a known, disclosed tradeoff (favoring speed/cost over guaranteed recovery of these three fields), not an oversight — revisit deliberately if evidence suggests it should change.

## Pass 2 (when triggered)

Asks about every currently-missing field, not just whatever triggered it — the marginal cost of asking is near zero once a second call is already happening.

| File type | Input |
|---|---|
| DOCX | A non-AI keyword-scan excerpt around a matched marker phrase (`lib/extraction/keywordScan.js`) — a ±300/+500-character window (widened from an original ±100/+400 after the narrower one was proven to truncate a real 6-person researcher list, `BUG_HISTORY.md` #14), or a 12000-character fallback if nothing matches. |
| PDF | A broader 25-page native slice — no text extraction, same reasoning as pass 1. |

## Merge

```js
mergeResults(pass1Result, pass2Result, requestedFields)
```

**Only fields actually in `requestedFields` are ever accepted from pass 2** — this closes a real, confirmed bug where pass 2 once volunteered an unrequested, truncated answer for `researchers` that silently overwrote a correct pass-1 answer (`BUG_HISTORY.md` #13). A field's status can be upgraded or matched, never downgraded — `found` can't become `not_found` on a retry.

## On pass-2 failure

Pass 1's result is returned completely untouched and unmerged. `extractionStatus` becomes `partial`, never `failed` — a transient Gemini failure (a real, confirmed production 503) must never discard a successful pass 1 again (`BUG_HISTORY.md` #10).

## The Gemini provider itself (`lib/ai/providers/gemini.js`)

- Raw `fetch()`, header-based auth (`x-goog-api-key`), no SDK.
- `maxOutputTokens` and `thinkingConfig.thinkingLevel` set explicitly — previously left at API defaults, which caused unpredictable behavior once thinking tokens are counted against the same output budget.
- Exactly one bounded retry, only on HTTP 503, HTTP 429, or a network-level failure. Not retried: timeouts, `MAX_TOKENS`, malformed JSON — none of these have a principled reason to succeed differently on an identical retry.
- A typed `ExtractionError.code` for every failure mode, so the route can give an accurate message instead of one generic one (`BUG_HISTORY.md` #7).
- Normalizes a `supervisor` key in the raw response to `supervisor_name` — Gemini was found, via direct inspection of 12 real production records, to consistently return this field under the wrong key (`BUG_HISTORY.md` #15). The prompt now also states the correct key explicitly; the normalization is a safety net on top of that fix, not a replacement for it.

## If you add a new field to extract

State its exact intended JSON key explicitly in the prompt. Don't rely on the model inferring it from a section header — that's exactly the mechanism that produced the supervisor bug above, and it will happen again for any field where the header word and the intended key diverge.

## Future: article generation and validation

Not implemented. See `prompts/article-generation.md` and `prompts/validation.md` for what exists so far (a starting sketch and a checklist, respectively — not working code).
