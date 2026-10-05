-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 05: record 0018 in the migration history (only after file 04 said PASS)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row returned (version, name = ai_processing_agreement). No row: it was already recorded or 0018 is not applied — STOP and report.

insert into supabase_migrations.schema_migrations (version, name, statements)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'ai_processing_agreement',
       array['-- supabase/migrations/0018_ai_processing_agreement.sql, SHA-256 78f86cd86a2e349d56d0c257df9353198036bfb6c33730539e6913062ef95d26, applied in the SQL Editor (docs/release-runbook.md, Stage A2)']
where exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'agreement_versions' and column_name = 'external_ai_processing')
  and not exists (select 1 from supabase_migrations.schema_migrations where name = 'ai_processing_agreement')
returning version, name;
