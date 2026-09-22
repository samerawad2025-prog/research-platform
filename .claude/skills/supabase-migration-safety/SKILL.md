---
name: Supabase Migration Safety
description: Safety rules for all Supabase schema, SQL migration, RLS, RPC, storage-policy, SECURITY DEFINER, and production data-repair work in the Research Center Platform. Use before proposing or editing database changes.
when_to_use: Use whenever work touches supabase/, SQL, migrations, RPCs, policies, RLS, database constraints, paper/researcher relationships, storage policies, or production data repair.
model: inherit
effort: high
paths:
  - "supabase/**"
  - "docs/database.md"
---

# Supabase migration safety — Research Center Platform

Database changes must preserve existing production data, the locked-down RLS model, confirmation-token security, and compatibility with the currently deployed application.

## Ground first

Before proposing a database change, read the relevant portions of:
- `docs/database.md`
- `supabase/schema.sql`
- `supabase/migrations/README.md`
- existing migration(s) touching the same object
- relevant RPC reference under `supabase/functions/`
- `CURRENT_STATUS.md`
- `BUG_HISTORY.md` when the change resembles an old failure

Inspect the live schema through the Supabase connector when needed. Do not assume documentation and production are identical.

## Source-of-truth rules

- `supabase/schema.sql` is for a fresh install. Never re-run the full file against production.
- Every live schema change gets its own incremental migration in `supabase/migrations/`.
- Keep fresh-install schema and RPC reference files aligned with the final intended state after a migration.
- Preserve migration history; do not rewrite old applied migrations to make history look cleaner.
- Use the next repository naming/numbering convention rather than inventing a new one.

## Security invariants

Do not weaken these without an explicit architectural decision:

- RLS stays enabled and locked down for anonymous direct table access.
- Anonymous browser access occurs only through intentionally exposed `SECURITY DEFINER` RPCs.
- Confirmation access is based on the hashed confirmation token, never a bare paper UUID.
- `SUPABASE_SERVICE_ROLE_KEY` remains server-only.
- Functions using pgcrypto must have the correct `search_path` including `public, extensions`.
- `SECURITY DEFINER` functions must explicitly constrain `search_path`.
- A new RPC must expose only the minimum fields/actions required.
- Do not create a broad “temporary” policy to make a failing test pass.

When changing an RPC, inspect both authorization and data-shape compatibility with the currently deployed caller.

## Migration design

Prefer the smallest safe change.

Before writing SQL:
1. identify affected objects and rows
2. identify deployed code that reads/writes them
3. decide whether old and new application versions can coexist during deployment
4. decide whether the migration is additive, backfill, constraint-tightening, destructive, or data repair
5. state rollback/recovery options for any high-risk change

Prefer additive/backward-compatible sequencing:
- add new column/object
- deploy code that can tolerate both states
- backfill if needed
- tighten/remove later only when proven safe

Do not combine unrelated cleanup with a functional migration.

Use transactions when they improve atomicity and the operations are safe to run transactionally.

## Data repair rules

Production data repair requires evidence, not inference.

Before an UPDATE/DELETE/MERGE:
- run a SELECT that identifies the exact affected rows
- explain why each row is safe to change
- show expected before → after state
- preserve legitimate co-authors and submitter identity
- never merge researchers on name similarity alone
- never treat a missing co-author email as evidence of an orphan
- avoid deleting historical `ai_generations`; it is append-only diagnostic evidence

For destructive operations, prefer identifiers and relational evidence over fuzzy text matching.

After the write:
- re-run verification SELECTs
- confirm row counts and foreign-key relationships
- confirm no unexpected neighboring rows changed

If the evidence is ambiguous, stop rather than guessing.

## Constraints and normalization

When tightening a constraint or changing normalization:
- inspect real production values first
- test edge cases represented by Arabic and English data
- keep JS/server normalization and SQL/RPC normalization semantically aligned where both exist
- preserve existing valid values
- reject/omit ambiguous values rather than silently coercing them into plausible but false data

Do not make schema changes solely to accommodate one malformed test row without first deciding whether the row or the rule is wrong.

## Testing

Before applying a migration to production:
- test SQL syntax and behavior against an isolated/local database or safe branch when available
- test with realistic pre-migration data
- verify both intended success and important failure cases
- verify RLS/RPC behavior, not just direct service-role SQL
- run the repository test suite and build if application code changes with the migration

For security-sensitive changes, explicitly test:
- anonymous direct table access remains blocked
- wrong confirmation token fails
- bare paper UUID cannot substitute for the token
- correct token can do only what the RPC intends

## Applying to production

Writing a migration file does **not** imply permission to apply it live.

Apply to production only when the user's task explicitly includes production application or approval has been given in the current workflow.

Before live application:
- confirm the target Supabase project
- confirm the migration has not already been applied
- capture relevant pre-change evidence
- avoid peak-risk changes when rollback would be difficult

After application:
- verify the live object definition
- verify relevant data
- verify the application path that depends on it when appropriate

## Completion gate

A database change is complete only when these are distinguishable:
- migration authored
- migration tested
- application compatibility tested
- migration applied to production, if requested
- production schema/data verified
- docs/schema mirrors updated as required

Report any stage not completed instead of implying it was.
