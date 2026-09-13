---
description: Run the DOCX extraction regression test against a real file
allowed-tools: Bash(node scripts/*)
---

Run `node scripts/test-docx-extraction.js $ARGUMENTS` against a real `.docx` file (a path must be supplied — this script intentionally has no synthetic fallback, since two separate root-cause hypotheses on this project were disproven only once a real file was checked; see `BUG_HISTORY.md` #12).

This checks header/footer extraction (university, faculty, degree recovery) and graceful degradation on unreadable input. It does not call Gemini and does not check the supervisor-key-normalization fix or the merge-filtering fix — those require either a live Gemini call or the mock provider (`AI_PROVIDER=mock`), not this script.

If no file path is provided, ask for one rather than inventing a synthetic test document.
