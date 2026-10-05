-- ============================================================
-- 0018: Gemini reading by default, bound to an applicable agreement
-- version, with the researcher's own manual choice (founder decisions of
-- 2026-10-04, superseding the manual-only launch plan).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0011, 0012 and 0013. Independent of 0014-0017. Idempotent.
--
-- What it adds:
--   1. agreement_versions.external_ai_processing: which external AI
--      arrangement a version describes to the researcher. null means the
--      version does NOT authorize sending the document to an external AI
--      service. The two existing rows (2026-09-25) stay null and unchanged.
--      'gemini_api_paid' = the Gemini API under Google's paid-service terms.
--   2. Agreement version 2 (docs/legal/submission-terms.v2.*.md), seeded
--      INACTIVE, with external_ai_processing = 'gemini_api_paid'.
--   3. submission_acceptances.processing_choice ('automatic' | 'manual'):
--      the researcher's own choice, made before anything is sent anywhere;
--      and ai_processing_terms: the arrangement under which automatic
--      reading was permitted at acceptance (null unless the decision was
--      automatic). Both null on rows from before this migration.
--   4. create_submission_intent: new signature (adds the choice and the
--      arrangement the server attests to). The decision is automatic only
--      when the running application, the policy row, the signed offer, the
--      researcher's choice AND the accepted agreement version all allow it,
--      and the agreement's arrangement is the one the server attests to.
--      The old signature is dropped (only the release application calls it).
--   5. finalize_submission_intent (same signature as 0012/0013): a
--      submission whose researcher chose manual entry (when automatic
--      reading was offered) is created with that decision already recorded
--      (manual_entry_source = 'researcher'), in the same transaction, so no
--      request can ever start reading it.
--   6. The submission stamp: a paper inserted WITHOUT a server acceptance
--      (the legacy anonymous submit_paper path, kept during the rollout) is
--      stamped 'manual'. It carries no acceptance of an applicable
--      agreement, so it is never read automatically. Rows that already
--      exist keep their stamps: the trigger only acts on INSERT, and on
--      UPDATE it still keeps the old value.
--   7. external_ai_permission(paper): the one rule the extraction route
--      checks before any provider call. Permitted only for a paper created
--      from a finalized acceptance whose decision was automatic, whose
--      researcher chose automatic reading, and whose agreement version (same
--      text hash) describes the arrangement recorded at acceptance.
--   8. get_paper_for_confirmation returns automatic_processing (that rule's
--      answer), so the page never shows "reading your document" for a paper
--      that can never be read. Same signature; grants unchanged.
--
-- Nothing becomes active: both new agreement rows are inactive, and
-- extraction_policy is not touched (it stays as the operator set it).
-- Existing papers, acceptances and agreement rows are not modified; no new
-- permission applies to a paper created before this migration.
--
-- Compatible with the application currently in production (f45dc690):
-- it never calls the acceptance functions; it does not read the new key
-- in get_paper_for_confirmation; and it ignores the submission stamp (it
-- extracts every paper itself), so applying this changes nothing it does.
--
-- Rollback: see the bottom of this file.
-- ============================================================

begin;

-- 1. Which external AI arrangement an agreement version describes.
alter table agreement_versions add column if not exists external_ai_processing text;
alter table agreement_versions drop constraint if exists agreement_versions_external_ai_processing_check;
alter table agreement_versions add constraint agreement_versions_external_ai_processing_check
  check (external_ai_processing in ('gemini_api_paid'));

-- 2. Version 2, inactive until the founder activates it.
insert into agreement_versions (id, agreement_key, language, version_label, version_date, content_sha256, active, external_ai_processing)
values
  ('submission-terms-2026-10-04-en', 'submission-terms', 'en', 'Version 2', '2026-10-04',
   '468c51eb1e8edb493de94a969415c8fce28344523503bc43f409a2a45f459367', false, 'gemini_api_paid'),
  ('submission-terms-2026-10-04-ar', 'submission-terms', 'ar', 'Version 2', '2026-10-04',
   '3bcfe8c27a1046835423b38dc59e7f17d5b4deae94a28cf8273208ea5a71faf0', false, 'gemini_api_paid')
on conflict (id) do nothing;

-- 3. The researcher's choice, and the arrangement automatic reading was
--    permitted under, recorded with the acceptance.
alter table submission_acceptances add column if not exists processing_choice text;
alter table submission_acceptances drop constraint if exists submission_acceptances_processing_choice_check;
alter table submission_acceptances add constraint submission_acceptances_processing_choice_check
  check (processing_choice in ('automatic', 'manual'));
alter table submission_acceptances add column if not exists ai_processing_terms text;
alter table submission_acceptances drop constraint if exists submission_acceptances_ai_processing_terms_check;
alter table submission_acceptances add constraint submission_acceptances_ai_processing_terms_check
  check (ai_processing_terms in ('gemini_api_paid'));

-- 4. Record an acceptance (replaces the 0012 signature).
drop function if exists create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int, text, timestamptz);

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
  p_ttl_seconds int,
  p_offer_decision text,
  p_offer_issued_at timestamptz,
  p_processing_choice text,
  p_ai_processing_terms text
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
  -- Anything but an explicit 'automatic' is the researcher choosing manual.
  v_choice text := case when p_processing_choice = 'automatic' then 'automatic' else 'manual' end;
  v_terms text;
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

  -- The arrangement automatic reading may run under: the one the accepted
  -- text describes, and only if it is the one the server attests to.
  v_terms := case when v_agreement.external_ai_processing is not null
                       and v_agreement.external_ai_processing = p_ai_processing_terms
                  then v_agreement.external_ai_processing end;

  -- Automatic only when every authority says so. It can only narrow.
  v_decision := case when v_mode = 'automatic' and v_policy = 'automatic' and p_offer_decision = 'automatic'
                          and v_choice = 'automatic' and v_terms is not null
                     then 'automatic' else 'manual' end;
  v_path := 'intents/' || v_id::text || '/' || encode(gen_random_bytes(12), 'hex') || '.' || p_file_extension;

  insert into submission_acceptances (
    id, intent_token_hash, expires_at,
    agreement_version_id, agreement_language, agreement_sha256,
    claimed_role, publication_setting,
    processing_decision, processing_mode_at_acceptance, processing_policy_at_acceptance,
    processing_offer_decision, offer_issued_at,
    processing_choice, ai_processing_terms,
    full_name, email, whatsapp_number,
    object_path, file_extension, declared_size
  ) values (
    v_id, p_intent_token_hash, now() + make_interval(secs => p_ttl_seconds),
    v_agreement.id, v_agreement.language, v_agreement.content_sha256,
    p_claimed_role, p_publication_setting,
    v_decision, v_mode, v_policy,
    case when p_offer_decision = 'automatic' then 'automatic' else 'manual' end, p_offer_issued_at,
    v_choice, case when v_decision = 'automatic' then v_terms end,
    trim(p_full_name), trim(p_email), nullif(trim(p_whatsapp_number), ''),
    v_path, p_file_extension, p_declared_size
  )
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'object_path', v_row.object_path,
    'expires_at', v_row.expires_at,
    'accepted_at', v_row.accepted_at,
    'processing_decision', v_row.processing_decision,
    'processing_choice', v_row.processing_choice
  );
end;
$fn$;

-- 5. Finalize, as in 0013, plus: the researcher's manual choice is
--    recorded on the paper as it is created.
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
  v_manual_source text;
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
    select submission_extraction_policy, manual_entry_source into v_policy, v_manual_source from papers where id = v_row.paper_id;
    return jsonb_build_object('paper_id', v_row.paper_id, 'already_finalized', true, 'processing_decision', v_policy,
                              'processing_choice', v_row.processing_choice, 'manual_entry_source', v_manual_source);
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

  -- A researcher who chose manual entry gets it recorded here, atomically
  -- with the paper itself: there is no moment at which the paper exists
  -- without that decision. Only a real choice counts: when automatic
  -- reading was not even offered, 'manual' was the only possible answer,
  -- and the paper is simply stamped manual (the extraction route records
  -- that decision, as the server's, when it is first asked).
  insert into papers (
    submitted_by, file_path, permission_to_process, publication_scope,
    status, extraction_status, confirmation_token_hash,
    submission_acceptance_id, publication_setting, file_sha256, file_size,
    submission_extraction_policy, submission_decision_source,
    manual_entry_at, manual_entry_source
  ) values (
    v_researcher_id, v_row.object_path, false, '{}',
    'submitted', 'pending', p_confirmation_token_hash,
    v_row.id, v_row.publication_setting, p_object_sha256, p_object_size,
    v_row.processing_decision, 'server',
    case when v_row.processing_choice = 'manual' and v_row.processing_offer_decision = 'automatic' then now() end,
    case when v_row.processing_choice = 'manual' and v_row.processing_offer_decision = 'automatic' then 'researcher' end
  )
  returning id, submission_extraction_policy, manual_entry_source into v_paper_id, v_policy, v_manual_source;

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

  return jsonb_build_object('paper_id', v_paper_id, 'already_finalized', false, 'processing_decision', v_policy,
                            'processing_choice', v_row.processing_choice, 'manual_entry_source', v_manual_source);
end;
$fn$;

-- 6. The submission stamp. Server path: as in 0012 (the least permissive of
--    the server's decision and the policy row). Any other insert: manual.
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
      -- No server acceptance, so no acceptance of an agreement that allows
      -- external AI reading: never automatic, whatever the policy row says.
      new.submission_extraction_policy := 'manual';
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

-- 7. The rule checked before any provider call.
create or replace function external_ai_permission(p_paper_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_paper papers%rowtype;
  v_acc submission_acceptances%rowtype;
  v_agreement agreement_versions%rowtype;
begin
  select * into v_paper from papers where id = p_paper_id;
  if not found then
    return jsonb_build_object('permitted', false, 'reason', 'paper_not_found');
  end if;
  if v_paper.manual_entry_at is not null then
    return jsonb_build_object('permitted', false, 'reason', 'manual_entry_recorded');
  end if;
  if v_paper.submission_acceptance_id is null then
    -- Every paper created before 0018, and every paper from the legacy
    -- anonymous path: no acceptance of an applicable agreement exists.
    return jsonb_build_object('permitted', false, 'reason', 'no_applicable_acceptance');
  end if;
  select * into v_acc from submission_acceptances where id = v_paper.submission_acceptance_id;
  if not found or v_acc.status <> 'finalized' then
    return jsonb_build_object('permitted', false, 'reason', 'no_applicable_acceptance');
  end if;
  if v_acc.processing_choice = 'manual' and v_acc.processing_offer_decision = 'automatic' then
    return jsonb_build_object('permitted', false, 'reason', 'researcher_chose_manual');
  end if;
  if v_acc.processing_decision <> 'automatic' or v_acc.processing_choice is distinct from 'automatic'
     or v_paper.submission_extraction_policy is distinct from 'automatic'
     or v_paper.submission_decision_source is distinct from 'server' then
    return jsonb_build_object('permitted', false, 'reason', 'manual_decision');
  end if;
  select * into v_agreement from agreement_versions where id = v_acc.agreement_version_id;
  if not found or v_agreement.content_sha256 <> v_acc.agreement_sha256
     or v_acc.ai_processing_terms is null
     or v_agreement.external_ai_processing is distinct from v_acc.ai_processing_terms then
    return jsonb_build_object('permitted', false, 'reason', 'agreement_not_applicable');
  end if;
  return jsonb_build_object('permitted', true, 'terms', v_acc.ai_processing_terms, 'agreement_version_id', v_acc.agreement_version_id);
end;
$fn$;
revoke all on function external_ai_permission(uuid) from public, anon, authenticated;
grant execute on function external_ai_permission(uuid) to service_role;

-- 8. The confirmation read, as in 0013, plus automatic_processing.
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
    -- Phase 3, 0018: whether this paper may ever be read automatically.
    'automatic_processing', coalesce((external_ai_permission(v_paper.id) ->> 'permitted')::boolean, false),
    'researchers', v_researchers,
    'extraction_detail', v_extraction
  );
end;
$$;

revoke all on function get_paper_for_confirmation(text) from public;
grant execute on function get_paper_for_confirmation(text) to anon;

-- Service role only, as in 0012.
revoke all on function create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int, text, timestamptz, text, text) from public, anon, authenticated;
grant execute on function create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int, text, timestamptz, text, text) to service_role;
revoke all on function finalize_submission_intent(uuid, text, bigint, text, text) from public, anon, authenticated;
grant execute on function finalize_submission_intent(uuid, text, bigint, text, text) to service_role;

commit;

-- ------------------------------------------------------------
-- Rollback (only with the 0018 application reverted, and while no paper
-- was created from a version-2 acceptance):
--   select count(*) from submission_acceptances where processing_choice is not null;  -- review these first
--   begin;
--   <re-run get_paper_for_confirmation from 0013>;
--   drop function if exists external_ai_permission(uuid);
--   <re-run stamp_submission_extraction_policy() from 0012>;
--   <re-run finalize_submission_intent from 0013>;
--   drop function if exists create_submission_intent(text, text, text, text, text, text, text, text, text, text, text, bigint, int, text, timestamptz, text, text);
--   <re-run create_submission_intent and its grants from 0012>;
--   alter table submission_acceptances drop column if exists ai_processing_terms, drop column if exists processing_choice;
--   delete from agreement_versions where id in ('submission-terms-2026-10-04-en', 'submission-terms-2026-10-04-ar');  -- only if never accepted
--   alter table agreement_versions drop column if exists external_ai_processing;
--   commit;
-- Once a paper exists from a version-2 acceptance, its acceptance record is
-- evidence: do not roll back; fix forward.
-- ------------------------------------------------------------
