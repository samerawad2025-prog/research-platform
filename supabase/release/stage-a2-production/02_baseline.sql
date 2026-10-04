-- Stage A2 — PRODUCTION project mzpkiuovjppmavqkppem — file 02: data baseline (read-only)
-- Source: claude/phase3-release-prep @ 50d7d17f. Open a NEW query, paste this whole file, Run.
-- Expected: one row of hashes and counts, agreements_new = 0, agreements_active = 0. SAVE this result; file 12 must match it.

-- Read-only. Shows no personal data: only hashes, counts and timestamps.
--   data_fingerprint        the Stage A fingerprint (papers, researchers,
--                           authorship, AI history; original columns)
--   records_fingerprint     every column of every row of those four tables
--   agreements_fingerprint  the two existing agreement rows (columns they
--                           had before 0018)
--   acceptances_fingerprint every existing acceptance row (columns it had
--                           before 0018)
-- If someone submits or confirms a paper between files 02 and 12, the
-- fingerprints legitimately differ: max_created / max_confirmed show it.
select
  (select md5(string_agg(t, '|' order by t)) from (
     select concat_ws(',', id, submitted_by, title, title_ar, supervisor_name, year, abstract, abstract_ar, university, faculty, degree_type,
                      document_type, failure_code, file_path, permission_to_process, publication_scope::text, extraction_status,
                      extraction_started_at, metadata_confirmed_at, confirmation_token_hash, last_applied_generation_id, status, admin_notes, created_at) as t from papers
     union all
     select concat_ws(',', id, full_name, email, whatsapp_number, linkedin_url, facebook_url, school, department, graduation_year, created_at) from researchers
     union all
     select concat_ws(',', paper_id, researcher_id, author_order) from paper_researchers
     union all
     select concat_ws(',', id, paper_id, generation_type, provider, model_used, status, result_data::text, notes, created_at) from ai_generations
   ) s) as data_fingerprint,
  (select md5(string_agg(t, '|' order by t)) from (
     select 'p' || to_jsonb(x)::text as t from papers x
     union all select 'r' || to_jsonb(x)::text from researchers x
     union all select 'a' || to_jsonb(x)::text from paper_researchers x
     union all select 'g' || to_jsonb(x)::text from ai_generations x
   ) s) as records_fingerprint,
  (select md5(coalesce(string_agg((to_jsonb(x) - 'external_ai_processing')::text, '|' order by x.id), ''))
     from agreement_versions x where x.id in ('submission-terms-2026-09-25-en', 'submission-terms-2026-09-25-ar')) as agreements_fingerprint,
  (select count(*) from agreement_versions where id not in ('submission-terms-2026-09-25-en', 'submission-terms-2026-09-25-ar')) as agreements_new,
  (select count(*) from agreement_versions where active) as agreements_active,
  (select md5(coalesce(string_agg((to_jsonb(x) - 'processing_choice' - 'ai_processing_terms')::text, '|' order by x.id), ''))
     from submission_acceptances x) as acceptances_fingerprint,
  (select count(*) from submission_acceptances) as acceptances,
  (select count(*) from papers) as papers,
  (select count(*) from researchers) as researchers,
  (select count(*) from ai_generations) as ai_generations,
  (select max(created_at) from papers) as max_created,
  (select max(metadata_confirmed_at) from papers) as max_confirmed,
  (select string_agg(mode, ',') from extraction_policy) as policy;
