-- ============================================================
-- 0014: close the legacy anonymous submission path (Phase 3 M2B cutover).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
--
-- DO NOT APPLY until ALL of these are true (docs/submission-flow.md,
-- "Cutover"):
--   - 0011, 0012 and 0013 are applied;
--   - the M2B application is deployed to production with
--     SUBMISSION_ACCEPTANCE_FLOW=enabled and SUBMISSION_TOKEN_SECRET set;
--   - an agreement version is active and a real signed submission has
--     been completed end to end in production.
-- Applied earlier, it breaks the live form: the legacy form uploads with
-- the anonymous role and calls submit_paper from the browser.
--
-- What it does:
--   1. Drops the storage policy that let anyone insert into the papers
--      bucket without an acceptance.
--   2. Revokes EXECUTE on every overload of public.submit_paper from
--      PUBLIC, anon and authenticated (a revoke from anon alone would
--      leave the PUBLIC default grant in force).
--   3. Verifies the effective result and aborts (rolling everything back)
--      if anon or authenticated could still insert into the bucket or
--      execute submit_paper, or if the new path's functions were exposed.
-- The server-side signed flow is unaffected: signed upload authorizations
-- are issued by the service role and do not rely on the anonymous policy
-- (verified on the local Supabase stack: supabase/tests/supabase-cutover.test.js).
--
-- Rollback (emergency only, it reopens the bypass): see the bottom.
-- ============================================================

begin;

do $$
begin
  if to_regclass('public.submission_acceptances') is null
     or not exists (select 1 from information_schema.columns
                    where table_name = 'researchers' and column_name = 'linkedin_public') then
    raise exception '0014 requires migrations 0012 and 0013';
  end if;
end $$;

drop policy if exists "anon can upload research files" on storage.objects;

do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'submit_paper'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
  end loop;
end $$;

-- Effective-permission checks. has_function_privilege includes grants
-- inherited through PUBLIC and role membership.
do $$
declare
  v_bad text;
begin
  select string_agg(format('%s by %s', p.oid::regprocedure, role), ', ') into v_bad
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  cross join unnest(array['anon', 'authenticated']) as role
  where n.nspname = 'public'
    and p.proname in ('submit_paper', 'consume_submission_rate_limit', 'create_submission_intent',
                      'get_submission_intent', 'finalize_submission_intent', 'expire_submission_intents',
                      'mark_submission_object_removed', 'record_upload_authorization', 'record_declared_authors')
    and has_function_privilege(role, p.oid, 'execute');
  if v_bad is not null then
    raise exception '0014: still executable: %', v_bad;
  end if;

  select string_agg(policyname, ', ') into v_bad
  from pg_policies
  where schemaname = 'storage' and tablename = 'objects'
    and cmd in ('INSERT', 'UPDATE', 'ALL')
    and roles && array['public', 'anon', 'authenticated']::name[]
    and (coalesce(with_check, '') || ' ' || coalesce(qual, '')) ~ 'papers';
  if v_bad is not null then
    raise exception '0014: storage policies still allow browser writes to the papers bucket: %', v_bad;
  end if;
end $$;

commit;

-- ------------------------------------------------------------
-- After applying, verify from outside the database (docs/submission-flow.md):
--   - an anonymous upload to the papers bucket is refused;
--   - an anonymous call to submit_paper is refused;
--   - a real signed submission still completes.
--
-- Rollback (EMERGENCY ONLY: this reopens the acceptance bypass; also set
-- SUBMISSION_ACCEPTANCE_FLOW back only if the legacy form is redeployed):
--   begin;
--   create policy "anon can upload research files" on storage.objects
--     for insert to anon with check (bucket_id = 'papers');
--   grant execute on function submit_paper(text, text, text, boolean, text[], text) to anon;
--   commit;
-- ------------------------------------------------------------
