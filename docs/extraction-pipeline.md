# Extraction pipeline

Lives in `lib/extraction/orchestrator.js`. **Hard ceiling: exactly 2 provider calls per extraction, enforced by the function's own control flow** — there is no loop that could exceed this. Preserve that property in any future change; it's a deliberate cost control, not an accidental limitation.

**Two scopes, chosen by the extraction route from the paper's accepted agreement (`external_ai_permission`, migrations 0018/0019) and `GEMINI_DATA_TERMS`; there is no default:**
- `excerpt` — Google's **unpaid (free-tier)** terms, the launch arrangement (agreement version 3). The document never leaves the server; see "The free-tier excerpt" below. **One** provider call.
- `document` — Google's paid terms (agreement version 2, superseded, not used for this project). Passes 1 and 2 as described in the sections after the excerpt one.

## The free-tier excerpt (`scope: 'excerpt'`)

Why: under Google's unpaid terms, content and responses are used to improve Google's products, human reviewers may read them, and Google says "Do not submit sensitive, confidential, or personal information to the Unpaid Services". A thesis's front pages name authors, supervisors, family and colleagues and carry emails, phones and student numbers, and the `document` scope sends those pages and asks for the names. A submitter's acceptance cannot change that (`docs/legal/README.md`, "Version 3").

What happens (`runExcerptExtraction` → `prepareExcerpt` → `lib/extraction/excerpt.js`):
1. **Read locally.** PDF: `lib/extraction/pdfText.js` reads the text layer of the first 25 pages with `unpdf` (a serverless pdf.js build with no DOM dependency, loaded only on this path; `BUG_HISTORY.md` #2 was pdf-parse loading pdf.js's rendering path). Lines are rebuilt in reading order, including right-to-left Arabic drawn glyph by glyph in visual order, and NFKC-normalised (Arabic presentation forms → letters, ligatures → letters). DOCX: mammoth body text and the header parts, kept apart.
2. **Check the text** (`assessText`): too little text → `no_text_layer` (a scan: no OCR here); mostly private-use/replacement glyphs → `text_unreadable`.
3. **Cover page** (page 1, or 2 if page 1 is nearly empty; a Word file's first 30 lines plus its headers, up to the first section heading). In order, a line is dropped if it has an email, web address, phone (9+ digits), 6+ digit number or a labelled contact/ID; any of the names the platform holds for the paper (two consecutive words of the submitter's or declared authors' names, returned by `external_ai_permission`); an honorific ("Dr", "Prof", "د.", "أ.د", "الدكتور"…, and "Mr."/"Ms." only with their dot); or a person label ("By", "Prepared by", "Supervisor", "إعداد", "إشراف", "الطالب"…). **After the first label or honorific, only a bare date line survives.** Before it, a line is kept if it is structural (institution, faculty, degree statement, journal/volume, date) or reads like a title (3+ words with a title word such as "of", "in", "and", "في", "أثر"…, and not a list of capitalised names), or continues a title line that ended mid-phrase. Everything else is dropped. Pages after the cover (declaration, dedication, acknowledgements, contents, chapters) are never used.
4. **Abstract(s)**: up to one English and one Arabic section under an "Abstract"/"Summary"/"المستخلص"/"الملخص" heading, up to 4,000 characters and at most the next page; split into sentences (not after "Dr.", initials or "et al."), dropping sentences with contact details, held names, honorifics or credits ("thank", "supervised", "أشكر"…).
5. **Refuse when unsure** (nothing is sent; `ExtractionError('excerpt_unavailable')`, reason in the diagnostics): no names to check against (`names_unavailable`); no abstract of 200+ characters and no title-plus-structural lines (`no_safe_excerpt`); a residual contact detail, held name or honorific in the assembled excerpt (`personal_data_remaining`); **a possible person's name anywhere in what would be sent** (`possible_personal_name`, `lib/extraction/names.js`: common given names in Latin and Arabic script, El/Al- forms, Abd- compounds, initials before a surname, bin/ibn/wad/بن/ود between words; Arabic words that are also names and common words — على، حسن، صالح، عمر، الطيب، آمنة… — and place/institution names such as Wad Medani or Ahmed Gasim University are excluded); a file that cannot be opened (`unreadable_file`). The diagnostics record the rule, never the name. Measured on two hand-made evaluation sets (`scripts/fixtures/name-corpus.js`): 32/32 and 19/20 name lines detected, 0/42 and 0/24 clean lines refused; misses are recorded, not hidden.
6. **One request**, text only, with `EXCERPT_EXTRACTION_INSTRUCTIONS` (`lib/ai/schema.js`): only `document_type`, `title`, `title_ar`, `abstract`, `abstract_ar`, `year`, `university`, `faculty`, `degree_type`; never any person's name. The answer is restricted to those keys; `researchers` and `supervisor_name` are recorded `not_found` whatever came back, and the result is marked `_scope: 'excerpt'` so the confirmation page says the authors and supervisor are the researcher's to add. No pass 2: the looking-further a second pass exists for is done locally before anything is sent.
7. **Record**: the `Pass 1` generation's `_diagnostics.excerpt` holds the exact text sent, its SHA-256 and what was dropped (counts by rule), so an operator can see what left the server. It is not the applied (merged) row, so the browser never receives it. Access: server (service role) and database access to the project only (RLS, no browser policy; no admin or public page reads it). Retention: kept with the paper's extraction history (append-only); removed only with the paper itself (`on delete cascade`), by an operator action such as an accepted deletion request. Agreement version 3 §6 says so.

Not an anonymizer, not infallible, and not proof of compliance: a name the lists have never seen, written without a label, title or contact detail, can pass (`scripts/fixtures/name-corpus.js` keeps the known misses). Agreement version 3 says so. Tests: `scripts/test-excerpt.js` (rules, Arabic ordering, the synthetic documents in `scripts/fixtures/synthetic/`), `scripts/test-extraction-mode.js` (route: what the provider receives, refusals, arrangement mismatch, the real Gemini provider's request body), `supabase/tests/submission-postgres.test.js` (0019 on real Postgres), `supabase/tests/browser-e2e.test.js` (the built server's actual request).

The rest of this page describes the `document` scope.

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
