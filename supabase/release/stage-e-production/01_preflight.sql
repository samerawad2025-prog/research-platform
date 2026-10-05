-- Stage E — PRODUCTION project mzpkiuovjppmavqkppem — file 01: preflight (read-only)
-- Source: research-platform after the release merge 15f94476. Open a NEW query, paste this whole file, Run.
-- Expected: one row, result = PASS. Anything else: STOP, do not run file 02.
--
-- 0014's own preconditions: 0012 + 0013 applied; the new application live
-- with the acceptance flow; an agreement version active; a real signed
-- submission completed end to end in production.
with g as (
  select
    to_regclass('public.submission_acceptances') is not null
      and exists (select 1 from information_schema.columns where table_name = 'researchers' and column_name = 'linkedin_public') as has_0012_0013,
    (select string_agg(id, ',' order by id) from agreement_versions where active) as active_agreements,
    (select string_agg(mode, ',') from extraction_policy) as policy,
    (select count(*) from submission_acceptances a join papers p on p.id = a.paper_id
      where a.status = 'finalized' and a.agreement_version_id like 'submission-terms-2026-10-04-v4-%'
        and p.metadata_confirmed_at is not null) as signed_confirmed_v4,
    exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'anon can upload research files') as legacy_upload_open,
    has_function_privilege('anon', 'public.submit_paper(text, text, text, boolean, text[], text)', 'execute') as legacy_submit_open,
    exists (select 1 from supabase_migrations.schema_migrations where name = 'close_legacy_submission_path') as already_recorded,
    (select count(*) from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid() and xact_start < now() - interval '1 minute') as long_transactions
), r as (
  select g.*, array_remove(array[
    case when has_0012_0013 then null else '0012/0013 not applied' end,
    case when active_agreements = 'submission-terms-2026-10-04-v4-ar,submission-terms-2026-10-04-v4-en' then null else 'active agreements: ' || coalesce(active_agreements, 'none') || ', expected the two Version 4 rows' end,
    case when signed_confirmed_v4 >= 1 then null else 'no signed, confirmed Version 4 submission yet' end,
    case when legacy_upload_open and legacy_submit_open then null else 'the legacy path is already (partly) closed: check whether 0014 was applied' end,
    case when not already_recorded then null else '0014 already recorded in the migration history' end,
    case when long_transactions = 0 then null else long_transactions || ' transaction(s) running over a minute' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: ' || array_to_string(reasons, '; ') end as result,
       active_agreements, policy, signed_confirmed_v4, legacy_upload_open, legacy_submit_open from r;
