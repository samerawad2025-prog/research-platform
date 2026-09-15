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
    -- A key present but empty means the submitter cleared the field
    -- deliberately (the extraction was wrong and there is no correct
    -- value). A key absent entirely means they didn't touch it, so
    -- the existing value stands.
    update papers set
      title = case when p_corrections ? 'title' then nullif(trim(p_corrections->>'title'), '') else title end,
      title_ar = case when p_corrections ? 'title_ar' then nullif(trim(p_corrections->>'title_ar'), '') else title_ar end,
      abstract = case when p_corrections ? 'abstract' then nullif(trim(p_corrections->>'abstract'), '') else abstract end,
      abstract_ar = case when p_corrections ? 'abstract_ar' then nullif(trim(p_corrections->>'abstract_ar'), '') else abstract_ar end,
      supervisor_name = case when p_corrections ? 'supervisor_name' then nullif(trim(p_corrections->>'supervisor_name'), '') else supervisor_name end,
      university = case when p_corrections ? 'university' then nullif(trim(p_corrections->>'university'), '') else university end,
      faculty = case when p_corrections ? 'faculty' then nullif(trim(p_corrections->>'faculty'), '') else faculty end,
      degree_type = case when p_corrections ? 'degree_type' then nullif(trim(p_corrections->>'degree_type'), '') else degree_type end,
      year = case
               when p_corrections ? 'year' then
                 case when nullif(trim(p_corrections->>'year'), '') ~ '^[0-9]{4}$'
                      then (p_corrections->>'year')::int
                      else null end
               else year
             end
    where id = v_paper.id;
  end if;

  update papers set metadata_confirmed_at = now() where id = v_paper.id;

  return jsonb_build_object('paper_id', v_paper.id, 'confirmed_at', now());
end;
$$;

revoke all on function confirm_researcher_metadata(text, jsonb, jsonb) from public;
grant execute on function confirm_researcher_metadata(text, jsonb, jsonb) to anon;
