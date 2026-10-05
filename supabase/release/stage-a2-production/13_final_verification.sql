-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 13: final verification (read-only)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row, result = PASS.

-- Read-only. Confirms: all three migrations applied and recorded; every
-- agreement inactive (8 rows, hashes as reviewed); no acceptance gained an AI
-- arrangement; no paper became readable by the AI route; the live
-- application's browser calls (f45dc690) are still open exactly as before.
with g as (
  select
    (select coalesce(string_agg(id || ':' || active || ':' || coalesce(external_ai_processing, '-') || ':' || left(content_sha256, 8), ' ' order by id), '') from agreement_versions) as agreements,
    (select count(*) from agreement_versions where active) as active_agreements,
    (select count(*) from pg_tables where schemaname = 'public') as tables,
    (select count(*) from submission_acceptances where ai_processing_terms is not null or processing_choice is not null) as acceptances_changed,
    (select count(*) from papers where (external_ai_permission(id) ->> 'permitted')::boolean) as readable_papers,
    (select count(*) from supabase_migrations.schema_migrations
      where name in ('ai_processing_agreement', 'gemini_free_tier_agreement', 'free_tier_full_document_agreement')) as recorded,
    (select count(*) from pg_proc where proname = 'create_submission_intent' and pronargs = 17) as intent_17,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('external_ai_permission', 'create_submission_intent', 'finalize_submission_intent')) as browser_can_run_new,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'get_paper_for_confirmation') as confirmation_read_open,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'confirm_researcher_metadata') as confirm_open,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_paper') as legacy_submit_open,
    exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'anon can upload research files') as legacy_upload_open,
    (select string_agg(mode, ',') from extraction_policy) as policy
), r as (
  select g.*, array_remove(array[
    case when agreements = 'submission-terms-2026-09-25-ar:false:-:54a78f84 submission-terms-2026-09-25-en:false:-:77376e5e '
                         || 'submission-terms-2026-10-04-ar:false:gemini_api_paid:3bcfe8c2 submission-terms-2026-10-04-en:false:gemini_api_paid:468c51eb '
                         || 'submission-terms-2026-10-04-v3-ar:false:gemini_api_unpaid:aef0ced4 submission-terms-2026-10-04-v3-en:false:gemini_api_unpaid:503bcdc5 '
                         || 'submission-terms-2026-10-04-v4-ar:false:gemini_api_unpaid:8b3c313e submission-terms-2026-10-04-v4-en:false:gemini_api_unpaid:fce461b4'
         then null else 'agreement rows differ: ' || agreements end,
    case when active_agreements = 0 then null else active_agreements || ' agreement(s) active, expected 0' end,
    case when tables = 28 then null else 'public tables ' || tables || ', expected 28' end,
    case when acceptances_changed = 0 then null else acceptances_changed || ' acceptance(s) carry new AI fields' end,
    case when readable_papers = 0 then null else readable_papers || ' paper(s) readable by the AI route' end,
    case when recorded = 3 then null else recorded || ' of 3 migrations recorded in the history' end,
    case when intent_17 = 1 then null else 'create_submission_intent (17 arguments) missing' end,
    case when not browser_can_run_new then null else 'a browser role can run a service-only function' end,
    case when confirmation_read_open and confirm_open then null else 'the live confirmation page''s functions are not callable' end,
    case when legacy_submit_open and legacy_upload_open then null else 'the live submission form''s path (submit_paper + anonymous upload) is not open' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: ' || array_to_string(reasons, '; ') end as result,
       active_agreements, readable_papers, recorded, policy from r;
