# Sudanese Research Platform — Handover Document

**Prepared:** September 12, 2026
**Purpose:** Hand off this project to Claude Code for continued development.
**Read this fully before touching code.** Several past debugging sessions were wasted because a fix was assumed deployed when it wasn't. The "Deployment Process" and "Known Issues" sections exist specifically to stop that from happening again.

---

## 1. What this project is

A low-budget platform letting Sudanese undergraduate and graduate students submit their thesis/research papers, have an AI extract structured metadata (title, authors, supervisor, university, faculty, degree, year, abstract), review and correct that metadata themselves, and confirm it. This is Step 3 of a larger vision (see Future Roadmap) — publication, article generation, and public discoverability are not built yet.

Founder: one person (Samer), non-technical, building with AI assistance, near-zero budget. Every architectural decision has been made against that constraint: free tiers, minimal dependencies, no infrastructure the founder can't operate alone.

---

## 2. Current architecture

```
Browser (student)
   │
   ├─► /submit  (Next.js page, client component)
   │       uploads file → Supabase Storage (private bucket)
   │       calls submit_paper() RPC → Postgres
   │       fires POST /api/extract (fire-and-forget)
   │       redirects to /confirm/[token]
   │
   ├─► /api/extract  (Next.js API route, server-only)
   │       downloads file via Supabase service-role key
   │       runs the extraction orchestrator (see §7)
   │       calls Gemini (or the mock provider)
   │       writes results to Postgres
   │
   └─► /confirm/[token]  (Next.js page, client component)
           polls get_paper_for_confirmation() RPC until extraction finishes
           renders an editable form, submitter reviews/corrects
           calls confirm_researcher_metadata() RPC to finalize

Supabase (Postgres 17, eu-central-1, project ref mzpkiuovjppmavqkppem)
   - Rebuilt from schema.sql on 2026-09-18; the original project was deleted
   - All tables have RLS enabled, fully locked to anonymous users
   - The ONLY way an anonymous visitor can read or write anything is
     through three SECURITY DEFINER RPC functions (§6)
   - Storage bucket "papers": private, 20MB limit, PDF + DOCX only

Vercel (Hobby plan, team "samer22")
   - Hosts the Next.js app
   - Three Vercel projects are all linked to the same GitHub repo
     (see Known Issues — this has caused real confusion)
   - The confirmed-live project is research-platform-5zpu
     (prj_4N8qhSrKCpNrM73qaYmErJa6cu90)

Google Gemini API
   - Model: gemini-3.6-flash (configurable via env var)
   - Called directly via REST (fetch), no SDK dependency, on purpose —
     see §8 for why
```

**No GitHub MCP connector is available in the assistant session that built this.** All code changes were delivered as ZIP files for the founder to manually push. If Claude Code has direct repo access, that alone will eliminate an entire category of past confusion (see §11).

---

## 3. Folder structure

```
research-platform/
├── app/
│   ├── page.jsx                    # minimal landing page (not redesigned yet)
│   ├── submit/
│   │   └── page.jsx                # renders SubmissionForm
│   ├── confirm/
│   │   └── [token]/
│   │       └── page.jsx            # renders ConfirmationScreen
│   └── api/
│       └── extract/
│           └── route.js            # THE extraction endpoint - see §7
├── components/
│   ├── SubmissionForm.jsx
│   ├── SubmissionForm.module.css
│   ├── ConfirmationScreen.jsx      # polling, inline editing, all failure states
│   └── ConfirmationScreen.module.css
├── lib/
│   ├── supabaseClient.js           # anon key client, safe for browser
│   ├── supabaseAdminClient.js      # SERVICE ROLE client - server-only, never import in a component
│   ├── ai/
│   │   ├── index.js                # provider selector (AI_PROVIDER env var)
│   │   ├── schema.js               # THE PROMPT + expected field list
│   │   └── providers/
│   │       ├── mock.js             # zero-cost, deterministic, 3 scenarios
│   │       └── gemini.js           # real provider: retry, timeout, key normalization
│   └── extraction/
│       ├── orchestrator.js         # two-pass logic, merge logic, trigger logic
│       ├── docx.js                 # mammoth + header extraction + encryption detection
│       ├── pdf.js                  # pdf-lib page slicing only (no text extraction)
│       ├── keywordScan.js          # non-AI pre-scan, DOCX pass-2 targeting only
│       ├── applyResult.js          # decides what gets written to papers columns
│       └── errors.js               # shared ExtractionError class
├── scripts/
│   └── test-docx-extraction.js     # regression test, run against any real DOCX
├── next.config.mjs
├── package.json
└── .env.local.example
```

---

## 4. Database schema

Six tables, all in the `public` schema, all with RLS enabled.

### `researchers`
Anyone credited on a paper, including the person who submitted it.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| full_name | text not null | |
| email | text | Private. Never returned by any public-facing RPC. |
| whatsapp_number | text | Private, optional. Same footing as email. Loosely validated (not strict E.164). |
| linkedin_url | text | Only ever stored if the paper's publication_scope includes `metadata_and_article`. |
| facebook_url | text | Same rule as linkedin_url. |
| school, department, graduation_year | text/int | Declared, not currently populated by anything. |
| created_at | timestamptz | |

### `papers`
The central table.

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| submitted_by | uuid → researchers | |
| title, title_ar | text | Extracted, human-correctable |
| abstract, abstract_ar | text | Extracted, human-correctable |
| supervisor_name | text | See §10 — this had a confirmed key-name bug, now fixed |
| university, faculty, degree_type | text | Added in a later phase; recoverable via DOCX header extraction (§10) |
| year | int | |
| document_type | text | thesis / journal_article / conference_paper / research_report / not_research |
| methodology, keywords/themes | text/text[] | **Legacy, unused.** Left nullable on purpose — removing them wasn't worth a migration. Do not resurrect extraction for these without a deliberate decision; they were deliberately dropped from the prompt for speed. |
| file_path | text not null | Path inside the private `papers` storage bucket |
| permission_to_process | boolean | |
| publication_scope | text[] | Subset of `{full_paper, metadata_and_article, abstract_and_citation}` |
| extraction_status | text | `pending \| processing \| completed \| partial \| failed` — see §10 for what `partial` means |
| failure_code | text | Populated on failure: `max_tokens \| malformed_json \| api_error \| timeout \| empty_response \| config \| encrypted_document \| not_research \| internal`. **As of this writing, no failed paper in production has this populated — the resilience-phase code that writes it may not be deployed. Verify before assuming otherwise.** |
| metadata_confirmed_at | timestamptz | Null until the submitter confirms. Once set, automatic extraction must never silently overwrite the papers columns again (enforced in application code, not a DB constraint). |
| confirmation_token_hash | text | SHA-256 hash of a 256-bit random token. **The raw token, not the paper's UUID, is the confirmation-flow credential.** Returned once, at submission. |
| last_applied_generation_id | uuid → ai_generations | Which generation's result is currently reflected in the columns above |
| status | text | submitted / in_review / approved / published / rejected / withdrawn (publication workflow — not built yet beyond the column existing) |
| admin_notes | text | |
| created_at | timestamptz | |

### `paper_researchers`
Many-to-many join. `(paper_id, researcher_id)` composite key, plus `author_order int`. Order is positional (as the paper lists them), never a hierarchy — there is no "primary author" concept anywhere in this system.

### `ai_generations`
The permanent, append-only extraction history. **Never overwritten, never deleted.**

| Column | Notes |
|---|---|
| paper_id | |
| generation_type | Currently always `metadata_extraction` |
| provider | `gemini` / `mock` |
| model_used | e.g. `gemini-3.6-flash`, or `mock` |
| status | `success` / `failed` |
| result_data | jsonb — the full structured result, or `{_diagnostics, _failure_code}` on a failed attempt |
| notes | Human-readable: `"Pass 1"`, `"Pass 2, targeted at: ..."`, `"Merged result after N pass(es) in Xms..."` |
| created_at | |

A single extraction run typically writes 2–3 rows: pass 1, pass 2 (if triggered), and a merged row (only when there's an actual merge — see §10, item on partial extraction).

### `articles`, `article_versions`
Both exist, both empty (0 rows). Reserved for a future step (turning confirmed metadata into a public-facing accessible article). Not implemented.

### Storage
Bucket `papers`: private, 20MB file size limit, `allowed_mime_types` restricted to `application/pdf` and `application/vnd.openxmlformats-officedocument.wordprocessingml.document` (PDF and DOCX only — legacy `.doc` was deliberately excluded, no reliable dependency-light parser exists for it).

### RPC functions (the only way anon can touch the database)

- **`submit_paper(p_full_name, p_email, p_file_path, p_permission_to_process, p_publication_scope, p_whatsapp_number default null)`** → `jsonb {paper_id, confirmation_token}`. Validates input, creates the researcher + paper + link, generates the confirmation token, returns it once.
- **`get_paper_for_confirmation(p_token)`** → `jsonb`. Token-gated read. Explicit field allowlist in the `jsonb_build_object` call — `confirmation_token_hash`, `admin_notes`, and researchers' private contact fields are structurally impossible to leak, not just filtered by convention.
- **`confirm_researcher_metadata(p_token, p_researchers jsonb, p_corrections jsonb default null)`** → `jsonb`. Token-gated write. Reconciles the researcher list (updates existing rows by id, inserts new ones, removes dropped ones). **It preserves the submitter's row only if the caller actually sends `researcher_id`** — a claim this file previously made unconditionally, which was false in practice: the confirmation screen seeded from extraction and dropped every id, so the RPC inserted duplicates and then deleted the submitter's own link. Confirmed on all three confirmed papers in production. Fixed client-side in `lib/fields/researcherSeed.js`; see `BUG_HISTORY.md` #33. **A submitter who is not in `paper_researchers` is not by itself damage**, and the 2026-09-21 audit found no data needing repair: `papers.submitted_by` is `not null` and is never touched, so the submitter's row, email and WhatsApp always survive. `paper_researchers` records **authorship**, and a submitter is frequently not an author — they may be uploading someone else's thesis. The id is carried across only when an extracted name matches an existing row, so a submitter who typed a nickname is still reconciled away, by design. `BUG_HISTORY.md` #40.
  Also note the `year` correction branch **nulls** a value that fails `^[0-9]{4}$` rather than keeping it (`BUG_HISTORY.md` #34). Corrections use `p_corrections ? 'field'` to distinguish "the submitter deliberately cleared this" from "the submitter didn't touch this," not `coalesce`, which can't express clearing.
- **`prevent_premature_publish()`** — trigger function, blocks a paper from reaching `published` status without passing through review first.

**Security note:** `gen_random_bytes` and `digest` (pgcrypto) live in Supabase's `extensions` schema, not `public`. Every SECURITY DEFINER function must set `search_path = public, extensions` or these calls fail with a confusing "function does not exist" error — this was a real, deployed production bug (see §10).

---

## 5. Environment variables

| Variable | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | |
| `SUPABASE_SERVICE_ROLE_KEY` | Yes | **Server-only.** Bypasses RLS entirely. A missing value here caused a real production incident (an uncaught exception with zero diagnostic trail) — the extract route now catches this explicitly and reports a clean `config` error instead. |
| `AI_PROVIDER` | No, defaults to `mock` | `mock` or `gemini` |
| `GEMINI_API_KEY` | Only if `AI_PROVIDER=gemini` | |
| `GEMINI_MODEL` | No, defaults to `gemini-3.6-flash` | Pinned to a specific GA model, not a `-latest` alias (Google's own docs mark `-latest` aliases experimental) |
| `GEMINI_MAX_OUTPUT_TOKENS` | No, defaults to `4096` | Explicitly set — was previously unset, which used the API's 8192 default with unpredictable results once thinking tokens are counted against the same budget |
| `GEMINI_THINKING_LEVEL` | No, defaults to `low` | `minimal \| low \| medium \| high`. Metadata extraction is pattern-matching, not deep reasoning. |
| `GEMINI_TIMEOUT_MS` | No, defaults to `120000` | |
| `MOCK_SCENARIO` | No, defaults to `thesis` | Only used when `AI_PROVIDER=mock`. Also: `article`, `not_research` |

There is currently **no tool available to verify what's actually set in Vercel's environment variable store** — this was checked explicitly during a capability audit and no such tool exists in the connectors available. If something behaves as if a variable is missing in production, that has to be checked manually in the Vercel dashboard.

---

## 6. Extraction pipeline flow

```
1. Student uploads PDF or DOCX via /submit
2. File → Supabase Storage (private bucket, service-role only after this point)
3. submit_paper() RPC → creates researcher + paper rows, returns {paper_id, confirmation_token}
4. Browser fires POST /api/extract {token} (fire-and-forget) + redirects to /confirm/[token]

5. /api/extract:
   a. Look up paper by hash(token) — token, never the paper's UUID, is the credential
   b. Compare-and-swap: UPDATE ... WHERE extraction_status='pending' → 'processing'
      (proven correct under real concurrent-call testing — prevents double-processing)
   c. Download file (service role key)
   d. If DOCX: check for OLE/CFB magic bytes FIRST (encrypted-file detection) —
      before mammoth is ever called
   e. Run the orchestrator (see §7 for the two-pass logic)
   f. Write ai_generations row(s)
   g. Update papers columns (only for fields with status:'found' — ambiguous/
      conflicting fields are never silently written into a plain text column).
      `year` is normalized first: papers.year is an integer and is the ONLY
      non-text appliable column, so an un-castable value there used to reject
      the entire UPDATE (BUG_HISTORY.md #18). Every papers write in this route
      now checks its error and throws; the Supabase client does not throw on a
      failed statement, and swallowing that error made a stuck row look like a
      clean HTTP 200 (BUG_HISTORY.md #19).
   h. Set extraction_status = completed | partial | failed

6. /confirm/[token]:
   a. Polls get_paper_for_confirmation() every ~3s while status is pending/processing
      (a real, continuous poll — an earlier version only checked once and needed a
      manual refresh; see §10)
   b. Once resolved: renders an editable form, every field inline-editable,
      fields with ambiguous/conflicting/not_found status visually flagged
   c. Submitter reviews, corrects if needed, clicks one confirm button
   d. confirm_researcher_metadata() RPC finalizes — sets metadata_confirmed_at

7. Once metadata_confirmed_at is set, a later automatic extraction (if one ever
   runs again) must NOT overwrite the confirmed papers columns. It's still
   recorded in ai_generations (nothing is ever silently discarded), just not applied.
```

---

## 7. AI pipeline flow (the two-pass extraction logic)

Lives in `lib/extraction/orchestrator.js`. Hard ceiling: **at most 2 provider calls per extraction, ever** — no loop exists that could exceed this.

```
prepareDocument(fileBuffer, fileType)
  DOCX → mammoth.extractRawText() + header/footer text (jszip) prepended,
         first 6000 chars sent as pass-1 input
  PDF  → first 10 pages sliced (pdf-lib), sent as native document input to
         Gemini (Gemini reads the rendered page directly — no text
         extraction happens for PDF at all, deliberately, see §10)

pass1 = provider.extractMetadata({pass: 1, document: pass1Doc})

triggerFields = getMissingCriticalFields(pass1.result)
  ALWAYS_CRITICAL = ['title', 'researchers', 'year']
  + 'supervisor_name' IS ALSO critical, but ONLY when document_type === 'thesis'
    (a journal article genuinely often has no supervisor - not_found there
    is correct, not a gap - so it must not force a second call)
  university/faculty/degree_type have NO independent trigger - they are
  only ever recovered if pass 2 fires for some OTHER reason (see §10)

IF triggerFields.length === 0:
  → done in 1 pass, extractionStatus = 'completed'

ELSE:
  missing = getAllMissingFields(pass1.result)   # ALL currently-missing fields,
                                                  # asked about opportunistically
  pass2Doc = buildPass2Document(...)
    DOCX → keyword-scan excerpt around a matched marker (±300/+500 chars —
           widened from an original ±100/+400 after this window was proven
           to truncate a 6-person researcher list), or a 12000-char
           fallback if no marker matches
    PDF  → a broader 25-page native slice, no text extraction

  TRY: pass2 = provider.extractMetadata({pass: 2, document: pass2Doc, missingFields: missing})
  CATCH (a real, confirmed 503 overload, a timeout, malformed JSON, etc.):
    → pass 1's result is returned UNCHANGED and UNMERGED.
    → extractionStatus = 'partial'
    → Nothing is ever lost. This is the resilience-phase fix — see §10.

  IF pass2 succeeded:
    finalResult = mergeResults(pass1.result, pass2.result, missing)
      - only fields actually in `missing` are ever accepted from pass 2
        (fixes a confirmed real bug where pass 2 volunteered an
        UNREQUESTED field with truncated data and it overwrote a
        correct pass-1 answer — see §10)
      - a field's status can only be upgraded or matched, never
        downgraded (found can't become not_found on a retry)
    extractionStatus = 'completed'
```

### Provider abstraction (`lib/ai/`)

`lib/ai/index.js` selects `mock` or `gemini` based on `AI_PROVIDER`. Nothing else in the codebase imports a provider directly.

- **`mock.js`** — three fixed scenarios (`thesis`, `article`, `not_research`), zero cost, fully deterministic, used for essentially all logic testing in this project's history. The `thesis` scenario deliberately includes all four uncertainty states (`found`/`not_found`/`ambiguous`/`conflicting`) in one run.
- **`gemini.js`** — real REST calls via `fetch()`, not the official SDK (deliberate: fewer moving dependencies to go stale alongside a fast-changing model landscape). Header-based auth (`x-goog-api-key`, not a query param — the query-param style is what older docs show). Explicit `maxOutputTokens` + `thinkingConfig.thinkingLevel`. Exactly one bounded retry, only for HTTP 503, HTTP 429, and network-level failures (not timeouts, not malformed JSON, not MAX_TOKENS — those wouldn't plausibly change on an identical retry). Typed `ExtractionError` with a `.code` so the route can give an accurate, specific user-facing message instead of one generic failure string. Normalizes `supervisor` → `supervisor_name` after parsing (see §10).

### The prompt (`lib/ai/schema.js`)

`EXTRACTION_INSTRUCTIONS` is the entire prompt. It asks for: document classification first (thesis/journal_article/conference_paper/research_report/not_research), then title, researchers (with explicit author-vs-supervisor-vs-affiliation disambiguation), supervisor (with an explicit list of label patterns in English and Arabic — "Supervised by", "Under the Supervision of", "إشراف", "بإشراف", etc.), year (with published-vs-thesis logic), university, faculty, degree type, and abstract. Every field returns one of four shapes: `found` (with value + source), `not_found`, `ambiguous` (with candidates), or `conflicting` (with multiple candidate/source pairs) — never a bare value.

---

## 8. Known issues (open, as of this handover)

**See `CURRENT_STATUS.md` for a 2026-09-13 production-data re-verification of this section — items 5 and 6 below have since moved from "unconfirmed" to "confirmed live," and item 3's underlying counts have been refreshed against real data.**

**Superseded again on 2026-09-19.** `CURRENT_STATUS.md` is the live source of truth for what is open; this list is kept for how things were found. Changes since it was written: items 1 and 2 are closed (GitHub access works, and the stray Vercel projects were deleted). Item 5 is closed by evidence — the first-ever `partial` occurred on 2026-09-19 when pass 2 hit a Gemini 429 and pass 1's result was preserved, exactly as designed. **The whole database was rebuilt on 2026-09-18** after the original Supabase project was deleted, so the counts quoted throughout this section are gone and cannot be requeried; see the warning at the top of `CURRENT_STATUS.md` before citing any of them as live evidence. Two new open bugs, both recorded there: **M** (the 429 retry ignores the delay the server states) and **J** (a stalled extraction has no recovery path — now proven materially harmful, not theoretical).


1. **GitHub is not connected.** No commit/branch/PR visibility. All code lived only as ZIP handoffs. If Claude Code has direct repo access, use it — this alone would have prevented several rounds of "did the fix actually deploy?" confusion.
2. **Three Vercel projects are linked to the same GitHub repo** (`research-platform-5zpu`, `research-platform-88r9`, `research-platform`). Only `research-platform-5zpu` (`prj_4N8qhSrKCpNrM73qaYmErJa6cu90`) has been confirmed as the one actually serving traffic. This was never fully resolved — worth cleaning up.
3. **No tool exists to read Vercel environment variables.** Can't be verified remotely; check the dashboard directly if something behaves like a missing/wrong env var.
4. **Deployment lag has repeatedly been mistaken for a code bug.** At least three separate incidents in this project's history were "the fix is right, it just isn't live yet" — confirmed by comparing Vercel log string formats against what the current code actually produces, and by checking whether `papers.failure_code` / `extraction_status='partial'` had ever appeared in the database. **Before debugging anything that looks like a regression, check Supabase for whether the expected new behavior has ever actually occurred.**
5. **`partial` extraction_status has never once occurred in production data**, despite the resilience-phase code existing. **Re-checked 2026-09-13: still 0 `partial` rows, `failure_code` still null on all 10 failed papers** — but all 10 failures predate 2026-09-09 16:03, and there have been zero failures of any kind since. This is no longer evidence the resilience build is undeployed — it's simply unexercised. Reclassify as "needs a real failure to test against," not "probably not deployed." See `CURRENT_STATUS.md`.
6. ~~The most recent two fixes (header extraction, supervisor key normalization) have only been tested against mock data and reconstructed real-API-shaped responses.~~ **Resolved 2026-09-13** — both confirmed directly against real production `ai_generations`/`papers` rows from live Gemini calls as recent as today. See `CURRENT_STATUS.md`.
7. **Legacy `ai_generations` records contain stale field names** from earlier prompt iterations (`methodology`, `keywords`, `abstract_en`, `title_en`, `degree_name`, `country`, `school`, `subtitle`, `publication_year`). These are historical only — the current prompt does not produce them — but don't be confused if you query old rows and see them.
8. **Encrypted-DOCX detection (OLE/CFB signature check) also matches a legacy `.doc` file saved with a `.docx` extension.** Disclosed, accepted limitation — both cases are equally unprocessable today.
9. ~~**WhatsApp field is plain text**, not a proper country-picker/E.164 component.~~ **Resolved 2026-09-20** — country picker added, live validation, stored in E.164. No migration was needed: E.164 already satisfies the existing SQL check. See `BUG_HISTORY.md` #22 and #23.

---

## 9. Fixed issues (chronological)

1. **pgcrypto `search_path` bug** — `gen_random_bytes`/`digest` calls failed in production because Supabase installs pgcrypto in an `extensions` schema, and SECURITY DEFINER functions had `search_path = public` only. Fixed by widening to `public, extensions` everywhere it's used. Reproduced and confirmed against a database built to match Supabase's actual layout before fixing.
2. **`pdf-parse` / Next.js runtime incompatibility** — `pdf-parse` (built on `pdf.js`) references browser-only globals (`DOMMatrix`) that don't exist in Vercel's Node runtime. A build-time bundling workaround (`serverExternalPackages`) fixed the build but not the actual runtime crash. Root-caused via Google's own documented, widespread reports of the same issue in other projects. Resolved by removing `pdf-parse` entirely — PDF now relies solely on Gemini's native document understanding plus `pdf-lib` for page slicing (structure manipulation only, no rendering, no DOMMatrix dependency).
3. **Gemini API staleness** — auth switched from a `?key=` query parameter to the documented `x-goog-api-key` header; default model updated to `gemini-3.6-flash` after checking Google's current documentation directly rather than carrying over an older assumption.
4. **No real polling on the confirmation page** — the only automatic check fired on `extraction_status === 'pending'`, but the server flips status to `processing` almost instantly, so the check essentially never ran. Users had to manually refresh. Fixed with a genuine recurring poll loop.
5. **Incomplete researcher list on first display** — a one-shot retry updated `paper` state but never re-derived the `researchers` list from the fresh data; only the very first page load did that. Fixed by having one function derive all UI state from every fetch, called by both the initial load and every poll tick.
6. **WhatsApp number added** — optional, private, stored on the submitter's own researcher row, never returned by the confirmation RPC, loosely validated.
7. **Extraction scope simplified** — methodology, keywords, and themes removed as extraction targets entirely (columns remain, unused) to cut unnecessary AI calls and page-scanning for information the platform doesn't need to identify a paper.
8. **Supervisor extraction improved, document classification added** — the prompt originally discouraged reporting a supervisor more than it helped find one. Rewritten with explicit label patterns (English + Arabic) and document-type classification, which also solved a separate requirement (rejecting non-research uploads with a specific message instead of a generic failure).
9. **Real Gemini 503 overload confirmed** (via Vercel runtime error logs, Google's own "high demand" message) — added exactly one bounded retry for 503/429/network failures. Not retried: timeouts, MAX_TOKENS, malformed JSON (an identical retry has no principled reason to succeed on those).
10. **Pass-1 data destroyed by a pass-2 failure** — a transient 503 on pass 2 discarded a fully successful pass-1 result. Fixed: pass 2 now runs inside its own try/catch; on failure, pass 1's result is returned completely unmerged and untouched, and `extraction_status` becomes `partial` rather than `failed`.
11. **Encrypted DOCX detection** — checks the OLE/CFB magic byte signature before mammoth is ever invoked, returning a specific "password-protected" message instead of a generic parse-failure message.
12. **Merge filtering bug (confirmed against real production data)** — pass 2 volunteered an answer for `researchers` even though it was never asked about it, using a text excerpt that only captured 3 of 6 names, and the merge accepted it, overwriting pass 1's correct list of 6. Fixed: the merge now only ever accepts fields that were actually in the requested/missing list for that pass.
13. **DOCX pass-2 excerpt window widened** — the original ±100/+400 character window around a matched keyword was proven (against the real thesis file) to sometimes start after a relevant block of content already began. Widened to −300/+500.
14. **Supervisor field-name mismatch (confirmed against 12/12 real production records, both PDF and DOCX)** — Gemini consistently, deterministically returned this field as `supervisor`, never `supervisor_name`, because the prompt's section header ("SUPERVISOR:") never stated the intended JSON key explicitly, unlike every other field where the header word happened to already match the key. Fixed at the source (prompt now states the key explicitly) and backstopped with a normalization step applied to every Gemini response.
15. **DOCX header extraction** — `mammoth.extractRawText()` never reads header or footer XML parts at all. Confirmed by directly unzipping a real production thesis: university, faculty, and degree existed *only* in `word/header2.xml` and were completely absent from mammoth's output, with zero warnings raised. Fixed by reading header parts directly via `jszip` and prepending their text, clearly labeled, to what's sent to Gemini. Wrapped so a header-reading failure can only ever fail to add information, never break an extraction that previously worked.
16. **Arabic year value stranded an extraction** — `papers.year` is an integer column; a real thesis reporting `٢٠١٩م` made Postgres reject the whole UPDATE, discarding a correct Arabic title, abstract, university and degree and leaving the paper in `processing` behind an HTTP 200. Fixed with a conservative `normalizeYear()` (Arabic-Indic and Persian digits to ASCII, exactly one in-range 4-digit run, 1900–2100, omit rather than guess). `BUG_HISTORY.md` #18.
17. **Every `papers` update in the extract route discarded its error** — the Supabase client resolves `{ data, error }` rather than throwing, so a rejected UPDATE was indistinguishable from a successful one and the route returned 200. All writes now check and throw through the route's existing failure handling; the CAS claim no longer misreports a query error as a benign race. `BUG_HISTORY.md` #19.
18. **The confirmation screen never rendered `title_ar`/`abstract_ar`** and hard-required an English title, so an Arabic-only paper could not be confirmed honestly. Every other layer — prompt, apply logic, columns, both RPCs — already supported these fields; the screen's own field list was the only place they were missing. A real submitter typed a sentence into the English title box to get past the block, and it became the paper's title. Frontend-only fix, no migration. `BUG_HISTORY.md` #20.
19. **Pass 2 spent a paid provider call re-confirming an absent English title** on Arabic-only papers. `title`/`title_ar` and `abstract`/`abstract_ar` are now treated as "at least one of", so a field counts as missing only when neither language has it. Only ever reduces calls; the two-call ceiling is untouched. `BUG_HISTORY.md` #21.
20. **WhatsApp numbers had no validation before upload** and were stored as typed, so one number had several representations. Now validated live against `libphonenumber-js` metadata and stored in E.164. `BUG_HISTORY.md` #22, #23.
21. **The 429 retry ignored the server-stated delay.** 503 and 429 were one class retried after a flat 1500ms; a 429 stating 12.577s was retried after 1.5s and could not have succeeded, while spending more of the exhausted quota. Policy split out to `lib/ai/retryPolicy.js`: honours `Retry-After` → `RetryInfo` → message text, caps at 30s, never retries a 429 on pass 2 (pass 1 is already usable), never retries blind. `BUG_HISTORY.md` #29.
22. **Preview deployments write to production.** Every Vercel env var targets preview as well as production, including the service-role key. Two production papers were written by preview builds running unmerged code. Extraction is now blocked on preview via `lib/env.js`; the credential scoping still needs an owner decision. `BUG_HISTORY.md` #30.
23. **A zero-yield extraction looked identical to a complete one.** Field yield is now counted and logged. `BUG_HISTORY.md` #31.

## Recent fixes and why they were implemented (most recent session)

Items 12–15 above were all found through the same method, worth calling out explicitly since it's the debugging pattern that should continue: **querying real, live `ai_generations` records via the Supabase connector rather than reasoning from synthetic test cases.** Two hypotheses formed earlier in the investigation (a text-box-based content-loss theory, and a general Gemini-nondeterminism theory for the supervisor field) were both **disproven** by inspecting the actual uploaded thesis file and the actual stored JSON — and replaced with the real causes above. That reversal is recorded plainly in the conversation history and is a model for how findings here should be treated: provisional until checked against real data, corrected in public when they're wrong.

---

## 10. Deployment process

1. Code changes are currently delivered as a ZIP file. The founder unzips it and pushes the contents to the `research-platform` branch of `samerawad2025-prog/research-platform` on GitHub.
2. Vercel auto-deploys from that branch (confirm the Production Branch setting on `research-platform-5zpu` matches, given the three-project ambiguity in §8).
3. Database changes are separate SQL migration files, run manually by the founder in Supabase → SQL Editor. **Never** tell the founder to re-run the full `schema.sql` against the live database — that file is for fresh installs only. Every schema change to the live database has its own incremental migration file.
4. **After any deploy, verify it actually landed before trusting it.** The cheapest way: submit one real paper, then query `ai_generations.notes` and `papers.failure_code` / `extraction_status` in Supabase. The exact wording and structure of what's stored is a fingerprint of which code version is actually running (this is literally how deployment lag was caught multiple times in this project's history).

---

## 11. Testing process

- **Local Postgres** (a real Postgres instance, not a mock) is used to test every migration against realistic seeded prior data before handing it over — non-destructive, zero-data-loss verified each time, including RLS and RPC-level security (confirming a wrong token or a bare paper UUID cannot read or write anything).
- **Mock AI provider** (`AI_PROVIDER=mock`, `MOCK_SCENARIO=thesis|article|not_research`) is the primary way extraction *logic* (two-pass triggering, merge behavior, uncertainty-state handling) gets tested — zero cost, fully deterministic, and it's how the merge-filtering and header-extraction fixes were proven correct before ever touching a live key.
- **Real file testing**: a real production thesis (uploaded by the founder) was used directly for forensic investigation — unzipping its actual OOXML, checking exactly what mammoth extracts versus discards, and reconstructing exact Gemini response shapes from what was actually stored in `ai_generations`. Prefer this over synthetic test documents whenever a real one is available; two hypotheses in this project's history were disproven specifically because a synthetic test document didn't match the real file's actual structure.
- **`scripts/test-docx-extraction.js`** — a small standalone regression script, run as `node scripts/test-docx-extraction.js /path/to/real/thesis.docx`. Exits non-zero on failure, suitable for a CI step once one exists.
- **No live Gemini key is available in the environment that built this.** Anything Gemini-specific was either verified by reconstructing the exact real API response shape recorded in Supabase, or handed to the founder to test live with a report-back. If Claude Code has a live key, use it — it would close the one remaining open verification gap (§8, item 6).
- **Supabase and Vercel MCP connectors**, where available, should be preferred over asking the founder to paste screenshots or logs — direct querying is faster and removes transcription errors. This was explicitly audited: Supabase access is full read/write; Vercel access covers projects, teams, and runtime error logs, but not environment variables or (on the Hobby plan) more than 1 hour of raw runtime logs.

---

## 12. Current project status

- **Step 3 (submission → extraction → human confirmation) is implemented** and has been through multiple real rounds of production bug-fixing.
- As of the last live snapshot (**re-verified 2026-09-13**): **28 papers completed, 10 failed, 6 stuck pending**, out of 44 total. All 10 failures are 503-overload incidents dated 2026-09-07 through 2026-09-09; there have been zero failures since. The 6 stuck-pending papers all predate 2026-09-03 and are orphaned by earlier code, not a live bug.
- The most recent code changes (merge filtering, excerpt widening, supervisor key fix, header extraction) **are now confirmed against live Gemini calls in production** (see `CURRENT_STATUS.md`) — the earlier mock-only caveat no longer applies. The one still-unconfirmed piece is the resilience-phase failure path (`failure_code`, `partial` status), which simply hasn't been exercised by a real failure since it was deployed.
- Steps 4+ (accessible article generation, social-media draft generation, publication workflow, public search/discovery, admin dashboard) have not been started.
- A UX/product audit (landing page, visual design system, phone input redesign, field-level confirm UX) was conducted and partially actioned (skeleton loading states, inline editing, specific error messages, document classification) — the remaining items (landing page, design system, phone input) were explicitly paused to prioritize extraction reliability.

---

## 13. Future roadmap

**Deferred, explicitly paused pending reliability work:**
- Landing page redesign (current one "feels like a test page," per the founder)
- Visual design system (typography, spacing, color, consistent across the app)
- Phone input with country picker (`libphonenumber-js`, `min` metadata build for weight, E.164 storage) replacing the current plain text field
- Researcher/supervisor social profile fields beyond LinkedIn/Facebook (ORCID, university profile) — deliberately deprioritized; most current users are undergraduates unlikely to have or want one

**Not started, further out:**
- Accessible article generation from confirmed metadata (the actual "Step 4" of the original vision)
- Social media draft generation (LinkedIn/Facebook post copy)
- Publication workflow and public-facing search/discovery site
- Admin dashboard, email notification system
- Supervisor/researcher public profile pages

**Explicitly considered and rejected or deferred with reasoning already recorded:**
- Real-time streaming extraction (Gemini's `streamGenerateContent`) — would give genuine progressive field-by-field reveal, but judged not worth the added complexity relative to honest skeleton-loading states, which achieve the same perceived quality without claiming knowledge the system doesn't have yet.
- A deterministic regex-based supervisor cross-check (as a fallback alongside the AI extraction) — proposed as a mitigation for the supervisor field-name bug before that bug's actual, much simpler root cause was found. No longer needed now that the real cause is fixed.
- Per-field "Confirm" buttons on the confirmation screen — rejected in favor of inline-editable fields with a single final confirmation, since per-field buttons would make the common case (an entirely correct extraction) require far more taps for no accuracy benefit.

**Process recommendation for whoever continues this:**
Set up direct GitHub access if at all possible. A large fraction of the debugging effort recorded in this project's history went into determining *whether a fix was actually live* rather than diagnosing new problems — a gap that direct repository access closes immediately.
