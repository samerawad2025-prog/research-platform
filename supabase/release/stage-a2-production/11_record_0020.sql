-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 11: record 0020 in the migration history (only after file 10 said PASS)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row returned (version, name = free_tier_full_document_agreement). No row: it was already recorded or 0020 is not applied — STOP and report.

insert into supabase_migrations.schema_migrations (version, name, statements)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'free_tier_full_document_agreement',
       array['-- supabase/migrations/0020_free_tier_full_document_agreement.sql, SHA-256 53b8bd8bd01c5a63708ec74df48ef54b6ca34f09ceb947ad8ade7c53a7ca3acb, applied in the SQL Editor (docs/release-runbook.md, Stage A2)']
where exists (select 1 from agreement_versions where id = 'submission-terms-2026-10-04-v4-en')
  and not exists (select 1 from supabase_migrations.schema_migrations where name = 'free_tier_full_document_agreement')
returning version, name;
