-- ============================================================
-- 0011: 'manual' extraction status (Phase 3, M1).
-- Run once in Supabase -> SQL Editor -> New query -> Run.
-- Additive and non-destructive: widens one CHECK constraint. No row,
-- function, policy or grant is changed.
--
-- 'manual' means: no automatic extraction was attempted for this
-- paper, because the server's EXTRACTION_MODE was 'manual' when it was
-- first asked. The researcher enters the details themselves. It is
-- deliberately NOT 'completed': nothing was extracted, and a manual
-- record must never read as a successful AI extraction.
--
-- The application tolerates this migration being absent (the write is
-- refused, logged as manual_status_not_recorded, and the paper stays
-- 'pending', which the confirmation screen already treats as manual
-- entry in manual mode). Apply it BEFORE switching production to
-- EXTRACTION_MODE=manual so the status is actually recorded.
--
-- Rollback (only once no row uses the value):
--   select count(*) from papers where extraction_status = 'manual';  -- must be 0
--   alter table papers drop constraint if exists papers_extraction_status_check;
--   alter table papers add constraint papers_extraction_status_check
--     check (extraction_status in ('pending', 'processing', 'completed', 'partial', 'failed'));
-- If rows do use it, decide per row first; never rewrite them to
-- 'completed'. Moving them back to 'pending' would make them eligible
-- for automatic extraction again, which their submitters were not told.
-- ============================================================

begin;

alter table papers drop constraint if exists papers_extraction_status_check;
alter table papers add constraint papers_extraction_status_check
  check (extraction_status in ('pending', 'processing', 'completed', 'partial', 'failed', 'manual'));

commit;
