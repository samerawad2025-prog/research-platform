-- ============================================================
-- 0016: public research pages, catalogue and approved files (Phase 3 M5).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0015 (the review layer and publication_eligibility). Independent
-- of 0014. Additive: no existing column, row, policy or grant changes.
--
-- What it adds
--   1. public_records: one stable, random public identifier per paper,
--      created the first time the paper is approved (trigger on
--      review_approvals). Never the paper UUID, never the confirmation
--      token. Having an identifier does NOT make anything public: every
--      read below re-applies publication_eligibility().
--   2. Read functions for the public site, each re-checking the one shared
--      rule and returning an explicit allowlist of public fields:
--        public_record(public_id)       a research page
--        public_catalogue(filters)      browse/search with counts
--        public_document(public_id)     the approved dissemination copy
--        public_sitemap()               sitemap entries
--      and admin_public_link(actor, paper) for the review screen.
--   3. public_fold(text): conservative Arabic/English search folding.
--
-- Every function is SECURITY DEFINER, pins search_path, and is executable
-- by service_role only: the public site reads through its own server, and
-- a browser holding the anon key can call none of this. Nothing here can
-- change eligibility, lift a restriction or reveal a private field.
--
-- Rollback (nothing public depends on it once the flag is off):
--   begin;
--   drop trigger if exists review_approvals_public_id on review_approvals;
--   drop function if exists public_record(text), public_catalogue(jsonb), public_document(text),
--     public_sitemap(), admin_public_link(uuid, uuid), public_fold(text), public_assign_id(), public_new_id();
--   drop table if exists public_records;
--   commit;
-- ============================================================

begin;

-- ------------------------------------------------------------
-- Public identifiers.
-- ------------------------------------------------------------
create table if not exists public_records (
  paper_id uuid primary key references papers(id),
  -- 12 characters from a 31-letter alphabet with no look-alikes (no 0/o,
  -- 1/l/i): about 59 bits, random, not derived from anything private.
  public_id text not null unique check (public_id ~ '^[a-hjkmnp-z2-9]{12}$'),
  created_at timestamptz not null default now()
);
alter table public_records enable row level security;
revoke all on table public_records from anon, authenticated;

create or replace function public_new_id()
returns text
language plpgsql
volatile
set search_path = public, extensions
as $fn$
declare
  v_alpha constant text := 'abcdefghjkmnpqrstuvwxyz23456789';
  v_bytes bytea := gen_random_bytes(12);
  v_out text := '';
  i int;
begin
  for i in 0..11 loop
    v_out := v_out || substr(v_alpha, (get_byte(v_bytes, i) % 31) + 1, 1);
  end loop;
  return v_out;
end;
$fn$;

-- Assigned when a paper is first approved, and kept for good: a later
-- re-approval keeps the same address. Being assigned publishes nothing.
create or replace function public_assign_id()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $fn$
declare
  n int := 0;
begin
  if exists (select 1 from public_records where paper_id = new.paper_id) then
    return new;
  end if;
  loop
    begin
      insert into public_records (paper_id, public_id) values (new.paper_id, public_new_id());
      return new;
    exception when unique_violation then
      if exists (select 1 from public_records where paper_id = new.paper_id) then
        return new;
      end if;
      n := n + 1;
      if n > 5 then raise; end if;
    end;
  end loop;
end;
$fn$;

drop trigger if exists review_approvals_public_id on review_approvals;
create trigger review_approvals_public_id
  after insert on review_approvals
  for each row execute function public_assign_id();

-- Papers approved before this migration get their identifier now.
insert into public_records (paper_id, public_id)
select distinct a.paper_id, public_new_id()
from review_approvals a
where not exists (select 1 from public_records r where r.paper_id = a.paper_id)
on conflict do nothing;

-- ------------------------------------------------------------
-- Search folding: the 0015 name normalizer (lower case; alef forms, alef
-- maqsura and taa marbuta folded; tatweel, harakat and punctuation removed)
-- plus Arabic-Indic and Persian digits folded to ASCII. Applied to both the
-- query and the text searched; the text shown is never changed.
-- ------------------------------------------------------------
create or replace function public_fold(p text)
returns text
language sql
immutable
set search_path = public
as $fn$
  select normalize_name_text(translate(coalesce(p, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'))
$fn$;

-- ------------------------------------------------------------
-- The public view of one paper: an explicit allowlist. Nothing else in
-- papers, researchers, reviews or acceptances is ever read into it.
-- Internal: called only after eligibility has been established.
-- ------------------------------------------------------------
create or replace function public_record_fields(p_paper uuid, p_public_id text, e jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public
as $fn$
  select jsonb_build_object(
    'public_id', p_public_id,
    'title', nullif(btrim(p.title), ''), 'title_ar', nullif(btrim(p.title_ar), ''),
    'abstract', nullif(btrim(p.abstract), ''), 'abstract_ar', nullif(btrim(p.abstract_ar), ''),
    'year', p.year,
    'degree_type', nullif(btrim(p.degree_type), ''),
    'document_type', case when p.document_type in ('thesis', 'article') then p.document_type end,
    'supervisor_name', case when p.document_type = 'thesis' then nullif(btrim(p.supervisor_name), '') end,
    'institution', case when i.id is not null then jsonb_build_object('name_en', i.name_en, 'name_ar', i.name_ar) end,
    -- The verified unit the approval pinned; otherwise the faculty text as
    -- the submitter confirmed it (shown, never matched).
    'unit', case when u.id is not null then jsonb_build_object('name_en', u.name_en, 'name_ar', u.name_ar)
                 when nullif(btrim(p.faculty), '') is not null then jsonb_build_object('text', btrim(p.faculty)) end,
    'authors', coalesce((
      select jsonb_agg(jsonb_build_object(
        'name', rr.full_name,
        -- Only a LinkedIn profile its owner chose to show, and only an
        -- https linkedin.com address.
        'linkedin_url', case when rr.linkedin_public and rr.linkedin_url ~* '^https://([a-z]{2,3}\.)?(www\.)?linkedin\.com/' then rr.linkedin_url end)
        order by pr.author_order nulls last, rr.full_name)
      from paper_researchers pr join researchers rr on rr.id = pr.researcher_id
      where pr.paper_id = p.id), '[]'::jsonb),
    'setting', e->>'setting',
    'fulltext', case when (e->>'fulltext_public')::boolean then jsonb_build_object(
        'format', d.file_extension, 'size', d.size_bytes) end,
    'approved_at', (select a.approved_at from review_approvals a where a.id = (e->>'approval_id')::uuid))
  from papers p
  join paper_reviews r on r.paper_id = p.id
  left join institutions i on i.id = r.institution_id
  left join academic_units u on u.id = r.academic_unit_id and u.institution_id = r.institution_id
  left join document_versions d on d.id = (e->>'dissemination_version_id')::uuid
  where p.id = p_paper
$fn$;

-- A research page. NULL for anything not currently public: unknown,
-- private, pending, declined, withdrawn, suspended, embargoed, changed
-- since approval, or from an ineligible institution. The caller answers
-- every NULL the same way.
create or replace function public_record(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
begin
  if p_public_id is null or p_public_id !~ '^[a-hjkmnp-z2-9]{12}$' then
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
  return public_record_fields(v_paper, p_public_id, e);
end;
$fn$;

-- The approved dissemination copy of a public full-text record, or NULL.
-- The path comes from the approval, never from the caller, and only while
-- publication_eligibility says full text is public (which includes the
-- global full-text legal restriction).
create or replace function public_document(p_public_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_paper uuid;
  e jsonb;
  d document_versions%rowtype;
begin
  if p_public_id is null or p_public_id !~ '^[a-hjkmnp-z2-9]{12}$' then
    return null;
  end if;
  select paper_id into v_paper from public_records where public_id = p_public_id;
  if not found then
    return null;
  end if;
  e := publication_eligibility(v_paper);
  if not coalesce((e->>'fulltext_public')::boolean, false) or e->>'dissemination_version_id' is null then
    return null;
  end if;
  select * into d from document_versions where id = (e->>'dissemination_version_id')::uuid;
  if not found or d.state <> 'approved' or d.kind <> 'dissemination' or d.paper_id <> v_paper then
    return null;
  end if;
  return jsonb_build_object('storage_path', d.storage_path, 'format', d.file_extension, 'size', d.size_bytes,
    'sha256', d.sha256, 'title', coalesce(nullif(btrim((select title from papers where id = v_paper)), ''),
                                          nullif(btrim((select title_ar from papers where id = v_paper)), '')));
end;
$fn$;

-- ------------------------------------------------------------
-- Browse and search. Only currently public records are ever considered,
-- so results, totals, filter options and their counts describe public
-- records only. Bounded: at most 50 per page; deterministic order.
--   filters: q (text), unit (uuid), year (int), degree (text),
--            type ('thesis'|'article'), page (>= 1), limit (1..50)
-- ------------------------------------------------------------
create or replace function public_catalogue(p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
declare
  v_q text := public_fold(left(coalesce(p->>'q', ''), 200));
  v_unit uuid;
  v_year int;
  v_degree text := nullif(btrim(left(coalesce(p->>'degree', ''), 100)), '');
  v_type text := nullif(p->>'type', '');
  v_limit int := least(greatest(coalesce((p->>'limit')::int, 20), 1), 50);
  v_page int := greatest(coalesce((p->>'page')::int, 1), 1);
  v_terms text[];
  v_out jsonb;
begin
  begin
    v_unit := nullif(p->>'unit', '')::uuid;
    v_year := nullif(p->>'year', '')::int;
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'invalid_filter');
  end;
  if v_type is not null and v_type not in ('thesis', 'article') then
    return jsonb_build_object('ok', false, 'error', 'invalid_filter');
  end if;
  v_terms := case when v_q is null then '{}'::text[] else (select array_agg(t) from unnest(string_to_array(v_q, ' ')) t where t <> '') end;
  if cardinality(v_terms) > 8 then v_terms := v_terms[1:8]; end if;

  with pub as (
    select pr.public_id, p.id, e
    from public_records pr
    join papers p on p.id = pr.paper_id
    cross join lateral (select publication_eligibility(p.id) as e) el
    where coalesce((e->>'record_public')::boolean, false)
  ), rows as (
    select pub.public_id, pub.e, p.id, p.year, nullif(btrim(p.degree_type), '') as degree,
           case when p.document_type in ('thesis', 'article') then p.document_type end as dtype,
           r.academic_unit_id as unit_id,
           public_fold(concat_ws(' ', p.title, p.title_ar, p.abstract, p.abstract_ar,
             (select string_agg(rr.full_name, ' ') from paper_researchers x join researchers rr on rr.id = x.researcher_id where x.paper_id = p.id))) as hay,
           coalesce(nullif(btrim(p.title), ''), p.title_ar) as sort_title
    from pub join papers p on p.id = pub.id join paper_reviews r on r.paper_id = p.id
  ), matched as (
    -- Every word of the query must appear (after folding).
    select * from rows where coalesce((select bool_and(position(t in hay) > 0) from unnest(v_terms) t), true)
  ), filtered as (
    select * from matched
    where (v_unit is null or unit_id = v_unit) and (v_year is null or year = v_year)
      and (v_degree is null or degree = v_degree) and (v_type is null or dtype = v_type)
  )
  select jsonb_build_object(
    'ok', true,
    'total', (select count(*) from filtered),
    'page', v_page, 'limit', v_limit,
    'items', coalesce((
      select jsonb_agg(public_record_fields(f.id, f.public_id, f.e) - 'abstract' - 'abstract_ar' - 'supervisor_name'
               || jsonb_build_object('snippet', left(coalesce(nullif(btrim(pp.abstract), ''), nullif(btrim(pp.abstract_ar), ''), ''), 280),
                                     'snippet_lang', case when nullif(btrim(pp.abstract), '') is not null then 'en' when nullif(btrim(pp.abstract_ar), '') is not null then 'ar' end)
               order by f.year desc nulls last, f.sort_title, f.public_id)
      from (select * from filtered order by year desc nulls last, sort_title, public_id
            limit v_limit offset (v_page - 1) * v_limit) f
      join papers pp on pp.id = f.id), '[]'::jsonb),
    -- Each facet counts the records matching the query and every OTHER
    -- filter, so a choice never leads to an empty page. Only values that
    -- public records actually have are listed.
    'facets', jsonb_build_object(
      'unit', coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'name_en', u.name_en, 'name_ar', u.name_ar, 'count', c.n) order by coalesce(u.name_en, u.name_ar))
                        from (select unit_id, count(*) n from matched
                              where unit_id is not null and (v_year is null or year = v_year) and (v_degree is null or degree = v_degree) and (v_type is null or dtype = v_type)
                              group by unit_id) c join academic_units u on u.id = c.unit_id), '[]'::jsonb),
      'year', coalesce((select jsonb_agg(jsonb_build_object('value', year, 'count', n) order by year desc)
                        from (select year, count(*) n from matched
                              where year is not null and (v_unit is null or unit_id = v_unit) and (v_degree is null or degree = v_degree) and (v_type is null or dtype = v_type)
                              group by year) c), '[]'::jsonb),
      'degree', coalesce((select jsonb_agg(jsonb_build_object('value', degree, 'count', n) order by degree)
                          from (select degree, count(*) n from matched
                                where degree is not null and (v_unit is null or unit_id = v_unit) and (v_year is null or year = v_year) and (v_type is null or dtype = v_type)
                                group by degree) c), '[]'::jsonb),
      'type', coalesce((select jsonb_agg(jsonb_build_object('value', dtype, 'count', n) order by dtype)
                        from (select dtype, count(*) n from matched
                              where dtype is not null and (v_unit is null or unit_id = v_unit) and (v_year is null or year = v_year) and (v_degree is null or degree = v_degree)
                              group by dtype) c), '[]'::jsonb)))
  into v_out;
  return v_out;
end;
$fn$;

-- Sitemap entries: public records only.
create or replace function public_sitemap()
returns jsonb
language sql
stable
security definer
set search_path = public, extensions
as $fn$
  select coalesce(jsonb_agg(jsonb_build_object('public_id', pr.public_id,
           'lastmod', (select a.approved_at from review_approvals a where a.id = (el.e->>'approval_id')::uuid))
           order by pr.public_id), '[]'::jsonb)
  from public_records pr
  cross join lateral (select publication_eligibility(pr.paper_id) as e) el
  where coalesce((el.e->>'record_public')::boolean, false)
$fn$;

-- For the review screen: the public identifier, only when the record is
-- public right now. Administrators only. Whether the public site is
-- switched on is the application's to say.
create or replace function admin_public_link(p_actor uuid, p_paper uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions
as $fn$
begin
  perform admin_require_role(p_actor, array['administrator']);
  if not coalesce((publication_eligibility(p_paper)->>'record_public')::boolean, false) then
    return jsonb_build_object('public_id', null);
  end if;
  return jsonb_build_object('public_id', (select public_id from public_records where paper_id = p_paper));
end;
$fn$;

-- ------------------------------------------------------------
-- Grants, by name. service_role only.
-- ------------------------------------------------------------
do $grants$
declare
  r record;
  v_api text[] := array['public_record', 'public_catalogue', 'public_document', 'public_sitemap', 'admin_public_link'];
  v_all text[] := v_api || array['public_new_id', 'public_assign_id', 'public_fold', 'public_record_fields'];
begin
  for r in
    select p.oid::regprocedure as sig, p.proname
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(v_all)
  loop
    execute format('revoke all on function %s from public, anon, authenticated, service_role', r.sig);
    if r.proname = any(v_api) then
      execute format('grant execute on function %s to service_role', r.sig);
    end if;
  end loop;
end $grants$;

commit;
