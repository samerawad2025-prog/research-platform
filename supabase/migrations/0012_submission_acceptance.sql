-- ============================================================
-- 0012: server-controlled acceptance and upload foundation (Phase 3, M2A).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0011. Additive: no existing row, policy or grant changes, and
-- nothing here is reachable by the anonymous role.
--
-- Adds the backend for the new submission path:
--   1. accept the agreement and choose a publication setting (server
--      validates, records an acceptance with a server timestamp),
--   2. upload the document to a private, server-chosen path,
--   3. finalize: the server checks the object and creates the paper
--      exactly once, bound to the acceptance and the document's hash.
--
-- The old anonymous path (storage INSERT policy + submit_paper granted to
-- anon) is deliberately LEFT IN PLACE: the live form still uses it. It is
-- closed in a later migration, after the M2B interface is verified. Until
-- then this migration alone does not secure anything in production.
--
-- The new path is inert in production after this migration:
--   - agreement_versions rows are seeded with active = false, and
--   - the application only serves the new endpoints when
--     SUBMISSION_ACCEPTANCE_FLOW=enabled is set.
--
-- Processing decision (one authority). papers.submission_extraction_policy
-- (from 0011) stays the single, immutable record of whether a paper may be
-- processed automatically. This migration adds where it came from:
--   submission_decision_source = 'server'          decided by the server at
--                                                  acceptance (new path)
--                              = 'database_policy' stamped from
--                                                  extraction_policy alone
--                                                  (old path, until closed)
--                              = null              row older than 0011
-- On the new path the server records 'automatic' only if EXTRACTION_MODE
-- is automatic AND extraction_policy is automatic at acceptance; the
-- insert trigger can then only LOWER it (if the policy row has become
-- 'manual' by finalization). Nothing can raise it.
--
-- Rollback: see the bottom of this file.
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Agreement registry: which exact text may be accepted. The hash is of
-- the file in docs/legal/, verified by a repository test. active = false
-- everywhere until the founder activates the agreement.
-- ------------------------------------------------------------
create table if not exists agreement_versions (
  id text primary key,
  agreement_key text not null,
  language text not null check (language in ('en', 'ar')),
  version_label text not null,
  version_date date not null,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  active boolean not null default false,
  unique (agreement_key, language, version_label)
);
alter table agreement_versions enable row level security;
revoke all on table agreement_versions from anon, authenticated;

insert into agreement_versions (id, agreement_key, language, version_label, version_date, content_sha256, active)
values
  ('submission-terms-2026-09-25-en', 'submission-terms', 'en', 'Initial Version', '2026-09-25',
   '77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da', false),
  ('submission-terms-2026-09-25-ar', 'submission-terms', 'ar', 'Initial Version', '2026-09-25',
   '54a78f8441426b5c2dd190235fb57cfaa0ae9e1a956d6aefb64ff0a13208795b', false)
on conflict (id) do nothing;

-- ------------------------------------------------------------
-- Acceptance records ("submission intents"). One row per acceptance.
-- It is the evidence of what was accepted, when, under which processing
-- decision, and - after finalization - for which exact document.
-- Never deleted by the application; an abandoned one is marked expired.
-- ------------------------------------------------------------
create table if not exists submission_acceptances (
  id uuid primary key default gen_random_uuid(),
  intent_token_hash text not null unique,
  status text not null default 'open' check (status in ('open', 'finalized', 'expired')),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,

  agreement_version_id text not null references agreement_versions(id),
  agreement_language text not null check (agreement_language in ('en', 'ar')),
  agreement_sha256 text not null,
  accepted_at timestamptz not null default now(),       -- server time, never the client's
  claimed_role text not null check (claimed_role in ('author', 'coauthor', 'authorized_depositor')),
  identity_verified boolean not null default false,     -- an anonymous declaration, not verification
  publication_setting text not null check (publication_setting in ('record_abstract', 'record_abstract_fulltext')),

  -- Permission snapshot at acceptance.
  processing_decision text not null check (processing_decision in ('automatic', 'manual')),
  processing_mode_at_acceptance text not null check (processing_mode_at_acceptance in ('automatic', 'manual')),
  processing_policy_at_acceptance text not null check (processing_policy_at_acceptance in ('automatic', 'manual')),

  full_name text not null,
  email text not null,
  whatsapp_number text,

  -- The one place this acceptance may upload to, chosen by the server.
  object_path text not null unique check (object_path ~ '^intents/[0-9a-f-]{36}/[0-9a-f]{24}\.(pdf|docx)$'),
  file_extension text not null check (file_extension in ('pdf', 'docx')),
  declared_size bigint not null check (declared_size > 0 and declared_size <= 20971520),

  finalized_at timestamptz,
  paper_id uuid unique,
  object_sha256 text,
  object_size bigint,
  object_removed_at timestamptz,

  check (status <> 'finalized' or (paper_id is not null and object_sha256 is not null))
);
alter table submission_acceptances enable row level security;
revoke all on table submission_acceptances from anon, authenticated;
create index if not exists submission_acceptances_open_expiry
  on submission_acceptances (expires_at) where status = 'open';

-- ------------------------------------------------------------
-- Papers created by the new path point at their acceptance and record the
-- document they were accepted for.
-- ------------------------------------------------------------
alter table papers add column if not exists submission_acceptance_id uuid unique references submission_acceptances(id);
alter table papers add column if not exists publication_setting text;
alter table papers drop constraint if exists papers_publication_setting_check;
alter table papers add constraint papers_publication_setting_check
  check (publication_setting in ('record_abstract', 'record_abstract_fulltext'));
alter table papers add column if not exists file_sha256 text;
alter table papers add column if not exists file_size bigint;
alter table papers add column if not exists submission_decision_source text;
alter table papers drop constraint if exists papers_submission_decision_source_check;
alter table papers add constraint papers_submission_decision_source_check
  check (submission_decision_source in ('server', 'database_policy'));

alter table submission_acceptances drop constraint if exists submission_acceptances_paper_fk;
alter table submission_acceptances add constraint submission_acceptances_paper_fk
  foreign key (paper_id) references papers(id);

-- ------------------------------------------------------------
-- The 0011 stamp, extended. The least permissive of (a) what the server
-- decided, when the inserting code is the server path, and (b) the policy
-- row now. Immutable afterwards, together with its source.
-- ------------------------------------------------------------
create or replace function stamp_submission_extraction_policy()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_policy text := coalesce((select mode from extraction_policy where id), 'manual');
begin
  if tg_op = 'INSERT' then
    if new.submission_decision_source = 'server' then
      new.submission_extraction_policy :=
        case when new.submission_extraction_policy = 'automatic' and v_policy = 'automatic'
             then 'automatic' else 'manual' end;
    else
      new.submission_extraction_policy := v_policy;
      new.submission_decision_source := 'database_policy';
    end if;
  else
    new.submission_extraction_policy := old.submission_extraction_policy;
    new.submission_decision_source := old.submission_decision_source;
  end if;
  return new;
end;
$fn$;
revoke all on function stamp_submission_extraction_policy() from public;

drop trigger if exists papers_stamp_extraction_policy on papers;
create trigger papers_stamp_extraction_policy
  before insert or update of submission_extraction_policy, submission_decision_source on papers
  for each row execute function stamp_submission_extraction_policy();

-- ------------------------------------------------------------
-- Request limits for the new anonymous endpoints: fixed windows keyed by
-- a salted hash of the client address (the address itself is not stored).
-- ------------------------------------------------------------
create table if not exists submission_rate_limits (
  key text not null,
  window_start timestamptz not null,
  count int not null default 0,
  primary key (key, window_start)
);
alter table submission_rate_limits enable row level security;
revoke all on table submission_rate_limits from anon, authenticated;

create or replace function consume_submission_rate_limit(p_key text, p_limit int, p_window_seconds int)
returns boolean
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_window timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count int;
begin
  insert into submission_rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning count into v_count;
  -- Keep the table small; bounded work per call.
  delete from submission_rate_limits
  where ctid in (select ctid from submission_rate_limits where window_start < now() - interval '2 days' limit 50);
  return v_count <= p_limit;
end;
$fn$;

-- ------------------------------------------------------------
-- 1. Record an acceptance. Called only by the server (service role), after
--    it has validated everything it can in code. Re-checks what the
--    database is the authority for: the agreement row, and the policy.
-- ------------------------------------------------------------
create or replace function create_submission_intent(
  p_intent_token_hash text,
  p_agreement_version_id text,
  p_agreement_language text,
  p_agreement_sha256 text,
  p_claimed_role text,
  p_publication_setting text,
  p_processing_mode text,
  p_full_name text,
  p_email text,
  p_whatsapp_number text,
  p_file_extension text,
  p_declared_size bigint,
  p_ttl_seconds int
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_agreement agreement_versions%rowtype;
  v_policy text := coalesce((select mode from extraction_policy where id), 'manual');
  v_mode text := case when p_processing_mode = 'automatic' then 'automatic' else 'manual' end;
  v_decision text;
  v_id uuid := gen_random_uuid();
  v_path text;
  v_row submission_acceptances%rowtype;
begin
  select * into v_agreement from agreement_versions where id = p_agreement_version_id;
  if not found or not v_agreement.active then
    raise exception 'submission:agreement_not_active';
  end if;
  if v_agreement.language <> p_agreement_language or v_agreement.content_sha256 <> p_agreement_sha256 then
    raise exception 'submission:agreement_mismatch';
  end if;

  -- Automatic only when both the running application and the policy row say
  -- so. Anything else - including a value this function does not know -
  -- is manual.
  v_decision := case when v_mode = 'automatic' and v_policy = 'automatic' then 'automatic' else 'manual' end;
  v_path := 'intents/' || v_id::text || '/' || encode(gen_random_bytes(12), 'hex') || '.' || p_file_extension;

  insert into submission_acceptances (
    id, intent_token_hash, expires_at,
    agreement_version_id, agreement_language, agreement_sha256,
    claimed_role, publication_setting,
    processing_decision, processing_mode_at_acceptance, processing_policy_at_acceptance,
    full_name, email, whatsapp_number,
    object_path, file_extension, declared_size
  ) values (
    v_id, p_intent_token_hash, now() + make_interval(secs => p_ttl_seconds),
    v_agreement.id, v_agreement.language, v_agreement.content_sha256,
    p_claimed_role, p_publication_setting,
    v_decision, v_mode, v_policy,
    trim(p_full_name), trim(p_email), nullif(trim(p_whatsapp_number), ''),
    v_path, p_file_extension, p_declared_size
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'object_path', v_row.object_path,
    'expires_at', v_row.expires_at,
    'accepted_at', v_row.accepted_at,
    'processing_decision', v_row.processing_decision
  );
end;
$fn$;

-- ------------------------------------------------------------
-- Look up an acceptance for finalization. The intent token is the only
-- credential; a wrong token and an unknown id look identical (null).
-- ------------------------------------------------------------
create or replace function get_submission_intent(p_intent_id uuid, p_intent_token_hash text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row submission_acceptances%rowtype;
begin
  select * into v_row from submission_acceptances
  where id = p_intent_id and intent_token_hash = p_intent_token_hash;
  if not found then
    return null;
  end if;
  return jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'expired', v_row.status = 'open' and v_row.expires_at < now(),
    'object_path', v_row.object_path,
    'file_extension', v_row.file_extension,
    'declared_size', v_row.declared_size,
    'processing_decision', v_row.processing_decision,
    'paper_id', v_row.paper_id
  );
end;
$fn$;

-- ------------------------------------------------------------
-- 3. Finalize: create the paper exactly once. The row lock makes
--    concurrent or repeated calls safe: the first creates the paper, every
--    later call returns that same paper and changes nothing.
-- ------------------------------------------------------------
create or replace function finalize_submission_intent(
  p_intent_id uuid,
  p_intent_token_hash text,
  p_object_size bigint,
  p_object_sha256 text,
  p_confirmation_token_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_row submission_acceptances%rowtype;
  v_researcher_id uuid;
  v_paper_id uuid;
  v_policy text;
begin
  select * into v_row from submission_acceptances
  where id = p_intent_id and intent_token_hash = p_intent_token_hash
  for update;
  if not found then
    raise exception 'submission:intent_not_found';
  end if;

  if v_row.status = 'finalized' then
    select submission_extraction_policy into v_policy from papers where id = v_row.paper_id;
    return jsonb_build_object('paper_id', v_row.paper_id, 'already_finalized', true, 'processing_decision', v_policy);
  end if;

  -- Returned, not raised: raising would roll the status change back.
  if v_row.status = 'expired' or v_row.expires_at < now() then
    update submission_acceptances set status = 'expired' where id = v_row.id and status = 'open';
    return jsonb_build_object('error', 'intent_expired');
  end if;

  if p_object_size is distinct from v_row.declared_size then
    raise exception 'submission:object_size_mismatch';
  end if;
  if p_object_sha256 !~ '^[0-9a-f]{64}$' or p_confirmation_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'submission:invalid_finalization';
  end if;

  insert into researchers (full_name, email, whatsapp_number)
  values (v_row.full_name, v_row.email, v_row.whatsapp_number)
  returning id into v_researcher_id;

  -- permission_to_process = false: the legacy checkbox was not shown on
  -- this path, and the column must not claim it was. The evidence for this
  -- paper is its acceptance record. publication_scope is the legacy
  -- multi-choice field; empty here, the new publication_setting is the
  -- value in force.
  insert into papers (
    submitted_by, file_path, permission_to_process, publication_scope,
    status, extraction_status, confirmation_token_hash,
    submission_acceptance_id, publication_setting, file_sha256, file_size,
    submission_extraction_policy, submission_decision_source
  ) values (
    v_researcher_id, v_row.object_path, false, '{}',
    'submitted', 'pending', p_confirmation_token_hash,
    v_row.id, v_row.publication_setting, p_object_sha256, p_object_size,
    v_row.processing_decision, 'server'
  )
  returning id, submission_extraction_policy into v_paper_id, v_policy;

  insert into paper_researchers (paper_id, researcher_id, author_order)
  values (v_paper_id, v_researcher_id, 1);

  update submission_acceptances
  set status = 'finalized', finalized_at = now(), paper_id = v_paper_id,
      object_sha256 = p_object_sha256, object_size = p_object_size
  where id = v_row.id;

  return jsonb_build_object('paper_id', v_paper_id, 'already_finalized', false, 'processing_decision', v_policy);
end;
$fn$;

-- ------------------------------------------------------------
-- Abandoned acceptances: mark expired, and hand back ONLY their own
-- server-chosen object paths for removal. A finalized acceptance, or any
-- object outside intents/<id>/, is never returned.
-- ------------------------------------------------------------
create or replace function expire_submission_intents(p_limit int, p_grace_seconds int)
returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_out jsonb;
begin
  update submission_acceptances set status = 'expired'
  where status = 'open' and expires_at < now() - make_interval(secs => p_grace_seconds);

  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'object_path', object_path)), '[]'::jsonb)
  into v_out
  from (
    select id, object_path from submission_acceptances
    where status = 'expired' and paper_id is null and object_removed_at is null
    order by expires_at
    limit greatest(0, least(p_limit, 100))
  ) s;
  return v_out;
end;
$fn$;

create or replace function mark_submission_object_removed(p_intent_id uuid)
returns void
language sql
security definer
set search_path = public
as $fn$
  update submission_acceptances set object_removed_at = now()
  where id = p_intent_id and status = 'expired' and paper_id is null;
$fn$;

-- Service role only. Nothing here is callable by anon or authenticated.
revoke all on function consume_submission_rate_limit(text, int, int) from public, anon, authenticated;
revoke all on function create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int) from public, anon, authenticated;
revoke all on function get_submission_intent(uuid, text) from public, anon, authenticated;
revoke all on function finalize_submission_intent(uuid, text, bigint, text, text) from public, anon, authenticated;
revoke all on function expire_submission_intents(int, int) from public, anon, authenticated;
revoke all on function mark_submission_object_removed(uuid) from public, anon, authenticated;
grant execute on function consume_submission_rate_limit(text, int, int) to service_role;
grant execute on function create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int) to service_role;
grant execute on function get_submission_intent(uuid, text) to service_role;
grant execute on function finalize_submission_intent(uuid, text, bigint, text, text) to service_role;
grant execute on function expire_submission_intents(int, int) to service_role;
grant execute on function mark_submission_object_removed(uuid) to service_role;

commit;

-- ------------------------------------------------------------
-- Rollback (only while no paper has submission_acceptance_id set, and
-- with the M2A application reverted):
--   select count(*) from papers where submission_acceptance_id is not null;  -- must be 0
--   begin;
--   drop function if exists mark_submission_object_removed(uuid);
--   drop function if exists expire_submission_intents(int, int);
--   drop function if exists finalize_submission_intent(uuid, text, bigint, text, text);
--   drop function if exists get_submission_intent(uuid, text);
--   drop function if exists create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int);
--   drop function if exists consume_submission_rate_limit(text, int, int);
--   drop table if exists submission_rate_limits;
--   <re-create stamp_submission_extraction_policy() and its trigger from 0011>;
--   alter table submission_acceptances drop constraint if exists submission_acceptances_paper_fk;
--   alter table papers drop column if exists submission_decision_source,
--     drop column if exists file_size, drop column if exists file_sha256,
--     drop column if exists publication_setting, drop column if exists submission_acceptance_id;
--   drop table if exists submission_acceptances;
--   drop table if exists agreement_versions;
--   commit;
-- Once papers exist on the new path, their acceptance records are
-- evidence: do not roll back; fix forward.
-- ------------------------------------------------------------
