-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 10: verify 0020 (read-only)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row, result = PASS. Anything else: STOP — do not record, do not continue.

with g as (
  select
    (select coalesce(string_agg(id || ':' || active || ':' || coalesce(external_ai_processing, '-') || ':' || left(content_sha256, 8), ' ' order by id), '') from agreement_versions) as agreements,
    (select count(*) from agreement_versions where active) as active_agreements,
    (select count(*) from pg_tables where schemaname='public') as tables,
    (select count(*) from submission_acceptances where ai_processing_terms is not null) as acceptances_with_ai_terms,
    (select count(*) from papers where (external_ai_permission(id) ->> 'permitted')::boolean) as readable_papers,
    (select string_agg(mode, ',') from extraction_policy) as policy
), r as (
  select g.*, array_remove(array[
    case when agreements = 'submission-terms-2026-09-25-ar:false:-:54a78f84 submission-terms-2026-09-25-en:false:-:77376e5e '
                         || 'submission-terms-2026-10-04-ar:false:gemini_api_paid:3bcfe8c2 submission-terms-2026-10-04-en:false:gemini_api_paid:468c51eb '
                         || 'submission-terms-2026-10-04-v3-ar:false:gemini_api_unpaid:aef0ced4 submission-terms-2026-10-04-v3-en:false:gemini_api_unpaid:503bcdc5 '
                         || 'submission-terms-2026-10-04-v4-ar:false:gemini_api_unpaid:8b3c313e submission-terms-2026-10-04-v4-en:false:gemini_api_unpaid:fce461b4'
         then null else 'agreement rows differ: '||agreements end,
    case when active_agreements = 0 then null else active_agreements||' agreement(s) active, expected 0' end,
    case when tables = 28 then null else 'public tables '||tables||', expected 28' end,
    case when acceptances_with_ai_terms = 0 then null else acceptances_with_ai_terms||' acceptance(s) record an AI arrangement' end,
    case when readable_papers = 0 then null else readable_papers||' existing paper(s) became readable; expected none' end
  ], null) as reasons from g
)
select case when cardinality(reasons) = 0 then 'PASS' else 'STOP: '||array_to_string(reasons, '; ') end as result,
       tables, active_agreements, readable_papers, policy from r;
