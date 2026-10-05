-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 01: preflight (read-only)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row, result = PASS (applied "0011 0012 0013 0015 0016 0017", 28 tables, 2 agreements, 0 active). Anything else: STOP.

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
