-- 0008_extraction_claim_timestamp.sql
--
-- Adds papers.extraction_started_at: when the extract route CLAIMED
-- this paper, not when the paper was submitted.
--
-- Why it is needed. The claim in app/api/extract/route.js is a
-- compare-and-swap that only ever matches `extraction_status =
-- 'pending'`. That is correct for preventing double extraction, but it
-- also means a paper that reached 'processing' and then lost its
-- function - a timeout, an instance killed mid-run, a deploy - can
-- never be claimed by anything again. It is stuck permanently, and the
-- confirmation page's own "Try again" cannot rescue it, because that
-- calls the same route and hits the same guard. This is the open bug
-- recorded as J in CURRENT_STATUS.md, and it was proven materially
-- harmful on paper bb6db427, which had to be repaired by hand.
--
-- Why a new column rather than reusing created_at. The two are usually
-- seconds apart, but not always: the confirmation page can trigger
-- extraction long after submission (bb6db427 was claimed a day later).
-- Judging staleness from created_at would therefore let a SECOND
-- request reclaim a paper whose first extraction is still legitimately
-- running, causing a duplicate run and duplicate provider calls - the
-- exact thing the CAS exists to prevent. The claim time is the only
-- honest basis for "has this been running too long".
--
-- Safety: purely additive, nullable, no default, no backfill, no
-- rewrite of existing rows. Existing rows keep NULL, which the route
-- treats as "not reclaimable by age" - so behaviour for anything
-- already in flight is unchanged.

alter table papers
  add column if not exists extraction_started_at timestamptz;

comment on column papers.extraction_started_at is
  'When the extract route claimed this paper (status -> processing). Basis for reclaiming an abandoned extraction; see BUG_HISTORY.md #27.';

-- Partial index: the reclaim query only ever looks at rows currently in
-- 'processing', which is a tiny slice of the table. Keeps that lookup
-- cheap without carrying an index over every completed paper.
create index if not exists papers_processing_started_idx
  on papers (extraction_started_at)
  where extraction_status = 'processing';
