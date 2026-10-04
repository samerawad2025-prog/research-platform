-- ============================================================
-- TEST PROJECT ONLY: qwxfxckrabvuvuzidxuo (Preview verification, H12).
-- NEVER run against production (mzpkiuovjppmavqkppem).
-- Supersedes the version 2 (paid) and version 3 (excerpt-only) activation
-- scripts, which are not to be used.
--
-- Activates submission agreement Version 4 (EN + AR, Google's unpaid
-- terms, migration 0020), deactivates every other submission-terms
-- version, and sets the test extraction policy to automatic.
-- Changes only the `active` flag of agreement_key = 'submission-terms' rows
-- and the one extraction_policy row. Hashes, labels, arrangements, other
-- agreement keys and every acceptance record are untouched.
-- Any failed check raises and the whole transaction rolls back.
-- ============================================================
begin;

do $guard$
declare n int;
begin
  -- 1. Migration 0020 is applied here (version 4 exists).
  if not exists (select 1 from agreement_versions where id = 'submission-terms-2026-10-04-v4-en') then
    raise exception 'STOP: migration 0020 is not applied here';
  end if;
  -- 2. Both Version 4 rows exist exactly as 0020 seeds them.
  select count(*) into n from agreement_versions
   where (id, agreement_key, language, version_label, content_sha256, external_ai_processing) in (
     ('submission-terms-2026-10-04-v4-en', 'submission-terms', 'en', 'Version 4', 'fce461b4b47389de736e1d30bee44df48c3f3dd15fd6d3f14d7959059fc184c7', 'gemini_api_unpaid'),
     ('submission-terms-2026-10-04-v4-ar', 'submission-terms', 'ar', 'Version 4', '8b3c313eab99789b36226fb246f04628fd21f970777dee7e470cf06b92511231', 'gemini_api_unpaid'));
  if n <> 2 then raise exception 'STOP: expected both Version 4 rows with their exact hashes, found %', n; end if;
  -- 3. No unexpected submission-terms row would be switched off.
  select count(*) into n from agreement_versions where agreement_key = 'submission-terms'
     and id not in ('submission-terms-2026-09-25-en', 'submission-terms-2026-09-25-ar',
                    'submission-terms-2026-10-04-en', 'submission-terms-2026-10-04-ar',
                    'submission-terms-2026-10-04-v4-en', 'submission-terms-2026-10-04-v4-ar');
  if n <> 0 then raise exception 'STOP: % unexpected submission-terms row(s)', n; end if;
  -- 4. Not production: 0014 is applied on the test project, never yet on production.
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'anon can upload research files') then
    raise exception 'STOP: this looks like production (the legacy anonymous upload policy is present)';
  end if;
  if (select count(*) from extraction_policy) <> 1 then raise exception 'STOP: extraction_policy must have exactly one row'; end if;
end
$guard$;

update agreement_versions
   set active = (id in ('submission-terms-2026-10-04-v4-en', 'submission-terms-2026-10-04-v4-ar'))
 where agreement_key = 'submission-terms'
   and active is distinct from (id in ('submission-terms-2026-10-04-v4-en', 'submission-terms-2026-10-04-v4-ar'));

update extraction_policy set mode = 'automatic', changed_at = now() where mode is distinct from 'automatic';

commit;

-- Resulting state. Expect: only the two -v4- rows active; policy automatic;
-- acceptances and papers counts as before the script.
select id, agreement_key, language, version_label, active,
       coalesce(external_ai_processing, '-') as external_ai, left(content_sha256, 8) as sha8,
       (select mode from extraction_policy) as policy,
       (select count(*) from submission_acceptances) as acceptances,
       (select count(*) from papers) as papers
  from agreement_versions
 order by id;
