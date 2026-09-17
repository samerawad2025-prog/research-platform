---
description: Check whether recent code changes are actually deployed before debugging a suspected regression
---

Before investigating this as a code bug, verify it isn't the deployment-lag problem that has already happened at least three times on this project (see `BUG_HISTORY.md` and `CLAUDE.md`'s "one operating principle that matters most" section).

Do this, in order:

1. If Supabase access is available, query `papers.failure_code`, `papers.extraction_status`, and `ai_generations.notes` for the most recent relevant rows. The exact stored shape (field names present, error string format, whether `partial` has ever appeared) is a fingerprint of which code version actually produced it — compare it against what the *current* source code would actually produce or write.
2. If Vercel access is available, check the runtime error logs for the exact error string format. A stale error format (e.g., a log line that doesn't match any string literal in the current codebase) is strong evidence the deployed code is older than what's being reviewed.
3. If GitHub access is available, confirm the deployed branch's latest commit matches what's being edited.
4. Only after ruling out deployment lag, proceed to debug the code itself.

Report which of these checks were possible, what they showed, and whether the issue is confirmed to be a real code bug or a deployment gap, before proposing any fix.

Argument (optional): $ARGUMENTS — a specific symptom or error message to check against current source.
