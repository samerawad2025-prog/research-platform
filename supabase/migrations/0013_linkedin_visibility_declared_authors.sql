-- ============================================================
-- 0013: M3 (Facebook removal, independent LinkedIn visibility) and the
-- M2B declared-authors addition to the acceptance flow.
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0012 (and therefore 0011). Additive: no column is dropped, no
-- existing value is changed, and no permission is widened.
--
-- 1. LinkedIn. researchers.linkedin_public (default false) is the one
--    display choice, independent of any publication permission. Existing
--    LinkedIn values are kept and are private (false) until their owner
--    opts in: nothing is inferred from a legacy publication_scope.
--    confirm_researcher_metadata now stores LinkedIn regardless of scope,
--    validates it, and applies profile changes only to a researcher row
--    that belongs to this paper alone. Only the submitter, and only for
--    their own row as a listed author, can make a LinkedIn link public.
--    Anyone else named on the paper (for example by a depositor) is
--    private until they opt in themselves.
-- 2. Facebook. confirm_researcher_metadata ignores facebook_url and
--    get_paper_for_confirmation no longer returns it. The column and its
--    historical values are retained unchanged.
-- 3. Declared authors. An authorized depositor (a librarian, a volunteer)
--    names the actual authors when accepting. They are recorded with the
--    acceptance, immutably, and linked on the paper at finalization, in
--    order, as unverified names without contact details. The depositor
--    is never made an author.
--
-- Rollback: see the bottom of this file.
-- ============================================================

begin;

alter table researchers add column if not exists linkedin_public boolean not null default false;

alter table submission_acceptances add column if not exists declared_authors jsonb;
alter table submission_acceptances drop constraint if exists submission_acceptances_declared_authors_check;
alter table submission_acceptances add constraint submission_acceptances_declared_authors_check
  check (declared_authors is null
         or (jsonb_typeof(declared_authors) = 'array' and jsonb_array_length(declared_authors) between 1 and 50));

-- ------------------------------------------------------------
-- Record the depositor's author list with the acceptance, once, before
-- the server issues any upload authorization. Service role only.
-- ------------------------------------------------------------
create or replace function record_declared_authors(p_intent_id uuid, p_authors jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row submission_acceptances%rowtype;
  v_clean jsonb := '[]'::jsonb;
  v_name text;
begin
  if p_authors is null or jsonb_typeof(p_authors) <> 'array'
     or jsonb_array_length(p_authors) < 1 or jsonb_array_length(p_authors) > 50 then
    raise exception 'submission:authors_invalid';
  end if;
  for v_name in select trim(value) from jsonb_array_elements_text(p_authors)
  loop
    if v_name is null or length(v_name) = 0 or length(v_name) > 200 then
      raise exception 'submission:authors_invalid';
    end if;
    v_clean := v_clean || to_jsonb(v_name);
  end loop;

  select * into v_row from submission_acceptances where id = p_intent_id for update;
  if not found or v_row.status <> 'open' or v_row.claimed_role <> 'authorized_depositor'
     or v_row.declared_authors is not null then
    raise exception 'submission:authors_not_recordable';
  end if;
  update submission_acceptances set declared_authors = v_clean where id = p_intent_id;
end;
$fn$;

-- ------------------------------------------------------------
-- Finalize, as in 0012, plus: a depositor's declared authors are linked in
-- their declared order. Same signature, so the 0012 grants stay in force.
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
  v_author_id uuid;
  v_paper_id uuid;
  v_policy text;
  v_name text;
  v_order int := 0;
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

  -- Authorship, as declared (unverified; the confirmation step can change
  -- it). An author is first; a co-author's position is left for
  -- confirmation. A depositor is never linked; the names they declared
  -- are, in order, with no contact details.
  if v_row.claimed_role in ('author', 'coauthor') then
    insert into paper_researchers (paper_id, researcher_id, author_order)
    values (v_paper_id, v_researcher_id, case when v_row.claimed_role = 'author' then 1 else null end);
  elsif v_row.claimed_role = 'authorized_depositor' and v_row.declared_authors is not null then
    for v_name in select value from jsonb_array_elements_text(v_row.declared_authors)
    loop
      v_order := v_order + 1;
      insert into researchers (full_name) values (v_name) returning id into v_author_id;
      insert into paper_researchers (paper_id, researcher_id, author_order) values (v_paper_id, v_author_id, v_order);
    end loop;
  end if;

  update submission_acceptances
  set status = 'finalized', finalized_at = now(), paper_id = v_paper_id,
      object_sha256 = p_object_sha256, object_size = p_object_size
  where id = v_row.id;

  return jsonb_build_object('paper_id', v_paper_id, 'already_finalized', false, 'processing_decision', v_policy);
end;
$fn$;

-- ------------------------------------------------------------
-- The confirmation read: no Facebook; LinkedIn with its display choice;
-- which row is the submitter's own; the new-path setting and role.
-- ------------------------------------------------------------
create or replace function get_paper_for_confirmation(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_paper record;
  v_researchers jsonb;
  v_extraction jsonb;
  v_role text;
begin
  if p_token is null or length(p_token) = 0 then
    return null;
  end if;

  select * into v_paper
  from papers
  where confirmation_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    return null;
  end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'researcher_id', r.id,
      'full_name', r.full_name,
      'linkedin_url', r.linkedin_url,
      'linkedin_public', r.linkedin_public,
      'is_submitter', r.id = v_paper.submitted_by,
      'author_order', pr.author_order
    ) order by pr.author_order nulls last, r.full_name
  ), '[]'::jsonb)
  into v_researchers
  from paper_researchers pr
  join researchers r on r.id = pr.researcher_id
  where pr.paper_id = v_paper.id;

  select ag.result_data into v_extraction
  from ai_generations ag
  where ag.id = v_paper.last_applied_generation_id;

  select claimed_role into v_role from submission_acceptances where id = v_paper.submission_acceptance_id;

  -- Explicit allowlist of fields, not select *.
  return jsonb_build_object(
    'paper_id', v_paper.id,
    'title', v_paper.title,
    'title_ar', v_paper.title_ar,
    'abstract', v_paper.abstract,
    'abstract_ar', v_paper.abstract_ar,
    'supervisor_name', v_paper.supervisor_name,
    'year', v_paper.year,
    'university', v_paper.university,
    'faculty', v_paper.faculty,
    'degree_type', v_paper.degree_type,
    'document_type', v_paper.document_type,
    'failure_code', v_paper.failure_code,
    'publication_scope', v_paper.publication_scope,
    'publication_setting', v_paper.publication_setting,
    'submitter_role', v_role,
    'extraction_status', v_paper.extraction_status,
    'metadata_confirmed_at', v_paper.metadata_confirmed_at,
    'manual_entry_source', v_paper.manual_entry_source,
    'manual_entry_at', v_paper.manual_entry_at,
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

-- ------------------------------------------------------------
-- Confirmation write, as in 0010, except:
--   - facebook_url is ignored entirely;
--   - LinkedIn is stored whatever the publication permission, and must be
--     a linkedin.com profile address;
--   - LinkedIn and its display choice change only on a researcher row
--     linked to this paper alone (a row shared with another paper keeps
--     its own values);
--   - linkedin_public can be true only for the submitter's own row, and
--     clearing the link clears it; every row created here starts private.
-- ------------------------------------------------------------
create or replace function confirm_researcher_metadata(
  p_token text,
  p_researchers jsonb,
  p_corrections jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_paper record;
  v_item jsonb;
  v_researcher_id uuid;
  v_order int := 0;
  v_kept_ids uuid[] := '{}';
  v_linkedin text;
  v_public boolean;
  v_exclusive boolean;
begin
  select * into v_paper
  from papers
  where confirmation_token_hash = encode(digest(p_token, 'sha256'), 'hex')
  limit 1;

  if not found then
    raise exception 'Invalid or expired confirmation link.';
  end if;

  if p_researchers is null or jsonb_typeof(p_researchers) <> 'array' or jsonb_array_length(p_researchers) = 0 then
    raise exception 'At least one researcher is required.';
  end if;

  for v_item in select * from jsonb_array_elements(p_researchers)
  loop
    v_order := v_order + 1;

    if v_item->>'full_name' is null or length(trim(v_item->>'full_name')) = 0 then
      raise exception 'Each researcher needs a name.';
    end if;

    v_linkedin := nullif(trim(coalesce(v_item->>'linkedin_url', '')), '');
    if v_linkedin is not null
       and v_linkedin !~* '^https://([a-z]{2,3}\.)?(www\.)?linkedin\.com/in/[^/?#[:space:]]{1,100}/?$' then
      raise exception 'Please enter a LinkedIn profile address, for example https://www.linkedin.com/in/your-name';
    end if;

    if (v_item->>'researcher_id') is not null
       and exists (
         select 1 from paper_researchers
         where paper_id = v_paper.id and researcher_id = (v_item->>'researcher_id')::uuid
       )
    then
      v_researcher_id := (v_item->>'researcher_id')::uuid;
      v_exclusive := not exists (
        select 1 from paper_researchers where researcher_id = v_researcher_id and paper_id <> v_paper.id
      );
      v_public := v_linkedin is not null
                  and v_researcher_id = v_paper.submitted_by
                  and coalesce((v_item->>'linkedin_public')::boolean, false);
      update researchers set
        full_name = trim(v_item->>'full_name'),
        linkedin_url = case when v_exclusive then v_linkedin else linkedin_url end,
        linkedin_public = case when v_exclusive then v_public else linkedin_public end
      where id = v_researcher_id;
    else
      insert into researchers (full_name, linkedin_url, linkedin_public)
      values (trim(v_item->>'full_name'), v_linkedin, false)
      returning id into v_researcher_id;
    end if;

    insert into paper_researchers (paper_id, researcher_id, author_order)
    values (v_paper.id, v_researcher_id, coalesce((v_item->>'author_order')::int, v_order))
    on conflict (paper_id, researcher_id)
    do update set author_order = excluded.author_order;

    v_kept_ids := v_kept_ids || v_researcher_id;
  end loop;

  delete from paper_researchers
  where paper_id = v_paper.id
    and researcher_id <> all(v_kept_ids);

  if p_corrections is not null then
    update papers set
      title = case when p_corrections ? 'title' then nullif(trim(p_corrections->>'title'), '') else title end,
      title_ar = case when p_corrections ? 'title_ar' then nullif(trim(p_corrections->>'title_ar'), '') else title_ar end,
      abstract = case when p_corrections ? 'abstract' then nullif(trim(p_corrections->>'abstract'), '') else abstract end,
      abstract_ar = case when p_corrections ? 'abstract_ar' then nullif(trim(p_corrections->>'abstract_ar'), '') else abstract_ar end,
      supervisor_name = case when p_corrections ? 'supervisor_name' then nullif(trim(p_corrections->>'supervisor_name'), '') else supervisor_name end,
      university = case when p_corrections ? 'university' then nullif(trim(p_corrections->>'university'), '') else university end,
      faculty = case when p_corrections ? 'faculty' then nullif(trim(p_corrections->>'faculty'), '') else faculty end,
      degree_type = case when p_corrections ? 'degree_type' then nullif(trim(p_corrections->>'degree_type'), '') else degree_type end,
      -- An unparseable year KEEPS the existing value (BUG_HISTORY.md #34).
      year = case
               when p_corrections ? 'year' then
                 case when nullif(trim(p_corrections->>'year'), '') is null
                      then null
                      else coalesce(normalize_year_text(p_corrections->>'year'), year) end
               else year
             end
    where id = v_paper.id;
  end if;

  update papers set metadata_confirmed_at = now() where id = v_paper.id;

  return jsonb_build_object('paper_id', v_paper.id, 'confirmed_at', now());
end;
$$;

revoke all on function record_declared_authors(uuid, jsonb) from public, anon, authenticated;
grant execute on function record_declared_authors(uuid, jsonb) to service_role;

commit;

-- ------------------------------------------------------------
-- Rollback (with the M2B/M3 application reverted):
--   begin;
--   <re-run the get_paper_for_confirmation body from 0011 and the
--    confirm_researcher_metadata body from 0010>;
--   <re-run the finalize_submission_intent body from 0012>;
--   drop function if exists record_declared_authors(uuid, jsonb);
--   commit;
-- The linkedin_public and declared_authors columns are left in place:
-- they are evidence of choices people made. Drop them only if no row has
-- linkedin_public = true and no acceptance has declared_authors.
-- ------------------------------------------------------------
