create or replace function submit_paper(
  p_full_name text,
  p_email text,
  p_file_path text,
  p_permission_to_process boolean,
  p_publication_scope text[],
  p_whatsapp_number text default null
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

  -- Loose sanity check only, not a strict phone-format validator:
  -- international numbers vary too much in shape to police tightly.
  -- This just guards against obvious junk in a field meant for a
  -- phone number.
  if p_whatsapp_number is not null and length(trim(p_whatsapp_number)) > 0
     and trim(p_whatsapp_number) !~ '^[+0-9][0-9+\-\s()]{5,24}$' then
    raise exception 'That doesn''t look like a valid WhatsApp number.';
  end if;

  insert into researchers (full_name, email, whatsapp_number)
  values (trim(p_full_name), nullif(trim(p_email), ''), nullif(trim(p_whatsapp_number), ''))
  returning id into v_researcher_id;

  -- A 256-bit random value. This doesn't need slow password-style
  -- hashing (bcrypt etc.) the way a human-chosen password would —
  -- the entropy already comes from the token itself, a fast
  -- cryptographic hash is the correct tool here, not a heavier one.
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

  -- The raw token is handed back exactly once, here. From this point
  -- on only its hash exists anywhere in the system.
  return jsonb_build_object('paper_id', v_paper_id, 'confirmation_token', v_token);
end;
$$;

revoke all on function submit_paper(text, text, text, boolean, text[], text) from public;
grant execute on function submit_paper(text, text, text, boolean, text[], text) to anon;
