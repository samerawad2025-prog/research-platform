-- ============================================================
-- Migration for your EXISTING live database only.
-- Run this once in Supabase -> SQL Editor -> New query -> Run.
-- (Do NOT run the full schema.sql again — that's for brand-new
-- projects only and would error on tables that already exist.)
--
-- This migration is NON-DESTRUCTIVE. It preserves every existing
-- paper, researcher, and file reference. No rows are deleted.
-- ============================================================

alter table papers drop constraint if exists papers_publication_scope_check;

-- Convert the column from a single value to a list of values.
-- Any paper that previously chose "private_processing_only" becomes
-- an empty array {} — an honest record that processing was permitted
-- but nothing was permitted to be made public. It is not deleted, and
-- nothing is invented on the researcher's behalf.
alter table papers
  alter column publication_scope type text[]
  using (
    case
      when publication_scope = 'private_processing_only' then array[]::text[]
      else array[publication_scope]::text[]
    end
  );

-- Table-level rule: any combination of the three current values, or
-- empty (a legitimate historical/admin state). This is intentionally
-- looser than what submit_paper() enforces below — see that function
-- for where "at least one value" is actually required.
alter table papers add constraint papers_publication_scope_check
  check (publication_scope <@ array['full_paper', 'metadata_and_article', 'abstract_and_citation']);

-- Replace submit_paper — the parameter type is changing from a single
-- value to a list, so the old version must be dropped first.
drop function if exists submit_paper(text, text, text, boolean, text);

create or replace function submit_paper(
  p_full_name text,
  p_email text,
  p_file_path text,
  p_permission_to_process boolean,
  p_publication_scope text[]
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_researcher_id uuid;
  v_paper_id uuid;
begin
  if p_permission_to_process is distinct from true then
    raise exception 'Permission to process is required to submit.';
  end if;

  -- New anonymous submissions must choose at least one public output.
  -- This is enforced here, not at the table level, so historical
  -- "private only" records can still legitimately exist as {}.
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

  insert into papers (
    submitted_by, file_path, permission_to_process, publication_scope,
    status, extraction_status
  )
  values (
    v_researcher_id, p_file_path, true, p_publication_scope,
    'submitted', 'pending'
  )
  returning id into v_paper_id;

  insert into paper_researchers (paper_id, researcher_id)
  values (v_paper_id, v_researcher_id);

  return v_paper_id;
end;
$$;

revoke all on function submit_paper(text, text, text, boolean, text[]) from public;
grant execute on function submit_paper(text, text, text, boolean, text[]) to anon;
