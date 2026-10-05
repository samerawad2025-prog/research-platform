-- Stage E — PRODUCTION project mzpkiuovjppmavqkppem — file 03: verify 0014 (read-only)
-- Open a NEW query, paste this whole file, Run.
-- Expected: one row, result = PASS. Anything else: STOP — do not run file 04; send me the result.
with g as (
  select
    exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'anon can upload research files') as legacy_upload_policy,
    (select coalesce(bool_or(has_function_privilege(role, p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join unnest(array['anon', 'authenticated']) as role
      where n.nspname = 'public' and p.proname = 'submit_paper') as browser_submit_paper,
    (select coalesce(bool_or(has_function_privilege(role, p.oid, 'execute')), false)
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace cross join unnest(array['anon', 'authenticated']) as role
      where n.nspname = 'public' and p.proname in ('create_submission_intent', 'finalize_submission_intent', 'external_ai_permission')) as browser_new_path_functions,
    has_function_privilege('anon', 'public.get_paper_for_confirmation(text)', 'execute') as confirmation_read_open,
    has_function_privilege('anon', 'public.confirm_researcher_metadata(text, jsonb, jsonb)', 'execute') as confirm_open,
    (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) as storage_rls,
    (select count(*) from agreement_versions where active) as active_agreements,
    (select string_agg(mode, ',') from extraction_policy) as policy
), r as (
  select g.*, array_remove(array[
    case when not legacy_upload_policy then null else 'anonymous upload policy still present' end,
    case when not browser_submit_paper then null else 'a browser role can still run submit_paper' end,
    case when not browser_new_path_functions then null else 'a browser role can run a service-only function' end,
    case when confirmation_read_open and confirm_open then null else 'the confirmation page functions are no longer callable' end,
    case when storage_rls then null else 'row level security is off on storage.objects' end,
    case when active_agreements = 2 then null else active_agreements || ' active agreement(s), expected the two Version 4 rows' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: ' || array_to_string(reasons, '; ') end as result,
       legacy_upload_policy, browser_submit_paper, confirmation_read_open, active_agreements, policy from r;
