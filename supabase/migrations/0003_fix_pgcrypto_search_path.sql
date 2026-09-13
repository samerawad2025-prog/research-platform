-- ============================================================
-- Fix: gen_random_bytes()/digest() not found inside submit_paper(),
-- get_paper_for_confirmation(), and confirm_researcher_metadata().
--
-- Root cause: on Supabase, pgcrypto (which provides both functions)
-- is installed in a dedicated "extensions" schema, not "public".
-- Each of these three functions explicitly sets
--   set search_path = public
-- as a deliberate security measure (preventing search_path
-- injection). That's correct practice, but it also excludes the
-- schema pgcrypto actually lives in, so unqualified calls to
-- gen_random_bytes() and digest() fail to resolve.
--
-- Fix: widen search_path to "public, extensions" in all three.
-- Nothing else about these functions changes - same parameters,
-- same return types, same logic, same security model. This is a
-- CREATE OR REPLACE only; no data is touched, nothing is dropped.
-- ============================================================

create or replace function submit_paper(
  p_full_name text,
  p_email text,
  p_file_path text,
  p_permission_to_process boolean,
  p_publication_scope text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_researcher_id uuid;
  v_paper_id uuid;
  v_token text;
begin
  if p_permission_to_process is distinct from true then
    raise exception 'Permission to process is required to submit.';
  end if;

  if p_publication_scope is null or coalesce(array_length(p_publication_scope, 1), 0) = 0 then
    raise exception 'At least one publication preference is required.';
  end if;

  if not (p_publication_scope <@ array['full_paper', 'metadata_and_article', 'abstract_and_citation']) then
    raise exception 'Invalid publication scope value.';
  end if;

  if p_full_name is null or length(trim(p_full_name)) = 0 then
    raise exception 'Submitter name is required.';
  end if;

  if p_file_path is null or length(trim(p_file_path)) = 0 then
    raise exception 'A research file is required.';
  end if;

  insert into researchers (full_name, email)
  values (trim(p_full_name), nullif(trim(p_email), ''))
  returning id into v_researcher_id;

  v_token := encode(gen_random_bytes(32), 'hex');

  insert into papers (
    submitted_by, file_path, permission_to_process, publication_scope,
    status, extraction_status, confirmation_token_hash
  )
  values (
    v_researcher_id, p_file_path, true, p_publication_scope,
    'submitted', 'pending', encode(digest(v_token, 'sha256'), 'hex')
  )
  returning id into v_paper_id;

  insert into paper_researchers (paper_id, researcher_id, author_order)
  values (v_paper_id, v_researcher_id, 1);

  return jsonb_build_object('paper_id', v_paper_id, 'confirmation_token', v_token);
end;
$$;

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
      'facebook_url', r.facebook_url,
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

  return jsonb_build_object(
    'paper_id', v_paper.id,
    'title', v_paper.title,
    'title_ar', v_paper.title_ar,
    'abstract', v_paper.abstract,
    'abstract_ar', v_paper.abstract_ar,
    'supervisor_name', v_paper.supervisor_name,
    'year', v_paper.year,
    'methodology', v_paper.methodology,
    'publication_scope', v_paper.publication_scope,
    'extraction_status', v_paper.extraction_status,
    'metadata_confirmed_at', v_paper.metadata_confirmed_at,
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

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
  v_allow_social boolean;
  v_order int := 0;
  v_kept_ids uuid[] := '{}';
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

  v_allow_social := ('metadata_and_article' = any(v_paper.publication_scope));

  for v_item in select * from jsonb_array_elements(p_researchers)
  loop
    v_order := v_order + 1;

    if v_item->>'full_name' is null or length(trim(v_item->>'full_name')) = 0 then
      raise exception 'Each researcher needs a name.';
    end if;

    if (v_item->>'researcher_id') is not null
       and exists (
         select 1 from paper_researchers
         where paper_id = v_paper.id and researcher_id = (v_item->>'researcher_id')::uuid
       )
    then
      v_researcher_id := (v_item->>'researcher_id')::uuid;
      update researchers set
        full_name = trim(v_item->>'full_name'),
        linkedin_url = case when v_allow_social then nullif(v_item->>'linkedin_url', '') else linkedin_url end,
        facebook_url = case when v_allow_social then nullif(v_item->>'facebook_url', '') else facebook_url end
      where id = v_researcher_id;
    else
      insert into researchers (full_name, linkedin_url, facebook_url)
      values (
        trim(v_item->>'full_name'),
        case when v_allow_social then nullif(v_item->>'linkedin_url', '') else null end,
        case when v_allow_social then nullif(v_item->>'facebook_url', '') else null end
      )
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
      title = coalesce(nullif(p_corrections->>'title', ''), title),
      title_ar = coalesce(nullif(p_corrections->>'title_ar', ''), title_ar),
      abstract = coalesce(nullif(p_corrections->>'abstract', ''), abstract),
      abstract_ar = coalesce(nullif(p_corrections->>'abstract_ar', ''), abstract_ar),
      year = coalesce((p_corrections->>'year')::int, year),
      supervisor_name = coalesce(nullif(p_corrections->>'supervisor_name', ''), supervisor_name),
      methodology = coalesce(nullif(p_corrections->>'methodology', ''), methodology)
    where id = v_paper.id;
  end if;

  update papers set metadata_confirmed_at = now() where id = v_paper.id;

  return jsonb_build_object('paper_id', v_paper.id, 'confirmed_at', now());
end;
$$;
