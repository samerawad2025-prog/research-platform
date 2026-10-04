-- ============================================================
-- 0019: Gemini under Google's UNPAID (free-tier) terms, with a minimized
-- excerpt only (founder decision of 2026-10-04: the Gemini API project is
-- confirmed free tier; paid Gemini is not the launch arrangement).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0018. Idempotent.
--
-- What it adds:
--   1. A second external AI arrangement value, 'gemini_api_unpaid', allowed
--      in agreement_versions.external_ai_processing and
--      submission_acceptances.ai_processing_terms. The existing constraint
--      is replaced by one that allows both values; no row changes.
--   2. Agreement version 3 (docs/legal/submission-terms.v3.*.md), seeded
--      INACTIVE, with external_ai_processing = 'gemini_api_unpaid'. It
--      describes what is actually done under those terms: a short excerpt
--      with names and contact details removed, never the document; no
--      request for any person's name; Google's use of inputs and responses
--      to improve its products, human review, 55-day abuse logging,
--      processing in any country; manual entry as the alternative.
--   3. external_ai_permission(paper): the same rule as 0018 (unchanged
--      reasons, same order), and when it permits, it also returns
--      known_names: the names this platform already holds for the paper
--      (the submitter and the people linked to it). The extraction route
--      uses them only as a deny-list while building the excerpt
--      (lib/extraction/excerpt.js); they are never sent anywhere.
--
-- Nothing becomes active: version 3 is inactive and extraction_policy is
-- not touched. Version 2 (paid terms) stays exactly as 0018 seeded it,
-- inactive; it is not to be activated unless the project is ever moved to
-- paid terms. No existing paper, acceptance or agreement row is modified,
-- and no permission applies to a paper created before this migration: a
-- paper is only ever read under the arrangement its own acceptance
-- recorded, and only when the server attests the same arrangement.
--
-- Compatible with the application in production (f45dc690), which calls
-- none of these functions, and with the 0018 release application.
--
-- Rollback: see the bottom of this file.
-- ============================================================

begin;

-- 1. The unpaid arrangement as a recognised value.
alter table agreement_versions drop constraint if exists agreement_versions_external_ai_processing_check;
alter table agreement_versions add constraint agreement_versions_external_ai_processing_check
  check (external_ai_processing in ('gemini_api_paid', 'gemini_api_unpaid'));
alter table submission_acceptances drop constraint if exists submission_acceptances_ai_processing_terms_check;
alter table submission_acceptances add constraint submission_acceptances_ai_processing_terms_check
  check (ai_processing_terms in ('gemini_api_paid', 'gemini_api_unpaid'));

-- 2. Version 3, inactive until the founder activates it.
insert into agreement_versions (id, agreement_key, language, version_label, version_date, content_sha256, active, external_ai_processing)
values
  ('submission-terms-2026-10-04-v3-en', 'submission-terms', 'en', 'Version 3', '2026-10-04',
   '54e064c2880d3b67d44fd632bacff70bf6a8f2d05ab28f9e2f05214dab03b988', false, 'gemini_api_unpaid'),
  ('submission-terms-2026-10-04-v3-ar', 'submission-terms', 'ar', 'Version 3', '2026-10-04',
   '54af258c7255ebad22b50fbfc7a74c7dc2b3b390bc77068813211ee8b232e2e0', false, 'gemini_api_unpaid')
on conflict (id) do nothing;

-- 3. The permission rule, as in 0018, plus the names held for the paper.
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
  v_names jsonb;
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

  select coalesce(jsonb_agg(distinct r.full_name) filter (where r.full_name is not null and length(trim(r.full_name)) > 0), '[]'::jsonb)
    into v_names
  from researchers r
  where r.id = v_paper.submitted_by
     or r.id in (select pr.researcher_id from paper_researchers pr where pr.paper_id = v_paper.id);

  return jsonb_build_object('permitted', true, 'terms', v_acc.ai_processing_terms,
                            'agreement_version_id', v_acc.agreement_version_id, 'known_names', v_names);
end;
$fn$;
revoke all on function external_ai_permission(uuid) from public, anon, authenticated;
grant execute on function external_ai_permission(uuid) to service_role;

commit;

-- ------------------------------------------------------------
-- Rollback (only with the 0019 application reverted, and while no
-- acceptance records ai_processing_terms = 'gemini_api_unpaid'):
--   select count(*) from submission_acceptances where ai_processing_terms = 'gemini_api_unpaid';  -- must be 0
--   select count(*) from submission_acceptances where agreement_version_id like 'submission-terms-2026-10-04-v3-%';  -- must be 0
--   begin;
--   <re-run external_ai_permission and its grants from 0018>;
--   delete from agreement_versions where id in ('submission-terms-2026-10-04-v3-en', 'submission-terms-2026-10-04-v3-ar');
--   alter table submission_acceptances drop constraint if exists submission_acceptances_ai_processing_terms_check;
--   alter table submission_acceptances add constraint submission_acceptances_ai_processing_terms_check check (ai_processing_terms in ('gemini_api_paid'));
--   alter table agreement_versions drop constraint if exists agreement_versions_external_ai_processing_check;
--   alter table agreement_versions add constraint agreement_versions_external_ai_processing_check check (external_ai_processing in ('gemini_api_paid'));
--   commit;
-- Once a paper exists from a version-3 acceptance, its acceptance record is
-- evidence: do not roll back; fix forward.
-- ------------------------------------------------------------
