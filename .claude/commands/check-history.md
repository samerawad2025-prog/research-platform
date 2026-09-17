---
description: Check whether a symptom or proposed change is already covered by documented history before acting on it
---

Before treating $ARGUMENTS as a new problem or a new idea, check whether it's already addressed:

1. Search `BUG_HISTORY.md` for a matching symptom, field name, or file. If found, read the full entry (root cause, investigation summary, fix, files modified, regression testing) before proposing anything — don't re-diagnose from scratch what's already been diagnosed with evidence.
2. Search `CLAUDE_CODE_HANDOVER.md`'s "Known issues" section for whether this is a disclosed, deliberate tradeoff rather than an oversight (e.g., `university`/`faculty`/`degree_type` having no independent pass-2 trigger is a known, disclosed choice).
3. Search `PROJECT_MAP.md` for which file actually owns the relevant behavior before guessing.

If nothing matches, say so plainly and proceed as a genuinely new investigation — don't force a fit to an unrelated past bug.
