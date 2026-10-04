# Stage A2 package — migrations 0018, 0019, 0020 on production

**Status: prepared, NOT applied.** Ready-to-run numbered files with a checklist: `supabase/release/stage-a2-production/` (`00_CHECKLIST.md`). Needs its own founder approval. Procedure and
rationale: `docs/release-runbook.md`, "Stage A2". This file pins the exact
files and the exact record statements for that procedure.

Target: production project `mzpkiuovjppmavqkppem`, SQL Editor, one block per
query. Production code stays `f45dc690` throughout; nothing is merged or
deployed in this stage.

## Files (branch `claude/phase3-release-prep`)

| Order | File | Lines | SHA-256 | MD5 (as `release_test.run_remote` reports) |
|---|---|---|---|---|
| 1 | `supabase/migrations/0018_ai_processing_agreement.sql` | 465 | `78f86cd86a2e349d56d0c257df9353198036bfb6c33730539e6913062ef95d26` | `436551d2e8b79f52433a070f3bd6ce63` |
| 2 | `supabase/migrations/0019_gemini_free_tier_agreement.sql` | 152 | `a70ccbfd65fc04b33d6333e4c53ecf18630a2af4464692acc95b138bc1d900c6` | `6eb1201a69d9b4e58b1c59d9e591615a` |
| 3 | `supabase/migrations/0020_free_tier_full_document_agreement.sql` | 37 | `53b8bd8bd01c5a63708ec74df48ef54b6ca34f09ceb947ad8ade7c53a7ca3acb` | `f8c8336233e200c4bb2cd299aa12a196` |
| checks | `supabase/release/stage-a2-checks.sql` | — | `f28dbf208beba1d7e908e754e26c332d9fa4afeeb03f39a77a6662d395dd02c6` | — |
| checks | `supabase/release/stage-a-checks.sql` (`DATA FINGERPRINT` block) | — | unchanged since Stage A | — |

The test project `qwxfxckrabvuvuzidxuo` has these exact three files applied
(MD5s above, via `run_remote`). Verify before running: `sha256sum` and
`wc -l` of each file at the approved commit must equal the table.

What 0019 and 0020 do on production: 0019 widens the arrangement constraints
to allow `gemini_api_unpaid`, seeds version 3 **inactive** (withdrawn; never to
be activated) and replaces `external_ai_permission` (its `known_names` output is
unused by the restored code). 0020 seeds version 4 **inactive**. On production
both seeds are plain inserts. No existing row changes; nothing becomes active.

## Steps

1. `PREFLIGHT A2` (stage-a2-checks.sql) → `PASS` (applied `0011 0012 0013 0015 0016 0017`, 28 tables, 2 agreements, 0 active).
2. `DATA FINGERPRINT` (stage-a-checks.sql) → write it down.
3. Raw 0018 → success, no rows. Then `AFTER 0018` → `PASS`.
4. Raw 0019 → success, no rows. Then `AFTER 0019` → `PASS`.
5. Raw 0020 → success, no rows. Then `AFTER 0020` → `PASS` (8 agreement rows, all inactive, v4 `fce461b4` / `8b3c313e`, 0 readable papers).
6. Record in the migration history, one statement at a time, at least a second apart:

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'ai_processing_agreement',
       array['-- supabase/migrations/0018_ai_processing_agreement.sql, SHA-256 78f86cd86a2e349d56d0c257df9353198036bfb6c33730539e6913062ef95d26, applied in the SQL Editor (docs/release-runbook.md, Stage A2)']
where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agreement_versions' and column_name = 'external_ai_processing')
  and not exists (select 1 from supabase_migrations.schema_migrations where name = 'ai_processing_agreement')
returning version, name;
```

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'gemini_free_tier_agreement',
       array['-- supabase/migrations/0019_gemini_free_tier_agreement.sql, SHA-256 a70ccbfd65fc04b33d6333e4c53ecf18630a2af4464692acc95b138bc1d900c6, applied in the SQL Editor (docs/release-runbook.md, Stage A2)']
where exists (select 1 from pg_constraint where conname = 'agreement_versions_external_ai_processing_check' and pg_get_constraintdef(oid) like '%gemini_api_unpaid%')
  and not exists (select 1 from supabase_migrations.schema_migrations where name = 'gemini_free_tier_agreement')
returning version, name;
```

```sql
insert into supabase_migrations.schema_migrations (version, name, statements)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'free_tier_full_document_agreement',
       array['-- supabase/migrations/0020_free_tier_full_document_agreement.sql, SHA-256 53b8bd8bd01c5a63708ec74df48ef54b6ca34f09ceb947ad8ade7c53a7ca3acb, applied in the SQL Editor (docs/release-runbook.md, Stage A2)']
where exists (select 1 from agreement_versions where id = 'submission-terms-2026-10-04-v4-en')
  and not exists (select 1 from supabase_migrations.schema_migrations where name = 'free_tier_full_document_agreement')
returning version, name;
```

7. `DATA FINGERPRINT` again → identical to step 2.
8. Smoke check that production (`f45dc690`) still works: open the live submit page and an existing confirmation link; both load as before.

**Stop** on any `STOP:` result, an unexpected row count, or an error: do not
continue to the next file. Rollback is not expected; if needed, the rollback
notes at the bottom of 0020, then 0019, then 0018, only after confirming no
acceptance references version 3 or 4.

After Stage A2: the release session (runbook "Stages B + D"), which activates
version 4 on production. Not part of this package.
