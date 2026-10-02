-- Stage A checks (docs/release-runbook.md, "Stage A — exact procedure").
--
-- READ-ONLY. Each block is one SELECT that returns a single row whose first
-- column, `result`, is either PASS or STOP: <reasons>. Paste ONE block at a
-- time into Supabase → SQL Editor (production project) and Run.
--   * PREFLIGHT before applying anything;
--   * AFTER 0011 … AFTER 0017 right after the matching migration file.
-- STOP means: do not run the next migration; report the reasons.
--
-- Common conditions in every block:
--   - the migration fingerprint is exactly the expected one;
--   - the number of public tables is exactly the expected one;
--   - every public table has RLS on and no public-schema policy exists;
--   - the old anonymous path is still OPEN (Stage A must not close it;
--     0014 is applied much later): anon can run submit_paper and the
--     storage policy "anon can upload research files" is the only one;
--   - the papers bucket is private;
--   - browser roles (anon, authenticated) can execute no public function
--     outside the known set, and hold no grant on any table outside the
--     six original ones (which are protected by RLS with no policies);
--   - no data was lost: papers >= 35, researchers >= 55,
--     paper_researchers >= 50, ai_generations >= 70 (production counts on
--     2026-10-02; they may only grow).

-- ===================== PREFLIGHT =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as no_rls,
    (select count(*) from pg_policies where schemaname='public') as public_policies,
    (select coalesce(string_agg(policyname::text, '|' order by policyname::text), '') from pg_policies where schemaname='storage') as storage_policies,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_paper') as legacy_rpc,
    (select public from storage.buckets where id='papers') as bucket_public,
    (select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         and p.proname not in ('confirm_researcher_metadata','get_paper_for_confirmation','normalize_year_text','prevent_premature_publish','stamp_submission_extraction_policy','submit_paper')) as unexpected_functions,
    (select coalesce(string_agg(distinct table_name::text, ',' order by table_name::text), '') from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated') and table_name not in ('ai_generations','article_versions','articles','paper_researchers','papers','researchers')) as unexpected_tables,
    (select count(*) from papers) as papers, (select count(*) from researchers) as researchers,
    (select count(*) from paper_researchers) as links, (select count(*) from ai_generations) as ai_generations,
    (select extnamespace::regnamespace::text from pg_extension where extname='pgcrypto') as pgcrypto_schema,
    to_regclass('auth.users') is not null as auth_users_table,
    (select count(*) from pg_stat_activity where state <> 'idle' and pid <> pg_backend_pid() and xact_start < now() - interval '1 minute') as long_transactions
), r as (
  select g.*, array_remove(array[
    case when applied = '' then null else 'fingerprint is "'||applied||'", expected nothing applied' end,
    case when tables = 6 then null else 'public tables '||tables||', expected 6' end,
    case when pgcrypto_schema = 'extensions' then null else 'pgcrypto not in schema extensions' end,
    case when auth_users_table then null else 'auth.users missing' end,
    case when long_transactions = 0 then null else long_transactions||' transaction(s) running over a minute' end,
    case when no_rls = 0 and public_policies = 0 then null else 'RLS/policy state changed' end,
    case when legacy_rpc and storage_policies = 'anon can upload research files' then null else 'old anonymous path not in its expected open state' end,
    case when bucket_public is false then null else 'papers bucket is not private' end,
    case when unexpected_functions = '' then null else 'browser roles can execute: '||unexpected_functions end,
    case when unexpected_tables = '' then null else 'browser roles hold grants on: '||unexpected_tables end,
    case when papers >= 35 and researchers >= 55 and links >= 50 and ai_generations >= 70 then null else 'row counts below the 2026-10-02 production counts' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, papers, researchers, links, ai_generations from r;

-- ===================== AFTER 0011 =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as no_rls,
    (select count(*) from pg_policies where schemaname='public') as public_policies,
    (select coalesce(string_agg(policyname::text, '|' order by policyname::text), '') from pg_policies where schemaname='storage') as storage_policies,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_paper') as legacy_rpc,
    (select public from storage.buckets where id='papers') as bucket_public,
    (select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         and p.proname not in ('confirm_researcher_metadata','get_paper_for_confirmation','normalize_year_text','prevent_premature_publish','stamp_submission_extraction_policy','submit_paper')) as unexpected_functions,
    (select coalesce(string_agg(distinct table_name::text, ',' order by table_name::text), '') from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated') and table_name not in ('ai_generations','article_versions','articles','paper_researchers','papers','researchers')) as unexpected_tables,
    (select count(*) from papers) as papers, (select count(*) from researchers) as researchers,
    (select count(*) from paper_researchers) as links, (select count(*) from ai_generations) as ai_generations,
    (select string_agg(mode, ',') from extraction_policy) as policy,
    exists(select 1 from pg_trigger where tgname = 'papers_stamp_extraction_policy' and not tgisinternal) as stamp_trigger,
    (select count(*) from papers where manual_entry_at is not null or submission_extraction_policy is not null) as existing_papers_touched
), r as (
  select g.*, array_remove(array[
    case when applied = '0011' then null else 'fingerprint is "'||applied||'", expected "0011"' end,
    case when tables = 7 then null else 'public tables '||tables||', expected 7' end,
    case when policy = 'manual' then null else 'extraction_policy is "'||coalesce(policy,'missing')||'", expected one row "manual"' end,
    case when stamp_trigger then null else 'stamp trigger missing' end,
    case when existing_papers_touched = 0 then null else existing_papers_touched||' existing papers were modified' end,
    case when no_rls = 0 and public_policies = 0 then null else 'RLS/policy state changed' end,
    case when legacy_rpc and storage_policies = 'anon can upload research files' then null else 'old anonymous path not in its expected open state' end,
    case when bucket_public is false then null else 'papers bucket is not private' end,
    case when unexpected_functions = '' then null else 'browser roles can execute: '||unexpected_functions end,
    case when unexpected_tables = '' then null else 'browser roles hold grants on: '||unexpected_tables end,
    case when papers >= 35 and researchers >= 55 and links >= 50 and ai_generations >= 70 then null else 'row counts below the 2026-10-02 production counts' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, papers, researchers, links, ai_generations from r;

-- ===================== AFTER 0012 =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as no_rls,
    (select count(*) from pg_policies where schemaname='public') as public_policies,
    (select coalesce(string_agg(policyname::text, '|' order by policyname::text), '') from pg_policies where schemaname='storage') as storage_policies,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_paper') as legacy_rpc,
    (select public from storage.buckets where id='papers') as bucket_public,
    (select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         and p.proname not in ('confirm_researcher_metadata','get_paper_for_confirmation','normalize_year_text','prevent_premature_publish','stamp_submission_extraction_policy','submit_paper')) as unexpected_functions,
    (select coalesce(string_agg(distinct table_name::text, ',' order by table_name::text), '') from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated') and table_name not in ('ai_generations','article_versions','articles','paper_researchers','papers','researchers')) as unexpected_tables,
    (select count(*) from papers) as papers, (select count(*) from researchers) as researchers,
    (select count(*) from paper_researchers) as links, (select count(*) from ai_generations) as ai_generations,
    (select count(*) from agreement_versions) as agreements,
    (select count(*) from agreement_versions where active) as active_agreements,
    (select count(*) from submission_acceptances) as acceptances,
    (select count(*) from papers where submission_acceptance_id is not null or publication_setting is not null or file_sha256 is not null) as existing_papers_touched
), r as (
  select g.*, array_remove(array[
    case when applied = '0011 0012' then null else 'fingerprint is "'||applied||'", expected "0011 0012"' end,
    case when tables = 10 then null else 'public tables '||tables||', expected 10' end,
    case when agreements = 2 and active_agreements = 0 then null else 'agreement_versions: '||agreements||' rows, '||active_agreements||' active; expected 2 rows, 0 active' end,
    case when acceptances = 0 then null else 'submission_acceptances is not empty' end,
    case when existing_papers_touched = 0 then null else existing_papers_touched||' existing papers were modified' end,
    case when no_rls = 0 and public_policies = 0 then null else 'RLS/policy state changed' end,
    case when legacy_rpc and storage_policies = 'anon can upload research files' then null else 'old anonymous path not in its expected open state' end,
    case when bucket_public is false then null else 'papers bucket is not private' end,
    case when unexpected_functions = '' then null else 'browser roles can execute: '||unexpected_functions end,
    case when unexpected_tables = '' then null else 'browser roles hold grants on: '||unexpected_tables end,
    case when papers >= 35 and researchers >= 55 and links >= 50 and ai_generations >= 70 then null else 'row counts below the 2026-10-02 production counts' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, papers, researchers, links, ai_generations from r;

-- ===================== AFTER 0013 =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as no_rls,
    (select count(*) from pg_policies where schemaname='public') as public_policies,
    (select coalesce(string_agg(policyname::text, '|' order by policyname::text), '') from pg_policies where schemaname='storage') as storage_policies,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_paper') as legacy_rpc,
    (select public from storage.buckets where id='papers') as bucket_public,
    (select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         and p.proname not in ('confirm_researcher_metadata','get_paper_for_confirmation','normalize_year_text','prevent_premature_publish','stamp_submission_extraction_policy','submit_paper')) as unexpected_functions,
    (select coalesce(string_agg(distinct table_name::text, ',' order by table_name::text), '') from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated') and table_name not in ('ai_generations','article_versions','articles','paper_researchers','papers','researchers')) as unexpected_tables,
    (select count(*) from papers) as papers, (select count(*) from researchers) as researchers,
    (select count(*) from paper_researchers) as links, (select count(*) from ai_generations) as ai_generations,
    (select count(*) from researchers where linkedin_public) as linkedin_public_true,
    exists(select 1 from information_schema.columns where table_schema='public' and table_name='submission_acceptances' and column_name='declared_authors') as declared_authors_column,
    (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='confirm_researcher_metadata') as confirm_overloads
), r as (
  select g.*, array_remove(array[
    case when applied = '0011 0012 0013' then null else 'fingerprint is "'||applied||'", expected "0011 0012 0013"' end,
    case when tables = 10 then null else 'public tables '||tables||', expected 10' end,
    case when linkedin_public_true = 0 then null else linkedin_public_true||' researchers made LinkedIn-public' end,
    case when declared_authors_column then null else 'submission_acceptances.declared_authors missing' end,
    case when confirm_overloads = 1 then null else confirm_overloads||' confirm_researcher_metadata overloads, expected 1' end,
    case when no_rls = 0 and public_policies = 0 then null else 'RLS/policy state changed' end,
    case when legacy_rpc and storage_policies = 'anon can upload research files' then null else 'old anonymous path not in its expected open state' end,
    case when bucket_public is false then null else 'papers bucket is not private' end,
    case when unexpected_functions = '' then null else 'browser roles can execute: '||unexpected_functions end,
    case when unexpected_tables = '' then null else 'browser roles hold grants on: '||unexpected_tables end,
    case when papers >= 35 and researchers >= 55 and links >= 50 and ai_generations >= 70 then null else 'row counts below the 2026-10-02 production counts' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, papers, researchers, links, ai_generations from r;

-- ===================== AFTER 0015 =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as no_rls,
    (select count(*) from pg_policies where schemaname='public') as public_policies,
    (select coalesce(string_agg(policyname::text, '|' order by policyname::text), '') from pg_policies where schemaname='storage') as storage_policies,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_paper') as legacy_rpc,
    (select public from storage.buckets where id='papers') as bucket_public,
    (select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         and p.proname not in ('confirm_researcher_metadata','get_paper_for_confirmation','normalize_year_text','prevent_premature_publish','stamp_submission_extraction_policy','submit_paper')) as unexpected_functions,
    (select coalesce(string_agg(distinct table_name::text, ',' order by table_name::text), '') from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated') and table_name not in ('ai_generations','article_versions','articles','paper_researchers','papers','researchers')) as unexpected_tables,
    (select count(*) from papers) as papers, (select count(*) from researchers) as researchers,
    (select count(*) from paper_researchers) as links, (select count(*) from ai_generations) as ai_generations,
    (select count(*) from staff_members) as staff,
    (select count(*) from institutions where public_collection_eligible) as eligible_institutions,
    (select count(*) from academic_units) as units,
    (select count(*) from confidentiality_versions where active) as active_confidentiality,
    (select bool_and(active) from release_restrictions where key = 'fulltext_legal_advice') as fulltext_restricted,
    (select count(*) from review_approvals) as approvals,
    (select coalesce(bool_or(has_function_privilege(r, p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace,
       unnest(array['anon','authenticated','service_role']) r where n.nspname='public' and p.proname='bootstrap_first_administrator') as bootstrap_reachable
), r as (
  select g.*, array_remove(array[
    case when applied = '0011 0012 0013 0015' then null else 'fingerprint is "'||applied||'", expected "0011 0012 0013 0015"' end,
    case when tables = 25 then null else 'public tables '||tables||', expected 25' end,
    case when staff = 0 then null else 'staff_members is not empty' end,
    case when eligible_institutions = 1 and units = 21 then null else 'institutions/units seed: '||eligible_institutions||' eligible, '||units||' units; expected 1 and 21' end,
    case when active_confidentiality = 0 then null else 'a confidentiality version is active' end,
    case when fulltext_restricted then null else 'full-text release restriction is not active' end,
    case when approvals = 0 then null else 'review_approvals is not empty' end,
    case when not bootstrap_reachable then null else 'bootstrap_first_administrator is executable by an API role' end,
    case when no_rls = 0 and public_policies = 0 then null else 'RLS/policy state changed' end,
    case when legacy_rpc and storage_policies = 'anon can upload research files' then null else 'old anonymous path not in its expected open state' end,
    case when bucket_public is false then null else 'papers bucket is not private' end,
    case when unexpected_functions = '' then null else 'browser roles can execute: '||unexpected_functions end,
    case when unexpected_tables = '' then null else 'browser roles hold grants on: '||unexpected_tables end,
    case when papers >= 35 and researchers >= 55 and links >= 50 and ai_generations >= 70 then null else 'row counts below the 2026-10-02 production counts' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, papers, researchers, links, ai_generations from r;

-- ===================== AFTER 0016 =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as no_rls,
    (select count(*) from pg_policies where schemaname='public') as public_policies,
    (select coalesce(string_agg(policyname::text, '|' order by policyname::text), '') from pg_policies where schemaname='storage') as storage_policies,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_paper') as legacy_rpc,
    (select public from storage.buckets where id='papers') as bucket_public,
    (select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         and p.proname not in ('confirm_researcher_metadata','get_paper_for_confirmation','normalize_year_text','prevent_premature_publish','stamp_submission_extraction_policy','submit_paper')) as unexpected_functions,
    (select coalesce(string_agg(distinct table_name::text, ',' order by table_name::text), '') from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated') and table_name not in ('ai_generations','article_versions','articles','paper_researchers','papers','researchers')) as unexpected_tables,
    (select count(*) from papers) as papers, (select count(*) from researchers) as researchers,
    (select count(*) from paper_researchers) as links, (select count(*) from ai_generations) as ai_generations,
    (select count(*) from public_records) as public_records,
    exists(select 1 from pg_trigger where tgname = 'review_approvals_public_id' and not tgisinternal) as public_id_trigger
), r as (
  select g.*, array_remove(array[
    case when applied = '0011 0012 0013 0015 0016' then null else 'fingerprint is "'||applied||'", expected "0011 0012 0013 0015 0016"' end,
    case when tables = 26 then null else 'public tables '||tables||', expected 26' end,
    case when public_records = 0 then null else 'public_records is not empty' end,
    case when public_id_trigger then null else 'public id trigger missing' end,
    case when no_rls = 0 and public_policies = 0 then null else 'RLS/policy state changed' end,
    case when legacy_rpc and storage_policies = 'anon can upload research files' then null else 'old anonymous path not in its expected open state' end,
    case when bucket_public is false then null else 'papers bucket is not private' end,
    case when unexpected_functions = '' then null else 'browser roles can execute: '||unexpected_functions end,
    case when unexpected_tables = '' then null else 'browser roles hold grants on: '||unexpected_tables end,
    case when papers >= 35 and researchers >= 55 and links >= 50 and ai_generations >= 70 then null else 'row counts below the 2026-10-02 production counts' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, papers, researchers, links, ai_generations from r;

-- ===================== AFTER 0017 (end of Stage A) =====================
with g as (
  select
    concat_ws(' ',
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='papers' and column_name='manual_entry_at') then '0011' end,
      case when to_regclass('public.agreement_versions') is not null then '0012' end,
      case when exists(select 1 from information_schema.columns where table_schema='public' and table_name='researchers' and column_name='linkedin_public') then '0013' end,
      case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
      case when to_regclass('public.staff_members') is not null then '0015' end,
      case when to_regclass('public.public_records') is not null then '0016' end,
      case when to_regclass('public.activity_counts') is not null then '0017' end) as applied,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from pg_tables where schemaname='public' and not rowsecurity) as no_rls,
    (select count(*) from pg_policies where schemaname='public') as public_policies,
    (select coalesce(string_agg(policyname::text, '|' order by policyname::text), '') from pg_policies where schemaname='storage') as storage_policies,
    (select coalesce(bool_or(has_function_privilege('anon', p.oid, 'execute')), false) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='submit_paper') as legacy_rpc,
    (select public from storage.buckets where id='papers') as bucket_public,
    (select coalesce(string_agg(distinct p.proname::text, ',' order by p.proname::text), '') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute'))
         and p.proname not in ('confirm_researcher_metadata','get_paper_for_confirmation','normalize_year_text','prevent_premature_publish','stamp_submission_extraction_policy','submit_paper')) as unexpected_functions,
    (select coalesce(string_agg(distinct table_name::text, ',' order by table_name::text), '') from information_schema.role_table_grants
       where table_schema='public' and grantee in ('anon','authenticated') and table_name not in ('ai_generations','article_versions','articles','paper_researchers','papers','researchers')) as unexpected_tables,
    (select count(*) from papers) as papers, (select count(*) from researchers) as researchers,
    (select count(*) from paper_researchers) as links, (select count(*) from ai_generations) as ai_generations,
    (select count(*) from activity_counts) + (select count(*) from activity_dedup) as activity_rows,
    has_function_privilege('service_role', 'public.activity_purge_expired()', 'execute') as purge_reachable,
    (select string_agg(mode, ',') from extraction_policy) as policy,
    (select count(*) from agreement_versions where active) as active_agreements
), r as (
  select g.*, array_remove(array[
    case when applied = '0011 0012 0013 0015 0016 0017' then null else 'fingerprint is "'||applied||'", expected "0011 0012 0013 0015 0016 0017"' end,
    case when tables = 28 then null else 'public tables '||tables||', expected 28' end,
    case when activity_rows = 0 then null else 'activity tables are not empty' end,
    case when not purge_reachable then null else 'activity_purge_expired is executable by service_role' end,
    case when policy = 'manual' and active_agreements = 0 then null else 'policy/agreements changed' end,
    case when no_rls = 0 and public_policies = 0 then null else 'RLS/policy state changed' end,
    case when legacy_rpc and storage_policies = 'anon can upload research files' then null else 'old anonymous path not in its expected open state' end,
    case when bucket_public is false then null else 'papers bucket is not private' end,
    case when unexpected_functions = '' then null else 'browser roles can execute: '||unexpected_functions end,
    case when unexpected_tables = '' then null else 'browser roles hold grants on: '||unexpected_tables end,
    case when papers >= 35 and researchers >= 55 and links >= 50 and ai_generations >= 70 then null else 'row counts below the 2026-10-02 production counts' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       applied, tables, papers, researchers, links, ai_generations from r;

-- ===================== DATA FINGERPRINT (run at PREFLIGHT and AFTER 0017) =====================
-- One md5 over every original column of the four existing tables. Stage A
-- adds columns and tables but must not change a single existing value, so the
-- two results must be identical. (If someone submitted or confirmed a paper
-- between the two runs, they legitimately differ: check max_created and
-- max_confirmed, which are shown for that reason.) Shows no personal data.
select md5(string_agg(t, '|' order by t)) as data_fingerprint,
       (select count(*) from papers) as papers,
       (select max(created_at) from papers) as max_created,
       (select max(metadata_confirmed_at) from papers) as max_confirmed
from (
  select concat_ws(',', id, submitted_by, title, title_ar, supervisor_name, year, abstract, abstract_ar, university, faculty, degree_type,
                   document_type, failure_code, file_path, permission_to_process, publication_scope::text, extraction_status,
                   extraction_started_at, metadata_confirmed_at, confirmation_token_hash, last_applied_generation_id, status, admin_notes, created_at) as t from papers
  union all
  select concat_ws(',', id, full_name, email, whatsapp_number, linkedin_url, facebook_url, school, department, graduation_year, created_at) from researchers
  union all
  select concat_ws(',', paper_id, researcher_id, author_order) from paper_researchers
  union all
  select concat_ws(',', id, paper_id, generation_type, provider, model_used, status, result_data::text, notes, created_at) from ai_generations
) s;
