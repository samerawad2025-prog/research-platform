# Architecture

For a file-by-file audit (imports, exact database calls, dependencies), see `PROJECT_MAP.md` at the repo root — this document explains the shape and the *why*; that one answers "where is X."

## Request flow

```
Browser (student)
   │
   ├─► /submit
   │       uploads file → Supabase Storage (private bucket)
   │       calls submit_paper() RPC → Postgres
   │       fires POST /api/extract, fire-and-forget
   │       redirects to /confirm/[token]
   │
   ├─► /api/extract  (server-only, holds the service-role key)
   │       downloads file via the service role
   │       runs the extraction orchestrator (see extraction-pipeline.md)
   │       calls Gemini, or the mock provider
   │       writes ai_generations + papers
   │
   └─► /confirm/[token]
           polls get_paper_for_confirmation() until extraction resolves
           renders an editable form; fields with uncertainty are flagged
           calls confirm_researcher_metadata() to finalize
```

## Stack, and why each piece was chosen

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js, App Router, plain JS (not TypeScript) | One founder, low complexity; API routes and pages in one deployable unit |
| Database | Supabase (Postgres 17) | Free tier, RLS built in, generous enough for a pilot |
| Hosting | Vercel, Hobby plan | Free tier, integrates directly with the Postgres/Next.js combination |
| AI | Google Gemini, called via raw `fetch()` | No SDK dependency — deliberate, since the model landscape here has changed names and calling conventions multiple times across this project's history, and a plain REST call is one less moving dependency to go stale alongside it |
| PDF handling | `pdf-lib` for page slicing only, no text extraction | `pdf-parse` was removed entirely after a confirmed Node/Vercel runtime crash (`DOMMatrix is not defined`); PDFs are sent to Gemini as native document input instead — see `BUG_HISTORY.md` #2 |
| DOCX handling | `mammoth` for body text, `jszip` for headers | `mammoth.extractRawText()` never reads header/footer XML at all — confirmed by direct inspection of a real production thesis; see `BUG_HISTORY.md` #16 |

## Security model

RLS is enabled on every table, fully locked to anonymous users. **The only way an anonymous visitor touches the database is through three `SECURITY DEFINER` RPC functions**: `submit_paper`, `get_paper_for_confirmation`, `confirm_researcher_metadata` (full detail in `database.md`).

The confirmation flow's credential is a hashed random token (`papers.confirmation_token_hash`) — **never the paper's UUID**. The raw token is returned to the browser exactly once, at submission. Don't add a lookup path keyed on the bare paper id for anything user-facing; this has been a deliberate, tested design decision throughout the project, not an incidental choice.

`SUPABASE_SERVICE_ROLE_KEY` (which bypasses RLS entirely) is used in exactly one place: `lib/supabaseAdminClient.js`, imported only by `app/api/extract/route.js`. It must never be imported into a client component.

A specific, previously-fixed gotcha worth knowing before writing a new database function: `pgcrypto` (used for `gen_random_bytes`/`digest`) lives in Supabase's `extensions` schema, not `public`. Every `SECURITY DEFINER` function must `set search_path = public, extensions` or those calls fail with a confusing "function does not exist" error (`BUG_HISTORY.md` #1).

## Folder structure

```
app/            Next.js App Router: pages + the one API route (app/api/extract)
components/     Two client components (SubmissionForm, ConfirmationScreen), each with a CSS module
lib/
  ai/           Provider abstraction (mock vs. Gemini) + the extraction prompt
  extraction/   The two-pass orchestration logic, DOCX/PDF handling, keyword scan
  supabaseClient.js       anon-key client, safe for the browser
  supabaseAdminClient.js  service-role client, server-only
scripts/        Standalone regression test (DOCX header extraction)
docs/           This folder
prompts/        The actual prompt text, as standalone reference files
supabase/       schema.sql, migrations, RPC function reference
.claude/        Claude Code project config (settings, custom commands, quick-reference)
```

`frontend/` and `backend/` exist as empty, reserved directories — see their own `README.md` files for why the working code hasn't been moved into them.

## Provider abstraction

`lib/ai/index.js` is the only file that selects a provider (`AI_PROVIDER` env var: `mock` or `gemini`). Nothing else imports a provider module directly — if a second real provider is ever added, it plugs in here, not scattered through the orchestrator.

- **Mock** (`lib/ai/providers/mock.js`) — zero cost, fully deterministic, three fixed scenarios (`thesis`/`article`/`not_research` via `MOCK_SCENARIO`). This has been the primary way pipeline *logic* gets tested throughout the project's history, not a toy.
- **Gemini** (`lib/ai/providers/gemini.js`) — real REST calls, one bounded retry on transient failures, typed errors, response-key normalization. See `extraction-pipeline.md` for the two-pass logic this sits underneath.
