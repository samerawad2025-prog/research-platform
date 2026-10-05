-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 07: verify 0019 (read-only)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row, result = PASS. Anything else: STOP — do not record, do not continue.

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
                         || 'submission-terms-2026-10-04-v3-ar:false:gemini_api_unpaid:aef0ced4 submission-terms-2026-10-04-v3-en:false:gemini_api_unpaid:503bcdc5'
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
