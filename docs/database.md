# Database

**`supabase/schema.sql` is the source of truth for exact DDL.** This document explains what each piece is for; if this document and the actual schema ever disagree, the schema wins — update this file, not the other way around.

Project: Supabase, Postgres 17, region eu-west-1. Six tables, all with RLS enabled.

## `researchers`
Anyone credited on a paper, including the person who submitted it.

| Column | Notes |
|---|---|
| full_name | |
| email | Private. Never returned by any public-facing RPC. |
| whatsapp_number | Private, optional. Same footing as email. Loosely validated, not strict E.164. |
| linkedin_url, facebook_url | Only ever stored if the paper's `publication_scope` includes `metadata_and_article`. |
| school, department, graduation_year | Declared, not currently populated by anything. |

## `papers`
The central table.

| Column | Notes |
|---|---|
| title, title_ar, abstract, abstract_ar | Extracted, human-correctable |
| supervisor_name, university, faculty, degree_type, year | Extracted, human-correctable |
| document_type | `thesis` / `journal_article` / `conference_paper` / `research_report` / `not_research` |
| methodology, keywords/themes | **Legacy, unused.** Left nullable on purpose — dropped from the extraction prompt for speed, not worth a destructive migration to remove. |
| file_path | Path inside the private `papers` storage bucket |
| publication_scope | Subset of `{full_paper, metadata_and_article, abstract_and_citation}` |
| extraction_status | `pending \| processing \| completed \| partial \| failed`. `partial` means pass 1 succeeded and its data is live, but pass 2 failed after its own retry — nothing was lost, some fields just weren't double-checked. |
| failure_code | Populated on failure: `max_tokens \| malformed_json \| api_error \| timeout \| empty_response \| config \| encrypted_document \| not_research \| internal` |
| metadata_confirmed_at | Null until the submitter confirms. Once set, a later automatic extraction must never silently overwrite these columns again — it's still recorded in `ai_generations`, just not applied. |
| confirmation_token_hash | SHA-256 hash of a 256-bit random token — the actual credential for the confirmation flow, not the row's own id. |
| last_applied_generation_id | Which `ai_generations` row is currently reflected in the columns above |

## `paper_researchers`
Many-to-many join, `(paper_id, researcher_id)` composite key, plus `author_order int`. Order is positional (as the paper lists them) — there is no "primary author" concept anywhere in this system.

## `ai_generations`
The permanent, append-only extraction history. **Never overwritten, never deleted.** `result_data` (jsonb) holds the full structured result, or `{_diagnostics, _failure_code}` on a failed attempt. A single run typically writes 2–3 rows: pass 1, pass 2 (if triggered), and a merged row (only when there's an actual merge — a `partial` outcome has no merged row, since pass 1's own row already is the current best result).

## `articles`, `article_versions`
Both exist, both empty. Reserved for a future step (turning confirmed metadata into a public article) — not implemented. See `prompts/article-generation.md`.

## Storage
Bucket `papers`: private, 20MB limit, `allowed_mime_types` restricted to PDF and DOCX only (`.doc` deliberately excluded — no reliable dependency-light parser exists for the legacy binary format).

## RPC functions — the entire public API surface

- **`submit_paper(p_full_name, p_email, p_file_path, p_permission_to_process, p_publication_scope, p_whatsapp_number default null)`** → `jsonb {paper_id, confirmation_token}`.
- **`get_paper_for_confirmation(p_token)`** → `jsonb`. Explicit field allowlist — `confirmation_token_hash`, `admin_notes`, and private contact fields are structurally impossible to leak, not just filtered by convention.
- **`confirm_researcher_metadata(p_token, p_researchers jsonb, p_corrections jsonb default null)`** → `jsonb`. Reconciles the researcher list by `researcher_id` (never delete-and-recreate, which would lose the submitter's own email). Corrections use `p_corrections ? 'field'` to distinguish "deliberately cleared" from "not touched" — `coalesce` can't express clearing.
- **`prevent_premature_publish()`** — trigger function, blocks a paper reaching `published` status without review.

Individual function bodies are mirrored in `supabase/functions/` for easier review — see that folder's own `README.md` for an important naming caveat (these are Postgres RPCs, not Supabase Edge Functions).

## Migrations

`supabase/migrations/` contains every incremental change ever applied to the live database, in order. **This project does not use the Supabase CLI's migration tracking** — every migration listed there was run manually, once, via the Supabase SQL Editor. `schema.sql` is for a fresh install only; never re-run it against the live database.
