# CURRENT_STATUS.md

**Generated:** September 13, 2026, by direct query against the live Supabase production database (project `jyqvhaqyrsfqkkcxiwth`) — every claim below is backed by a query result, not carried over from prior notes. This supersedes the "Known issues" section of `CLAUDE_CODE_HANDOVER.md` as the current source of truth; that file's history sections remain accurate for *how* things were found and fixed.

---

## Production status (live snapshot, 2026-09-13)

- **44 total papers**: 28 `completed`, 10 `failed`, 6 `pending`, 0 `processing`, 0 `partial`.
- **77 `ai_generations` rows** on `provider='gemini'`, `model_used='gemini-3.6-flash'`, spanning 2026-09-03 through **2026-09-13 20:52** (today — extraction is actively running against the real Gemini API, not just mock).
- 8 older `ai_generations` rows have `model_used=null` (pre-dates the model-name being recorded; historical only).
- No `supabase_migrations` tracking rows exist (migrations are applied by hand via the SQL Editor, consistent with `supabase/migrations/README.md` — this is expected, not a gap).

---

## Confirmed working features (verified against real production data, not mock)

- **Two-pass extraction pipeline is live and functioning** on real documents via the real Gemini API. Recent runs show `"Merged result after 1 pass(es)..."` notes with correct document-type classification (`thesis`, `journal_article`) on real submissions as recent as today.
- **Supervisor key fix (was `BUG_HISTORY.md` #15) — now production-confirmed.** Of the 15 most recent `ai_generations` rows, 14 return the key `supervisor_name` directly; the one exception is a single row from 2026-09-11 22:19, which predates the fix reaching production. No `supervisor`-keyed row has appeared since. Previously this fix was verified only against mock/reconstructed data — that gap is now closed.
- **DOCX header extraction (was `BUG_HISTORY.md` #16) — now production-confirmed.** Multiple real theses submitted 2026-09-11 and 2026-09-13 show `university`, `faculty`, and `degree_type` populated (e.g. "University of Khartoum" / "School of Management Studies" / "Bachelor of Business Administration & Finance"), sourced from DOCX header XML that `mammoth` alone cannot read. Previously verified only against one forensic test file — now confirmed across multiple independent real submissions.
- **Merge-filtering fix (`BUG_HISTORY.md` #13) — reconfirmed.** A real thesis submitted 2026-09-11 (`13e90987-...`) shows all 6 researchers preserved intact through a two-pass merge, matching the fix's intent.
- **Document-type classification** is discriminating correctly in production: real `thesis` and `journal_article` documents are both present and correctly classified in recent data.
- **`ai_generations` append-only history** is intact — no evidence of any row being overwritten or deleted.

## Open bugs

| # | Symptom | Evidence | Status |
|---|---|---|---|
| A | `failure_code` is `null` on every one of the 10 failed papers | All 10 failures are dated 2026-09-07 through 2026-09-09 16:03, each with a raw, unparsed `"Gemini API error 503: ..."` note — the exact shape the *pre-resilience-phase* code would produce. **Zero failures of any kind have occurred since 2026-09-09.** | **Unresolved, but unexercised, not disproven.** The resilience-phase code (migration `0007_resilience_phase.sql`, bounded retry, typed `failure_code`) may well be deployed and correct — there has simply been no real failure since to test it against. Do not treat this as fixed until a genuine failure occurs (or is deliberately forced) and produces a populated `failure_code`. |
| B | `extraction_status='partial'` has never occurred, ever | Same 10 failures above all show `extraction_status='failed'`, not `partial` — but all predate the resilience-phase deploy window (last one 2026-09-09 16:03; production has been failure-free since). | Same as A — unexercised, not confirmed broken. |
| C | 6 papers permanently stuck at `extraction_status='pending'` | All 6 are dated 2026-08-19 through 2026-09-02 — i.e. from before the current code's earliest generation record (2026-09-03). Almost certainly orphaned by an earlier deploy (missing-service-role-key era, bug #4, or before the CAS-claim logic existed) rather than a live bug. | Not actively reproducing. Needs a founder decision: manually re-trigger or mark these 6 as abandoned — not a code fix. |
| D | GitHub MCP connector fails to connect in this session (`bad request: Authorization header is badly formatted`) | Confirmed this session. | Environment/credentials issue, not a code bug. Blocks direct repo/branch verification until fixed. |
| E | Three Vercel projects linked to the same GitHub repo | Unchanged since last handover; not independently re-verified this session (no Vercel MCP tool was queried). | Still open — needs a manual check of which project's Production Branch setting is actually live. |
| F | No tool available to read Vercel environment variables remotely | Unchanged. | Still open, structural (no such Vercel MCP capability exists here). |

## Items removed from "open" status (closed by this verification pass)

The following were carried as *unconfirmed against live data* in `CLAUDE_CODE_HANDOVER.md` §8 and are now confirmed by direct production evidence, listed above:
- Supervisor key normalization (#15) — **confirmed live**, no longer "mock-tested only."
- DOCX header extraction (#16) — **confirmed live**, no longer "mock-tested only."
- Researcher-list merge filtering (#13) — **reconfirmed** against fresh real data (previously confirmed against older real data only).

## Technical debt

- 6 orphaned `pending` papers pre-dating current code — cosmetic/data cleanup, not urgent, but visible in any admin view once one exists.
- Three ambiguous Vercel project links to the same repo (handover §8 item 2) — unresolved housekeeping risk (wrong project could get edited/promoted by mistake).
- No CI wired to `scripts/test-docx-extraction.js` — it exists and works standalone but isn't run automatically on any change.
- Legacy `ai_generations` rows (8, `model_used=null`) and stale field names in older rows (`methodology`, `keywords`, `abstract_en`, etc.) — historical only, already documented, no action needed.
- `methodology`/`keywords`/`themes` columns remain in `papers` schema, unused since extraction scope was simplified — harmless, but a future schema reviewer should know they're intentionally dead.
- GitHub connectivity from this assistant session is currently broken — should be fixed before relying on this session for repo-state checks.

## Next recommended priorities

1. **Force a real (or realistically simulated) pass-2/API failure against the live deployment** to actually exercise the resilience-phase code path (`failure_code` population, `partial` status) — this is the single largest confirmed-vs-assumed gap left. Nothing currently proves or disproves it in production.
2. **Resolve the 3-Vercel-project ambiguity** — confirm `research-platform-5zpu` is definitively the only one with traffic, and consider deleting or clearly relabeling the other two to prevent a future accidental edit to the wrong one.
3. **Decide what to do with the 6 orphaned `pending` papers** (manually re-trigger extraction, or mark abandoned) — founder decision, not a code change.
4. **Fix the GitHub MCP connector** (`Authorization header is badly formatted`) so future sessions have direct repo/branch/commit visibility instead of relying solely on Supabase fingerprinting.
5. Only after the above: resume the explicitly-paused roadmap work (landing page/design system, phone input, or Step 4 article generation) per `CLAUDE_CODE_HANDOVER.md` §13 — no feature work should start before item 1 above is closed, since it's the one open question that could still hide a real production bug.
