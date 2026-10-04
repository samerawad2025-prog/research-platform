-- ============================================================
-- TEST PROJECT ONLY: qwxfxckrabvuvuzidxuo (Preview verification, H12).
-- NEVER run against production (mzpkiuovjppmavqkppem).
-- Supersedes the paid-only activation script (version 2), which is not to
-- be used: the Gemini API project is free tier.
--
-- Activates submission agreement Version 3 (EN + AR, Google's unpaid
-- terms, migration 0019), deactivates every other submission-terms
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
  -- 1. Migration 0019 is applied here (the unpaid arrangement exists).
  if not exists (select 1 from pg_constraint where conname = 'agreement_versions_external_ai_processing_check'
                 and pg_get_constraintdef(oid) like '%gemini_api_unpaid%') then
    raise exception 'STOP: migration 0019 is not applied here';
  end if;
  -- 2. Both Version 3 rows exist exactly as 0019 seeds them.
  select count(*) into n from agreement_versions
   where (id, agreement_key, language, version_label, content_sha256, external_ai_processing) in (
     ('submission-terms-2026-10-04-v3-en', 'submission-terms', 'en', 'Version 3', '54e064c2880d3b67d44fd632bacff70bf6a8f2d05ab28f9e2f05214dab03b988', 'gemini_api_unpaid'),
     ('submission-terms-2026-10-04-v3-ar', 'submission-terms', 'ar', 'Version 3', '54af258c7255ebad22b50fbfc7a74c7dc2b3b390bc77068813211ee8b232e2e0', 'gemini_api_unpaid'));
  if n <> 2 then raise exception 'STOP: expected both Version 3 rows with their exact hashes, found %', n; end if;
  -- 3. No unexpected submission-terms row would be switched off.
  select count(*) into n from agreement_versions where agreement_key = 'submission-terms'
     and id not in ('submission-terms-2026-09-25-en', 'submission-terms-2026-09-25-ar',
                    'submission-terms-2026-10-04-en', 'submission-terms-2026-10-04-ar',
                    'submission-terms-2026-10-04-v3-en', 'submission-terms-2026-10-04-v3-ar');
  if n <> 0 then raise exception 'STOP: % unexpected submission-terms row(s)', n; end if;
  -- 4. Not production: 0014 is applied on the test project, never yet on production.
  if exists (select 1 from pg_policies where schemaname = 'storage' and policyname = 'anon can upload research files') then
    raise exception 'STOP: this looks like production (the legacy anonymous upload policy is present)';
  end if;
  if (select count(*) from extraction_policy) <> 1 then raise exception 'STOP: extraction_policy must have exactly one row'; end if;
end
$guard$;

update agreement_versions
   set active = (id in ('submission-terms-2026-10-04-v3-en', 'submission-terms-2026-10-04-v3-ar'))
 where agreement_key = 'submission-terms'
   and active is distinct from (id in ('submission-terms-2026-10-04-v3-en', 'submission-terms-2026-10-04-v3-ar'));

update extraction_policy set mode = 'automatic', changed_at = now() where mode is distinct from 'automatic';

commit;

-- Resulting state. Expect: only the two -v3- rows active; policy automatic;
-- acceptances and papers counts as before the script.
select id, agreement_key, language, version_label, active,
       coalesce(external_ai_processing, '-') as external_ai, left(content_sha256, 8) as sha8,
       (select mode from extraction_policy) as policy,
       (select count(*) from submission_acceptances) as acceptances,
       (select count(*) from papers) as papers
  from agreement_versions
 order by id;
