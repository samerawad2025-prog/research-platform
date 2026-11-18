## Single submission checkbox: 18 November 2026

Version 5 includes the AI reader and reviewed articles in the general terms. New submissions accepting V5 show one unchecked checkbox, in English or Arabic. The exact complete agreement is the immutable permission notice. Finalization records the permission in the same transaction as the paper; failure rolls back both, and retries cannot regrant after withdrawal. No browser-storage handoff or second confirmation checkbox is needed for V5. Previous versions retain their original optional consent flow and evidence.

Reader/article processing remains limited to approved public titles and abstracts. Manual metadata entry, sharing choices, public eligibility and editorial review remain. Permission can still be withdrawn from private research settings. No existing paper receives a new grant.

Release: migration 0022 seeds V5 inactive. Deploy compatible application code before activating only V5 EN/AR. To revert the offered terms, reactivate V4 EN/AR without deleting V5 or changing any acceptance or permission record. Hosted checks cover exact legal hashes, transactional rollback, retry after withdrawal, old-version compatibility and bilingual single-checkbox rendering. See PR checks and deployment evidence for completion status.

Google data-use disclosure was checked against https://ai.google.dev/gemini-api/terms on 18 November 2026. New text removes previously stated provider revision dates and a fixed abuse-monitoring retention period, rather than presenting them as current guarantees. No claim that consent overrides provider restrictions.

The existing knowledge-v1 notice remains unchanged for legacy permissions and subsequent voluntary permission changes in Research settings. Initial V5 grants reference submission-v5-2026-11-18, containing the entire accepted agreement in both languages. Acceptance time remains on submission_acceptances; the materialized permission event records finalization time. Withdrawal remains a later append-only event.

The hosted test Supabase project was unavailable during preparation. Hosted CI uses isolated Postgres for fresh-install and upgrade tests, without private data or production writes.
