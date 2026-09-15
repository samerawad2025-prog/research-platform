# PROJECT_MAP.md

**Generated:** September 12, 2026, by direct audit of the repository — every import, every database call, and every dependency listed below was confirmed by reading the actual source file, not recalled from memory. This is a companion to `CLAUDE_CODE_HANDOVER.md`, which explains *why* things are built this way; this file exists to answer *where is X* and *what touches Y* quickly.

---

## Top-level layout

```
research-platform/
├── app/                    Next.js App Router: pages + the one API route
├── components/             Two client components, each with its own CSS module
├── lib/                    All business logic — the AI pipeline, the extraction
│                           pipeline, and the two Supabase clients
├── scripts/                One standalone regression test
├── next.config.mjs
├── package.json
├── package-lock.json
├── eslint.config.mjs
├── jsconfig.json
├── CLAUDE_CODE_HANDOVER.md
└── README.md
```

---

## `app/` — routes

### `app/layout.js`
Root layout. Imports `./globals.css`. Exports `metadata` and the `RootLayout` component wrapping every page. No data fetching, no database interaction.

### `app/page.js`
The homepage. Static, no client-side logic, no database interaction. **Not yet redesigned** — this is the "feels like a test page" landing mentioned in the handover's roadmap.

### `app/globals.css`
Global stylesheet shared by every page.

### `app/submit/page.jsx`
Renders `components/SubmissionForm`. `export const dynamic = "force-dynamic"` — not statically prerendered, since the form needs live client-side Supabase calls. No direct database interaction itself; delegates entirely to the component it renders.

### `app/confirm/[token]/page.jsx`
Dynamic route. Reads the `token` route param (via `await params`, required by this Next.js version), passes it straight to `components/ConfirmationScreen`. `export const dynamic = 'force-dynamic'`. No direct database interaction itself.

### `app/api/extract/route.js`
**The only API route in the project. The single most important file to understand.**

- **Imports:** `node:crypto`, `../../../lib/supabaseAdminClient`, `../../../lib/extraction/orchestrator`, `../../../lib/extraction/applyResult`, `../../../lib/ai`
- **Exports:** `POST(request)`
- **Database interaction (direct table access, using the service-role client — bypasses RLS):**
  - `papers` — SELECT (token lookup), UPDATE (CAS claim to `processing`), UPDATE (final status + applied metadata + `failure_code` + `document_type`)
  - `ai_generations` — INSERT (one row per pass, plus a merged row when applicable, plus a failure-diagnostic row on error)
- **AI interaction:** calls `runExtraction()` from the orchestrator, which in turn calls whichever provider `getProvider()` selects
- **Storage interaction:** downloads the submitted file from the `papers` bucket via the service-role client
- **Auth/security:** the confirmation *token* (hashed, compared via `crypto.createHash('sha256')`), never the paper's UUID, is the credential for this route too — matching the RPC-level security model
- **Deployment-relevant:** this is the function most likely to hit Vercel's execution-duration limits on a large PDF; it's also the one route where `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` are actually used

---

## `components/` — the two client-side screens

### `components/SubmissionForm.jsx` + `SubmissionForm.module.css`
The `/submit` page's entire interactive logic.

- **Imports:** `react` (`useState`), `../lib/supabaseClient` (anon client), its own CSS module
- **Database interaction:** uploads the file to Storage (`papers` bucket, via the anon client — allowed by a storage policy that permits upload-only, not read/list); calls the `submit_paper` RPC; on failure, calls `supabase.storage.from('papers').remove(...)` to avoid leaving an orphaned file
- **AI interaction:** none directly — fires `fetch('/api/extract', ...)` as fire-and-forget after a successful submission, then redirects
- **Fields collected:** full name, email, WhatsApp number (optional), file, publication scope (checkboxes), processing-consent checkbox naming the external AI service explicitly

### `components/ConfirmationScreen.jsx` + `ConfirmationScreen.module.css`
The `/confirm/[token]` page's entire interactive logic. The largest, most stateful file in the project.

- **Imports:** `react` (`useState`, `useEffect`, `useRef`), `../lib/supabaseClient`, its own CSS module
- **Database interaction:** calls `get_paper_for_confirmation` (read, polled every ~3s while status is pending/processing) and `confirm_researcher_metadata` (write, on final submit) — both via the anon client, both token-gated
- **AI interaction:** none directly — may re-fire `fetch('/api/extract', ...)` if it observes a paper still stuck `pending` on first load (a resilience measure, not a normal-path call)
- **Rendering logic branches on:** `extraction_status` (`pending`/`processing` → skeleton loading state; `completed`/`partial` → the editable form; `failed` → one of three specific messages depending on `document_type`/`failure_code`: not-research, encrypted-document, or generic)
- **Backward-compat shim present here:** normalizes a legacy `supervisor` key to `supervisor_name` for records written before that bug was fixed (see `BUG_HISTORY.md`)

---

## `lib/` — everything else

### `lib/supabaseClient.js`
The **anon-key** client. Safe to import anywhere, including client components. Exports `supabase`.

### `lib/supabaseAdminClient.js`
The **service-role-key** client. Exports `getSupabaseAdmin()`. **Must never be imported into a client component** — it bypasses every RLS policy. Currently imported only by `app/api/extract/route.js`. Throws a clear `config`-coded error if `SUPABASE_SERVICE_ROLE_KEY` is unset, rather than crashing uncaught (this was itself a fixed bug — see `BUG_HISTORY.md`).

### `lib/ai/index.js`
The provider selector. Reads `AI_PROVIDER` env var, requires either `./providers/mock` or `./providers/gemini`, exports `getProvider()`. **This is the only file that should ever choose a provider** — nothing else in the codebase imports a provider module directly.

### `lib/ai/schema.js`
No external imports. Exports `METADATA_FIELDS` (the 9 single-value fields the pipeline tracks — `title`, `title_ar`, `abstract`, `abstract_ar`, `supervisor_name`, `year`, `university`, `faculty`, `degree_type`), `EXTRACTION_INSTRUCTIONS` (the entire prompt text, as one string), and `targetedInstructions(missingFields)` (wraps the same base prompt with a pass-2-specific ask). **Changing extraction behavior almost always means editing this file.**

### `lib/ai/providers/mock.js`
No external imports. Exports `extractMetadata({pass, missingFields})`. Reads `MOCK_SCENARIO` env var (`thesis` default, or `article`, `not_research`) to pick one of three fixed, hand-written response fixtures. Zero cost, zero network calls, fully deterministic. This is the provider used for essentially all logic testing in this project's history.

### `lib/ai/providers/gemini.js`
- **Imports:** `../schema` (the prompt), `../../extraction/errors` (`ExtractionError`)
- **Exports:** `extractMetadata({pass, document, missingFields})`
- **Network interaction:** raw `fetch()` calls to `https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` — no SDK dependency, deliberately (see handover §7)
- **Env vars consumed:** `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_THINKING_LEVEL`, `GEMINI_TIMEOUT_MS`
- **Behavior:** exactly one bounded retry on HTTP 503/429/network failure; typed `ExtractionError.code` for every failure mode (`max_tokens`, `malformed_json`, `api_error`, `timeout`, `empty_response`, `config`); normalizes a `supervisor` key in the raw response to `supervisor_name` before returning (a confirmed-bug fix, see `BUG_HISTORY.md`); logs a structured JSON line at every request/response stage for observability

### `lib/extraction/orchestrator.js`
The core two-pass logic. No network calls of its own — everything goes through the `provider` object passed into `runExtraction()`.

- **Imports:** `./docx`, `./pdf`, `./keywordScan`
- **Exports:** `runExtraction`, `getMissingCriticalFields`, `getAllMissingFields`, `mergeResults`, `getDocumentType`
- **Key constants:** `ALWAYS_CRITICAL = ['title', 'researchers', 'year']` (pass-2 trigger fields, unconditionally); `supervisor_name` is added to the trigger list *only* when `document_type === 'thesis'`; `ALL_FIELDS` (10 fields, the full opportunistic-ask list once pass 2 is already running)
- **Hard ceiling:** exactly two provider calls per run, enforced by the function's own control flow (no loop exists that could exceed this — verifiable by reading the function)

### `lib/extraction/docx.js`
- **Imports:** `mammoth`, `jszip`, `./errors`
- **Exports:** `extractDocxText`, `isOleCompoundFile`, `assertNotEncrypted`, `extractHeaderText`
- **What it does:** detects an OLE/CFB-signature file (encrypted or legacy `.doc`) before calling mammoth at all; runs `mammoth.extractRawText()` for body text; **separately** reads `word/header1.xml`, `word/header2.xml`, `word/header3.xml` directly via `jszip` (mammoth never reads these) and prepends their decoded text, labeled, to the body text
- **Deliberately does not** attempt footer extraction beyond what's already covered by the same header-part list, and does not attempt any OOXML parsing beyond a plain `<w:t>` text-run regex — not a general-purpose OOXML library

### `lib/extraction/pdf.js`
- **Imports:** `pdf-lib`
- **Exports:** `getPageCount`, `slicePages`
- **What it does not do:** any text extraction. PDF text extraction (`pdf-parse`) was removed from this project entirely after a confirmed Node/Vercel runtime incompatibility (`DOMMatrix is not defined`) — see `BUG_HISTORY.md`. PDFs are sent to Gemini as native document input; this file only slices page ranges to bound cost.

### `lib/extraction/keywordScan.js`
No external imports. Exports `findCandidateSections`. A non-AI, pure string-search pre-scan used **only** for DOCX pass-2 targeting (PDF pass 2 always uses a broader native slice instead — see the orchestrator). Searches for marker phrases (`Supervised by`, `Prepared by`, Arabic equivalents, etc.) and returns a ±300/+500-character window around the first match per missing field.

### `lib/extraction/applyResult.js`
No external imports. Exports `decideApplication`, `buildPapersUpdate`, `APPLIABLE_FIELDS`. Pure decision logic, deliberately separated from any Supabase call so it's unit-testable without a database: decides which extracted fields (only ones with `status: 'found'`) get written to the `papers` columns, and whether that should happen at all (never, once `metadata_confirmed_at` is set).

### `lib/extraction/errors.js`
No external imports. Exports `ExtractionError` — a shared error class carrying `.code` and `.diagnostics`, used by both the Gemini provider and the DOCX encryption check, so `app/api/extract/route.js` can classify a failure without inspecting error message strings.

---

## `scripts/test-docx-extraction.js`
Standalone Node script, run manually (`node scripts/test-docx-extraction.js /path/to/real/thesis.docx`), not wired into any CI yet. Imports `../lib/extraction/docx` directly. Exits non-zero on any failed assertion. Exercises header extraction and graceful degradation on unreadable input.

---

## Configuration files

### `next.config.mjs`
Currently minimal (`const nextConfig = {}`). Previously contained a `serverExternalPackages: ['pdf-parse']` workaround, removed when `pdf-parse` was removed from the project entirely — worth knowing if you ever see that setting mentioned in old notes and wonder why it's gone.

### `package.json`
Dependencies: `@supabase/supabase-js`, `jszip` (declared explicitly even though it also arrives transitively via `mammoth` — declared directly because the project now depends on it directly, for header reading), `mammoth`, `next`, `pdf-lib`, `react`, `react-dom`. Dev dependencies: `eslint`, `eslint-config-next`. Notably **absent**: any Gemini SDK (deliberate — raw `fetch()` is used instead) and `pdf-parse` (removed — see `BUG_HISTORY.md`).

### `eslint.config.mjs`, `jsconfig.json`
Standard Next.js project scaffolding, not modified from defaults during this project's development.

---

## Database interaction summary (by file)

| File | Tables/RPCs touched | Client used |
|---|---|---|
| `components/SubmissionForm.jsx` | `submit_paper` (RPC), `papers` storage bucket (upload, and remove-on-failure) | anon |
| `components/ConfirmationScreen.jsx` | `get_paper_for_confirmation` (RPC), `confirm_researcher_metadata` (RPC) | anon |
| `app/api/extract/route.js` | `papers` (SELECT, UPDATE ×2+), `ai_generations` (INSERT ×2–4), `papers` storage bucket (download) | **service role** |

No other file in the repository touches Supabase directly. This is a deliberate, narrow surface: exactly three RPCs are the entire public write/read API, and exactly one server route holds the service-role key.

## AI interaction summary (by file)

| File | Role |
|---|---|
| `lib/ai/index.js` | Chooses the provider |
| `lib/ai/providers/mock.js` | Fake provider, zero cost |
| `lib/ai/providers/gemini.js` | Real provider, the only file that makes an actual network call to Google |
| `lib/ai/schema.js` | The prompt itself, consumed by whichever provider is active |
| `lib/extraction/orchestrator.js` | Decides how many times and with what input the provider gets called |
| `app/api/extract/route.js` | The only caller of `runExtraction()` |

## Deployment-relevant components

- `next.config.mjs` — currently trivial, but this is where any future Vercel/Next.js-specific runtime workaround would go (as `serverExternalPackages` once did)
- `package.json` — the dependency surface Vercel builds from
- `app/api/extract/route.js` — the one route with a meaningful execution-duration profile (a large PDF plus a Gemini call can run tens of seconds)
- Environment variables consumed across the codebase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (client-safe), `SUPABASE_SERVICE_ROLE_KEY` (server-only, `lib/supabaseAdminClient.js` only), `AI_PROVIDER`, `GEMINI_API_KEY`, `GEMINI_MODEL`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_THINKING_LEVEL`, `GEMINI_TIMEOUT_MS`, `MOCK_SCENARIO` — full detail on each in `CLAUDE_CODE_HANDOVER.md` §5
