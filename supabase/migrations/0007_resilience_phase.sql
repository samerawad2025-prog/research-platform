-- ============================================================
-- Resilience phase migration.
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Non-destructive: widens one constraint, updates one function's
-- return shape. No data is deleted or altered.
-- ============================================================

-- Add 'partial' as a valid extraction_status: pass 1 succeeded and its
-- result is live on the paper, pass 2 could not complete (after its own
-- retry). Distinct from 'failed' (nothing usable) and 'completed'
-- (nothing missing that a retry could have fixed).
alter table papers drop constraint if exists papers_extraction_status_check;
alter table papers add constraint papers_extraction_status_check
  check (extraction_status in ('pending', 'processing', 'completed', 'partial', 'failed'));

-- get_paper_for_confirmation now also returns failure_code. It was
-- added to the papers table in the prior phase but never actually
-- returned here, so the client had no way to tell an encrypted-file
-- rejection apart from any other failure. Same security model as
-- before: still gated by the token, still an explicit field allowlist.
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
    'university', v_paper.university,
    'faculty', v_paper.faculty,
    'degree_type', v_paper.degree_type,
    'document_type', v_paper.document_type,
    'failure_code', v_paper.failure_code,
    'publication_scope', v_paper.publication_scope,
    'extraction_status', v_paper.extraction_status,
    'metadata_confirmed_at', v_paper.metadata_confirmed_at,
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

revoke all on function get_paper_for_confirmation(text) from public;
grant execute on function get_paper_for_confirmation(text) to anon;
