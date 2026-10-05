-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 08: record 0019 in the migration history (only after file 07 said PASS)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row returned (version, name = gemini_free_tier_agreement). No row: it was already recorded or 0019 is not applied — STOP and report.

insert into supabase_migrations.schema_migrations (version, name, statements)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'gemini_free_tier_agreement',
       array['-- supabase/migrations/0019_gemini_free_tier_agreement.sql, SHA-256 a70ccbfd65fc04b33d6333e4c53ecf18630a2af4464692acc95b138bc1d900c6, applied in the SQL Editor (docs/release-runbook.md, Stage A2)']
where exists (select 1 from pg_constraint where conname = 'agreement_versions_external_ai_processing_check' and pg_get_constraintdef(oid) like '%gemini_api_unpaid%')
  and not exists (select 1 from supabase_migrations.schema_migrations where name = 'gemini_free_tier_agreement')
returning version, name;
