# Migrations

**This project does not use the Supabase CLI's migration tracking system.** Every file here was run manually, once, via Supabase → SQL Editor, against the live database, in the order listed below. There is no `supabase migration up` history to reconcile — this folder's order is a reconstruction based on each migration's actual dependencies (a later file assumes an earlier one has already run), not literal timestamps.

If you're setting up a **fresh** database, don't run these individually — use `supabase/schema.sql`, which already reflects their combined end state. Use this folder only against a database that already has some earlier subset applied (i.e., the real, existing production database), or to understand the project's history.

## Order and purpose

| # | File | What it does | Why |
|---|---|---|---|
| 0001 | `checkbox_scope.sql` | Changes `publication_scope` from a single text value to a checkbox-style array | Submitters can select more than one publication preference |
| 0002 | `step3_confirmation_flow.sql` | Adds `metadata_confirmed_at`, `abstract_ar`, `confirmation_token_hash`; adds `get_paper_for_confirmation` and `confirm_researcher_metadata` | The extraction confirmation flow itself |
| 0003 | `fix_pgcrypto_search_path.sql` | Recreates `submit_paper` and the two functions above with `search_path = public, extensions` | `gen_random_bytes`/`digest` failed in production — `pgcrypto` lives in Supabase's `extensions` schema, not `public`. `BUG_HISTORY.md` #1. |
| 0004 | `whatsapp_field.sql` | Adds `researchers.whatsapp_number`; replaces `submit_paper` with a 6-argument version | New optional field. Note: this **drops** the old 5-argument `submit_paper` before recreating it — `CREATE OR REPLACE` with an added parameter creates a confusing second overload instead of truly replacing the function, verified directly before this migration was written. |
| 0005 | `metadata_fields.sql` | Adds `university`, `faculty`, `degree_type`, `document_type`; updates both confirmation RPCs to read/write them | Extraction pipeline expanded to cover these fields |
| 0006 | `failure_diagnostics.sql` | Adds `papers.failure_code` | So a failed extraction can be classified by cause, not collapsed into one generic message — `BUG_HISTORY.md` #7 |
| 0007 | `resilience_phase.sql` | Widens `extraction_status` to allow `partial`; updates `get_paper_for_confirmation` to return `failure_code` | A failed pass 2 must not discard a successful pass 1 — `BUG_HISTORY.md` #10 |

## A pattern worth repeating if you add a migration that changes a function's parameter list

Adding a new parameter to an existing function via `CREATE OR REPLACE` is only safe if it has a default **and** you explicitly drop the old signature first. Tested directly during 0004: `CREATE OR REPLACE FUNCTION foo(a, b, c default 'x')` when `foo(a, b)` already exists does **not** replace it — it creates a second overload, and any caller passing exactly the old argument count becomes ambiguous. Always `DROP FUNCTION IF EXISTS <old signature>` first.
| 0008 | `extraction_claim_timestamp.sql` | Adds `papers.extraction_started_at` plus a partial index on rows still `processing` | An extraction that lost its function was stuck in `processing` permanently, because the claim only ever matched `pending` — even the confirmation page's own retry could not rescue it. Judging staleness from `created_at` was not safe (extraction can be triggered long after submission), so the claim time is recorded explicitly. `BUG_HISTORY.md` #27 |
