-- Stage E — PRODUCTION project mzpkiuovjppmavqkppem — file 04: record 0014 in the migration history
-- Run ONLY after file 03 said PASS. Open a NEW query, paste this whole file, Run.
-- Expected: one row returned (version, name = close_legacy_submission_path).
-- No row: it was already recorded or 0014 is not in effect — STOP and send me the result.
insert into supabase_migrations.schema_migrations (version, name, statements)
select to_char(now() at time zone 'utc', 'YYYYMMDDHH24MISS'), 'close_legacy_submission_path',
       array['-- supabase/migrations/0014_close_legacy_submission_path.sql, SHA-256 799c020751d0b37306a86b77b5af45f98b430505738ec78b32894a7f696583be, applied in the SQL Editor (docs/release-runbook.md, Stage E)']
where not exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'anon can upload research files')
  and not has_function_privilege('anon', 'public.submit_paper(text, text, text, boolean, text[], text)', 'execute')
  and not exists (select 1 from supabase_migrations.schema_migrations where name = 'close_legacy_submission_path')
returning version, name;
