-- ============================================================
-- 0017: aggregate activity counts for public research pages (Phase 3 M6).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0016. Additive: no existing column, row, policy or grant changes.
--
-- Four separate counters per paper, each an AGGREGATE (no reader, address
-- or time of an individual event is kept):
--   page_view         the research page was shown in a browser and stayed
--                     visible (a beacon from the page, not server rendering)
--   document_open     a link to read the approved document online was issued
--   document_download a link to download the approved document was issued
--   citation_export   an RIS or BibTeX file was served, or the citation text
--                     was copied successfully in the browser
-- Issuing a link does not prove the file was opened or fully downloaded;
-- the labels say "requests". None of these is a citation or a unique reader.
--
-- Deduplication: at most one count per event type, per record, per client,
-- per UTC day. The client key is a keyed hash made by the server (address
-- and browser string, hashed with a server secret) and is kept only in
-- activity_dedup, for at most 2 days, then deleted in bounded batches.
--
-- Every function is SECURITY DEFINER, pins search_path and is executable
-- by service_role only. Events are accepted only while the record passes
-- publication_eligibility() (document events only while full text does);
-- counts are shown only while it does. Counts of a record that becomes
-- unavailable are kept privately, never shown.
--
-- Rollback:
--   begin;
--   drop function if exists public_record_event(text, text, text), public_activity(text);
--   drop table if exists activity_counts, activity_dedup;
--   commit;
-- ============================================================

begin;

create table if not exists activity_counts (
  paper_id uuid not null references papers(id),
  event text not null check (event in ('page_view', 'document_open', 'document_download', 'citation_export')),
  count bigint not null default 0 check (count >= 0),
  updated_at timestamptz not null default now(),
  primary key (paper_id, event)
);
alter table activity_counts enable row level security;
revoke all on table activity_counts from anon, authenticated;

create table if not exists activity_dedup (
  key text primary key check (key ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now()
);
create index if not exists activity_dedup_created on activity_dedup (created_at);
alter table activity_dedup enable row level security;
revoke all on table activity_dedup from anon, authenticated;

-- Record one event. p_client is the server's keyed hash of the client (64
-- hex), never an address. Returns 'counted', 'duplicate' or 'not_eligible'.
-- The increment is a single atomic upsert; the duplicate check is a unique
-- insert, so a retried or concurrent request counts once.
create or replace function public_record_event(p_public_id text, p_event text, p_client text)
returns text
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
  v_key text;
begin
  if p_event not in ('page_view', 'document_open', 'document_download', 'citation_export')
     or coalesce(p_client, '') !~ '^[0-9a-f]{64}$'
     or coalesce(p_public_id, '') !~ '^[a-hjkmnp-z2-9]{12}$' then
    raise exception 'invalid event';
  end if;
  select paper_id into v_paper from public_records where public_id = p_public_id;
  if not found then
    return 'not_eligible';
  end if;
  e := publication_eligibility(v_paper);
  if not coalesce((e->>'record_public')::boolean, false)
     or (p_event in ('document_open', 'document_download') and not coalesce((e->>'fulltext_public')::boolean, false)) then
    return 'not_eligible';
  end if;

  -- Bounded cleanup of expired deduplication keys (at most 200 per call).
  delete from activity_dedup where key in (
    select key from activity_dedup where created_at < now() - interval '2 days' limit 200);

  v_key := encode(digest(p_client || ':' || p_public_id || ':' || p_event || ':' || to_char(now() at time zone 'utc', 'YYYY-MM-DD'), 'sha256'), 'hex');
  insert into activity_dedup (key) values (v_key) on conflict do nothing;
  if not found then
    return 'duplicate';
  end if;
  insert into activity_counts as c (paper_id, event, count) values (v_paper, p_event, 1)
  on conflict (paper_id, event) do update set count = c.count + 1, updated_at = now();
  return 'counted';
end;
$fn$;

-- The counts a public page may show, or NULL when the record is not public.
-- Document counts only while full text is public now: a record that is
-- metadata-only today never appears to offer a document.
create or replace function public_activity(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
  v_full boolean;
begin
  if coalesce(p_public_id, '') !~ '^[a-hjkmnp-z2-9]{12}$' then
    return null;
  end if;
  select paper_id into v_paper from public_records where public_id = p_public_id;
  if not found then
    return null;
  end if;
  e := publication_eligibility(v_paper);
  if not coalesce((e->>'record_public')::boolean, false) then
    return null;
  end if;
  v_full := coalesce((e->>'fulltext_public')::boolean, false);
  return jsonb_build_object(
    'page_view', coalesce((select count from activity_counts where paper_id = v_paper and event = 'page_view'), 0),
    'citation_export', coalesce((select count from activity_counts where paper_id = v_paper and event = 'citation_export'), 0),
    'document_open', case when v_full then coalesce((select count from activity_counts where paper_id = v_paper and event = 'document_open'), 0) end,
    'document_download', case when v_full then coalesce((select count from activity_counts where paper_id = v_paper and event = 'document_download'), 0) end);
end;
$fn$;

do $grants$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('public_record_event', 'public_activity')
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $grants$;

commit;
