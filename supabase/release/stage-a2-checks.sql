-- ============================================================
-- Stage A2 checks: migrations 0018 and 0019 on the production database
-- (docs/release-runbook.md, "Stage A2"). Read-only. Paste ONE block at a
-- time into the SQL Editor; each returns one row whose first column is
-- PASS, or STOP: followed by the reasons.
--   * PREFLIGHT A2 before 0018.
--   * The DATA FINGERPRINT block of stage-a-checks.sql before 0018 and
--     after 0019: neither changes an existing value, so the two must be
--     identical unless a real submission or confirmation happened between.
--   * AFTER 0018 right after the 0018 file; AFTER 0019 right after 0019.
-- ============================================================

-- ===================== PREFLIGHT A2 =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='agreement_versions' and column_name='external_ai_processing') then '0018' end,
      case when exists(select 1 from pg_constraint where conname='agreement_versions_external_ai_processing_check' and pg_get_constraintdef(oid) like '%gemini_api_unpaid%') then '0019' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from agreement_versions) as agreements,
    (select count(*) from agreement_versions where active) as active_agreements,
    (select count(*) from submission_acceptances) as acceptances,
    (select count(*) from pg_proc where proname = 'create_submission_intent') as intent_functions,
    (select count(*) from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid() and xact_start < now() - interval '1 minute') as long_transactions,
    (select string_agg(mode, ',') from extraction_policy) as policy
), r as (
  select g.*, array_remove(array[
    case when applied = '0011 0012 0013 0015 0016 0017' then null else 'fingerprint is "'||applied||'", expected "0011 0012 0013 0015 0016 0017"' end,
    case when tables = 28 then null else 'public tables '||tables||', expected 28' end,
    case when agreements = 2 and active_agreements = 0 then null else 'agreement_versions: '||agreements||' rows, '||active_agreements||' active; expected 2 rows, 0 active' end,
    case when intent_functions = 1 then null else intent_functions||' create_submission_intent functions, expected 1' end,
    case when long_transactions = 0 then null else long_transactions||' transaction(s) running over a minute' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, agreements, acceptances, policy from r;

-- ===================== AFTER 0018 =====================
with g as (
  select
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='agreement_versions' and column_name='external_ai_processing') as column_added,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select coalesce(string_agg(id || ':' || active || ':' || coalesce(external_ai_processing, '-') || ':' || left(content_sha256, 8), ' ' order by id), '') from agreement_versions) as agreements,
    (select count(*) from agreement_versions where active) as active_agreements,
    (select count(*) from pg_proc where proname = 'create_submission_intent') as intent_functions,
    (select count(*) from pg_proc where proname = 'create_submission_intent' and pronargs = 17) as intent_17,
    exists(select 1 from pg_proc where proname = 'external_ai_permission') as permission_function,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('external_ai_permission', 'create_submission_intent', 'finalize_submission_intent')) as browser_can_run_new,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_paper_for_confirmation') as confirmation_read_open,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_paper') as legacy_rpc,
    exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') as legacy_upload,
    (select count(*) from papers where (external_ai_permission(id) ->> 'permitted')::boolean) as readable_papers,
    (select string_agg(mode, ',') from extraction_policy) as policy
), r as (
  select g.*, array_remove(array[
    case when column_added then null else 'external_ai_processing column missing' end,
    case when tables = 28 then null else 'public tables '||tables||', expected 28 (0018 adds no table)' end,
    case when agreements = 'submission-terms-2026-09-25-ar:false:-:54a78f84 submission-terms-2026-09-25-en:false:-:77376e5e '
                         || 'submission-terms-2026-10-04-ar:false:gemini_api_paid:3bcfe8c2 submission-terms-2026-10-04-en:false:gemini_api_paid:468c51eb'
         then null else 'agreement rows differ: '||agreements end,
    case when active_agreements = 0 then null else active_agreements||' agreement(s) active, expected 0' end,
    case when intent_functions = 1 and intent_17 = 1 then null else 'create_submission_intent: '||intent_functions||' function(s), '||intent_17||' with 17 arguments; expected exactly the new one' end,
    case when permission_function then null else 'external_ai_permission missing' end,
    case when not browser_can_run_new then null else 'a browser role can run a service-only function' end,
    case when confirmation_read_open then null else 'get_paper_for_confirmation is no longer callable by the browser (the live confirmation page needs it)' end,
    case when legacy_rpc and legacy_upload then null else 'old anonymous path not in its expected open state' end,
    case when readable_papers = 0 then null else readable_papers||' existing paper(s) became readable; expected none' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       tables, active_agreements, readable_papers, policy from r;

-- ===================== AFTER 0019 =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='agreement_versions' and column_name='external_ai_processing') then '0018' end,
      case when exists(select 1 from pg_constraint where conname='agreement_versions_external_ai_processing_check' and pg_get_constraintdef(oid) like '%gemini_api_unpaid%') then '0019' end) as applied,
    exists(select 1 from pg_constraint where conname='submission_acceptances_ai_processing_terms_check' and pg_get_constraintdef(oid) like '%gemini_api_unpaid%') as acceptance_constraint,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select coalesce(string_agg(id || ':' || active || ':' || coalesce(external_ai_processing, '-') || ':' || left(content_sha256, 8), ' ' order by id), '') from agreement_versions) as agreements,
    (select count(*) from agreement_versions where active) as active_agreements,
    (select count(*) from pg_proc where proname = 'create_submission_intent' and pronargs = 17) as intent_17,
    (select count(*) from pg_proc where proname = 'create_submission_intent') as intent_functions,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname in ('external_ai_permission', 'create_submission_intent', 'finalize_submission_intent')) as browser_can_run_new,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_paper_for_confirmation') as confirmation_read_open,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_paper') as legacy_rpc,
    exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') as legacy_upload,
    (select count(*) from submission_acceptances where ai_processing_terms is not null) as acceptances_with_ai_terms,
    (select count(*) from papers where (external_ai_permission(id) ->> 'permitted')::boolean) as readable_papers,
    (select string_agg(mode, ',') from extraction_policy) as policy
), r as (
  select g.*, array_remove(array[
    case when applied = '0018 0019' then null else 'fingerprint is "'||applied||'", expected "0018 0019"' end,
    case when acceptance_constraint then null else 'submission_acceptances.ai_processing_terms does not allow gemini_api_unpaid' end,
    case when tables = 28 then null else 'public tables '||tables||', expected 28 (0019 adds no table)' end,
    case when agreements = 'submission-terms-2026-09-25-ar:false:-:54a78f84 submission-terms-2026-09-25-en:false:-:77376e5e '
                         || 'submission-terms-2026-10-04-ar:false:gemini_api_paid:3bcfe8c2 submission-terms-2026-10-04-en:false:gemini_api_paid:468c51eb '
                         || 'submission-terms-2026-10-04-v3-ar:false:gemini_api_unpaid:54af258c submission-terms-2026-10-04-v3-en:false:gemini_api_unpaid:54e064c2'
         then null else 'agreement rows differ: '||agreements end,
    case when active_agreements = 0 then null else active_agreements||' agreement(s) active, expected 0' end,
    case when intent_functions = 1 and intent_17 = 1 then null else 'create_submission_intent: '||intent_functions||' function(s), '||intent_17||' with 17 arguments' end,
    case when not browser_can_run_new then null else 'a browser role can run a service-only function' end,
    case when confirmation_read_open then null else 'get_paper_for_confirmation is no longer callable by the browser (the live confirmation page needs it)' end,
    case when legacy_rpc and legacy_upload then null else 'old anonymous path not in its expected open state' end,
    case when acceptances_with_ai_terms = 0 then null else acceptances_with_ai_terms||' acceptance(s) record an AI arrangement; expected none before any version is active' end,
    case when readable_papers = 0 then null else readable_papers||' existing paper(s) became readable; expected none' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       tables, active_agreements, readable_papers, policy from r;
