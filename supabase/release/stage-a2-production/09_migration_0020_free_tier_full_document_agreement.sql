-- ============================================================
-- 0020: Agreement version 4 - Gemini reading of the document itself under
-- Google's UNPAID (free-tier) terms (founder decision of 2026-10-04,
-- superseding the excerpt-only version 3).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- REQUIRES 0019 (the 'gemini_api_unpaid' arrangement value). Idempotent.
--
-- What it adds: agreement version 4 (docs/legal/submission-terms.v4.*.md),
-- seeded INACTIVE, with external_ai_processing = 'gemini_api_unpaid'. It
-- describes what the application actually does under those terms: the
-- first pages of the document (or text from a Word file) are sent to
-- Gemini, names included and nothing removed; Google may use inputs and
-- outputs to improve its products and machine-learning technologies;
-- human reviewers may process them; manual entry sends nothing.
--
-- Nothing else changes. Versions 1, 2 and 3 stay as they are (3 was
-- seeded by 0019 for the excerpt-only design and is superseded; it is not
-- to be activated). No existing row - agreement, acceptance or paper - is
-- modified, and no permission applies to an earlier paper: a paper is read
-- only under the arrangement its own acceptance recorded.
--
-- Rollback (only while nobody has accepted version 4):
--   select count(*) from submission_acceptances where agreement_version_id like 'submission-terms-2026-10-04-v4-%';  -- must be 0
--   delete from agreement_versions where id in ('submission-terms-2026-10-04-v4-en', 'submission-terms-2026-10-04-v4-ar');
-- ============================================================

begin;

insert into agreement_versions (id, agreement_key, language, version_label, version_date, content_sha256, active, external_ai_processing)
values
  ('submission-terms-2026-10-04-v4-en', 'submission-terms', 'en', 'Version 4', '2026-10-04',
   'fce461b4b47389de736e1d30bee44df48c3f3dd15fd6d3f14d7959059fc184c7', false, 'gemini_api_unpaid'),
  ('submission-terms-2026-10-04-v4-ar', 'submission-terms', 'ar', 'Version 4', '2026-10-04',
   '8b3c313eab99789b36226fb246f04628fd21f970777dee7e470cf06b92511231', false, 'gemini_api_unpaid')
on conflict (id) do nothing;

commit;
