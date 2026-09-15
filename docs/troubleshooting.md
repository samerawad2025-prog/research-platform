# Troubleshooting

For a fast symptom → cause lookup, see `.claude/memory/quick-reference.md`. For full detail on any specific bug (root cause, investigation, fix, files, regression tests), see `BUG_HISTORY.md`. This document is the *methodology* — how to investigate something new, and the one lesson worth internalizing before doing anything else.

## The lesson that matters most on this project

**Deployment lag has repeatedly been mistaken for a code bug — at least three separate times.** The fix was correct; it simply wasn't live in production yet. Before treating anything as a new bug or an unfixed regression:

1. **Check whether the database reflects the expected change.** A migration having run is not the same as the application code that writes to it being deployed. If a column exists but is always `null` where the current code should be populating it, that's a strong signal the *code*, not the schema, is stale.
2. **Compare the exact shape of a real error or log line against what the current source would actually produce.** The precise wording, structure, and field names present in a stored error are a fingerprint of which code version generated it. This is literally how deployment lag was caught before — by noticing a Vercel log string that didn't match any string literal in the current codebase.
3. **Confirm which of the three linked Vercel projects is actually serving traffic**, and which branch it deploys from, before trusting its logs or settings (see `deployment.md`).
4. Only after ruling out deployment lag, treat it as a genuine code problem.

## General investigation approach

- **Prefer a real uploaded file over a synthetic test document whenever one is available.** Two separate hypotheses in this project's history were confidently stated and then disproven once a real production file was actually inspected — a text-box content-loss theory, and a Gemini-nondeterminism theory for the supervisor field (`BUG_HISTORY.md` #12 and #15). Treat any root-cause conclusion as provisional until checked against real data.
- **Query real `ai_generations` records directly** rather than reasoning from what the code *should* produce. Several of the most subtle bugs on this project (a field returned under the wrong JSON key, a merge silently accepting an unrequested field) were only found this way — the code looked correct on inspection alone.
- **Use the mock provider (`AI_PROVIDER=mock`, `MOCK_SCENARIO=thesis|article|not_research`) to test pipeline logic** before spending a real Gemini call. It's zero-cost, deterministic, and covers all four uncertainty states in the `thesis` scenario.
- **`scripts/test-docx-extraction.js`** — run against any real `.docx` file to check header extraction and graceful degradation.
- Don't collapse distinct failure types back into one generic error message — that was itself a fixed bug (`BUG_HISTORY.md` #7). If you're adding a new failure mode, give it its own `ExtractionError` code and its own user-facing message.

## Known, disclosed limitations (not bugs to "fix" reflexively)

- `university`/`faculty`/`degree_type` have no independent pass-2 trigger — a deliberate cost/speed tradeoff, not an oversight.
- Encrypted-DOCX detection (OLE/CFB signature) also matches a legacy `.doc` file mislabeled with a `.docx` extension — both are equally unprocessable today, treated the same on purpose.
- Legacy `ai_generations` rows contain stale field names from earlier prompt iterations (`methodology`, `keywords`, `abstract_en`, etc.) — historical only; the current prompt doesn't produce these.

Check `CLAUDE_CODE_HANDOVER.md`'s "Known issues" section before assuming something surprising is new.
