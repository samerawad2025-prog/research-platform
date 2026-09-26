-- ============================================================
-- 0011: durable record of manual metadata entry (Phase 3, M1).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
--
-- REQUIRED BEFORE THE M1 APPLICATION IS DEPLOYED, whatever
-- EXTRACTION_MODE production starts with. The M1 extraction route reads
-- these columns on every request and refuses to run (HTTP 503,
-- reason database_not_ready) until they exist. It never falls back to
-- calling the AI provider.
--
-- What it adds:
--   papers.manual_entry_at      when the decision was recorded
--   papers.manual_entry_source  'mode'       - the server was in manual
--                                              mode when this paper was
--                                              first handled
--                               'researcher' - the researcher chose to
--                                              enter the details
--                                              themselves
-- Both null (every existing row) means no manual decision.
--
-- Deliberately separate from extraction_status: that column keeps its
-- history ('pending', 'failed', 'completed', ...). A paper that had an
-- extraction attempt is never relabelled as if none happened. Once
-- manual_entry_at is set, the application never starts a new provider
-- call for the paper and never applies a late result to its metadata.
--
-- Also replaces get_paper_for_confirmation so it returns the two new
-- values. Same token check, same explicit allowlist, two extra keys.
--
-- Compatible with the application currently in production (tested in
-- supabase/tests/0011_manual_entry.test.sql): the old code selects
-- explicit columns, never these; nullable columns with no default
-- change nothing it writes; and the old confirmation page ignores the
-- two extra keys in the RPC's result.
--
-- Additive: no existing row, policy or grant changes.
--
-- Rollback: see the bottom of this file. Dropping the columns deletes
-- recorded manual decisions; after that, a paper whose researcher chose
-- manual entry is eligible for automatic extraction again. Do not roll
-- back while the M1 application is deployed.
-- ============================================================

begin;

alter table papers add column if not exists manual_entry_at timestamptz;
alter table papers add column if not exists manual_entry_source text;

alter table papers drop constraint if exists papers_manual_entry_source_check;
alter table papers add constraint papers_manual_entry_source_check
  check (manual_entry_source in ('mode', 'researcher'));

-- Recorded together or not at all.
alter table papers drop constraint if exists papers_manual_entry_pair_check;
alter table papers add constraint papers_manual_entry_pair_check
  check ((manual_entry_at is null) = (manual_entry_source is null));

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

  -- Explicit allowlist of fields, not select * — confirmation_token_hash
  -- and admin_notes are structurally impossible to leak here, not just
  -- filtered out by convention.
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
    -- Phase 3 M1 (migration 0011): whether this submission's details
    -- are being entered by hand, and why ('mode' or 'researcher'), so
    -- the choice survives a refresh or a reopened link.
    'manual_entry_source', v_paper.manual_entry_source,
    'manual_entry_at', v_paper.manual_entry_at,
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

revoke all on function get_paper_for_confirmation(text) from public;
grant execute on function get_paper_for_confirmation(text) to anon;

commit;

-- ------------------------------------------------------------
-- Rollback (only after the M1 application has been reverted):
--   select count(*) from papers where manual_entry_at is not null;  -- review these first
--   begin;
--   <re-run get_paper_for_confirmation from migration 0007>;
--   alter table papers drop constraint if exists papers_manual_entry_pair_check;
--   alter table papers drop constraint if exists papers_manual_entry_source_check;
--   alter table papers drop column if exists manual_entry_source;
--   alter table papers drop column if exists manual_entry_at;
--   commit;
-- ------------------------------------------------------------
