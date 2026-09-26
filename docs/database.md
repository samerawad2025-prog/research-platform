# Database

**`supabase/schema.sql` is the source of truth for exact DDL.** This document explains what each piece is for; if this document and the actual schema ever disagree, the schema wins — update this file, not the other way around.

Project: Supabase, Postgres 17, region eu-central-1 (project ref `mzpkiuovjppmavqkppem`; rebuilt from `supabase/schema.sql` on 2026-09-18 after the original project `jyqvhaqyrsfqkkcxiwth` was deleted). Six tables, all with RLS enabled.

## `researchers`
Anyone credited on a paper, including the person who submitted it.

| Column | Notes |
|---|---|
| full_name | |
| email | Private. Never returned by any public-facing RPC. |
| whatsapp_number | Private, optional. Same footing as email. Loosely validated, not strict E.164. |
| linkedin_url, facebook_url | Only ever stored if the paper's `publication_scope` includes `metadata_and_article`. *Planned (`PHASE_3_PLAN.md` M3, not built): Facebook no longer collected, existing values retained but not displayed; LinkedIn stored regardless of scope, with a separate public-display choice defaulting to off.* |
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
| publication_scope | Subset of `{full_paper, metadata_and_article, abstract_and_citation}`. *Planned (`PHASE_3_PLAN.md` M2, not built): superseded for new submissions by a two-value publication setting (`record_abstract` / `record_abstract_fulltext`) bound to a server-side acceptance record. This column is kept unchanged on legacy rows as consent evidence and never expanded.* |
| extraction_status | `pending \| processing \| completed \| partial \| failed`. `partial` means pass 1 succeeded and its data is live, but pass 2 failed after its own retry — nothing was lost, some fields just weren't double-checked. Never relabelled by a manual decision (see below). |
| manual_entry_at, manual_entry_source | Migration 0011 (**not yet applied to production**; a prerequisite for M1). The decision to enter this paper's details by hand: `mode` (the server was in `EXTRACTION_MODE=manual`) or `researcher` (chosen on the confirmation page via `/api/manual-entry`). Both null = no decision. Once set, no new provider call starts for the paper and no late extraction result is applied to its metadata; `extraction_status` keeps whatever history it had. |
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

Anonymous users can INSERT into the bucket; the policy "anon can upload research files" checks only `bucket_id = 'papers'`. Nothing ties an upload to an accepted submission, so the form's consent checks are client-side only. There is no anonymous read, update or delete. *Planned (`PHASE_3_PLAN.md` M2, not built):* remove this policy. Uploads would then go through time-limited signed URLs, issued by the server for a server-chosen path, only after a server-recorded acceptance.

## RPC functions — the entire public API surface

- **`submit_paper(p_full_name, p_email, p_file_path, p_permission_to_process, p_publication_scope, p_whatsapp_number default null)`** → `jsonb {paper_id, confirmation_token}`.
- **`get_paper_for_confirmation(p_token)`** → `jsonb`. Explicit field allowlist — `confirmation_token_hash`, `admin_notes`, and private contact fields are structurally impossible to leak, not just filtered by convention.
- **`confirm_researcher_metadata(p_token, p_researchers jsonb, p_corrections jsonb default null)`** → `jsonb`. Reconciles the researcher list by `researcher_id` (never delete-and-recreate, which would lose the submitter's own email). Corrections use `p_corrections ? 'field'` to distinguish "deliberately cleared" from "not touched" — `coalesce` can't express clearing.
- **`prevent_premature_publish()`** — trigger function, blocks a paper reaching `published` status without review.

Individual function bodies are mirrored in `supabase/functions/` for easier review — see that folder's own `README.md` for an important naming caveat (these are Postgres RPCs, not Supabase Edge Functions).

## Migrations

`supabase/migrations/` contains every incremental change ever applied to the live database, in order. **This project does not use the Supabase CLI's migration tracking** — every migration listed there was run manually, once, via the Supabase SQL Editor. `schema.sql` is for a fresh install only; never re-run it against the live database.
