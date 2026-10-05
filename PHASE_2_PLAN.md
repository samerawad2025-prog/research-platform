# PHASE_2_PLAN.md

> **Status (2026-09-26): historical. Phase 2 is closed, and this plan is superseded by `PHASE_3_PLAN.md`.** This file is kept unedited below as the record of what was planned on 2026-09-16.
>
> **What happened to the items below:**
> - Bug letters below are this file's own. `CURRENT_STATUS.md` later reused some letters for different items, so match bugs by description, not by letter.
>   - A (typed `failure_code`), D, E and H were closed in Phase 1.
>   - B (`partial` never exercised) was closed by the first real `partial` outcome on 2026-09-19.
>   - G (`maxDuration`) was merged in PR #1 and deployed. `CURRENT_STATUS.md` records it as its item B.
>   - C (six orphaned `pending` papers) became moot when the original Supabase project was deleted on 2026-09-18.
>   - F remains a structural limitation.
>   - The evidence for all of these is in `CURRENT_STATUS.md`.
> - CI now exists (`.github/workflows/checks.yml`), and `README.md` was rewritten on 2026-09-26.
> - The phone input and country picker shipped in Phase 1 (#22, #23, #26).
> - The landing page and visual design system became Phase 2, delivered through PRs #6–#15 (see "Phase 2 closure" in `CURRENT_STATUS.md`).
> - The "further out" features in §2 (publication workflow, public search, admin dashboard) are now scheduled, in a changed form, as `PHASE_3_PLAN.md` M4–M6.
> - Article generation, social-media drafts and public profile pages are **not** scheduled.
>
> Do not act on the "Status" or "Recommended order" columns below; they describe 2026-09-16.

**Generated:** 2026-09-16, by reading `CURRENT_STATUS.md`, `CLEANUP_PLAN.md`, and `CLAUDE_CODE_HANDOVER.md` (all dated 2026-09-13, fetched from the live `research-platform` branch) plus this session's own findings from 2026-09-15/16. **Planning document only — nothing in this file has been implemented.**

Two items below (G, H) did not exist in any of the three source documents — they were found and already fixed in code during this session, but that fix (`samerawad2025-prog/research-platform#1`) is **not yet merged into `research-platform`**, which per this project's own recurring failure mode (`CLAUDE.md`: "deployment lag has been mistaken for a code bug at least three separate times") means they must be tracked as open until merge is confirmed and verified against live data, not treated as closed just because a patch exists.

---

## 1. Every remaining bug (plus two closed this session, listed for a complete picture)

| ID | Symptom | Source | Status |
|---|---|---|---|
| **A** | `failure_code` is `null` on all 10 historical failed papers | `CURRENT_STATUS.md` | **Open — unverified.** All 10 predate the resilience-phase deploy (last failure 2026-09-09); zero failures since. Code looks correct on inspection but has never been exercised by a real failure. |
| **B** | `extraction_status='partial'` has never occurred in production | `CURRENT_STATUS.md` | **Open — unverified.** Same root cause/evidence gap as A. |
| **C** | 6 papers permanently stuck at `extraction_status='pending'` | `CURRENT_STATUS.md` | **Open — needs a founder decision**, not a code fix. All 6 predate the current code's earliest generation record; orphaned by an earlier deploy. |
| **D** | GitHub MCP connector failed to connect (`Authorization header is badly formatted`) | `CURRENT_STATUS.md` | **Closed.** GitHub MCP has worked correctly throughout this entire session (repo reads, file deletes, PR creation/comments). No further action. |
| **E** | Three Vercel projects linked to one GitHub repo, ambiguous which serves production | `CURRENT_STATUS.md`, `CLAUDE_CODE_HANDOVER.md` §8 | **Closed this session.** Confirmed `research-platform-5zpu` is the only one ever Next.js-detected with a `production`-target deployment; the other two (`-88r9`, `research-platform`) were deleted by the founder. One verification step remains (see Critical Fixes, item 5). |
| **F** | No tool exists to read Vercel environment variables remotely | `CURRENT_STATUS.md`, `CLAUDE_CODE_HANDOVER.md` §5 | **Open — structural.** No MCP capability covers this; confirmed again this session (`Vercel` tools cover projects/teams/deployments/logs, not env vars). Mitigated by process, not fixable in code. |
| **G** | `app/api/extract/route.js` had no `maxDuration`, risking the platform's default function timeout killing an in-flight extraction and leaving `extraction_status='processing'` stuck forever with no diagnostics | Found this session (not in any of the 3 source docs) | **Fixed in code, not yet deployed.** Committed to `claude/current-status-paper-count-67xy5x`, open as samerawad2025-prog/research-platform#1 against `research-platform`. Blocked on a Vercel deployment-rate-limit that should clear ~2026-09-17T00:14Z (unrelated to the fix itself — see PR comment). |
| **H** | `title_ar`/`abstract_ar` JSON keys were never stated explicitly in the extraction prompt, the same inference gap that caused the `supervisor_name` bug (`BUG_HISTORY.md` #15) | Found this session | **Fixed in code, not yet deployed.** Same PR as G. Additionally **not yet tested against a real Arabic-only or bilingual document** — the prompt-wording change itself is unverified against live Gemini output. |

---

## 2. Classification

### Critical fixes
Directly affect data integrity, user-facing reliability, or leave the project's own diagnosability principle (`ai_generations` append-only, typed failure codes) unfulfilled.

- **G** — missing `maxDuration` (stuck-processing risk)
- **H** — `title_ar`/`abstract_ar` key ambiguity (silent data-quality gap for the platform's core Arabic-speaking user base)
- **A / B** — resilience-phase failure path unexercised (verification task, not necessarily a code change)
- **C** — 6 orphaned `pending` papers (data hygiene, real users affected, needs a decision)
- **E (residual)** — one verification step: confirm `research-platform-5zpu`'s Production Branch setting is still correct post-deletion of the other two projects

### Technical debt
No user-facing impact today; costs nothing to leave, but compounds if ignored.

- `README.md` describes the project as "Step 2" and points to a `DEPLOYMENT_GUIDE.md` that doesn't exist (`CLEANUP_PLAN.md`)
- `.env.local.example`'s `GEMINI_MODEL` comment is stale (`gemini-2.5-flash` vs. actual default `gemini-3.6-flash`) (`CLEANUP_PLAN.md`)
- No CI wired to `scripts/test-docx-extraction.js` — exists, works, runs on nobody's schedule (`CURRENT_STATUS.md`, `CLEANUP_PLAN.md`)
- `supabase/functions/*.sql` mirror files have no enforcement keeping them in sync with `schema.sql` (currently in sync; flagged as a structural risk, not a current bug) (`CLEANUP_PLAN.md`)
- `F` (no Vercel env var read tool) is arguably debt-shaped as much as bug-shaped — listed once, in bugs, to avoid double-counting
- **Not debt, explicitly KEEP-as-is per prior deliberate decisions** (listed so this plan doesn't accidentally re-litigate them): `methodology`/`keywords`/`themes` unused columns; legacy stale field names in old `ai_generations` rows; `frontend/`/`backend/` empty placeholder directories; the `supabase/functions/*.sql` mirror's continued existence (only its drift-risk is debt, not the file itself)

### Future features
Net-new capability, all pre-existing roadmap items from `CLAUDE_CODE_HANDOVER.md` §13 — none newly proposed here.

**Deferred UX work (explicitly paused for reliability, next in line):**
- Landing page redesign
- Visual design system (typography/spacing/color)
- Phone input with country picker (`libphonenumber-js`, E.164 storage) — also resolves the disclosed "WhatsApp field is plain text" limitation

**Not started, further out (Step 4+ of the original vision):**
- Accessible article generation from confirmed metadata (the actual "Step 4")
- Social media draft generation (LinkedIn/Facebook post copy)
- Publication workflow + public search/discovery site
- Admin dashboard, email notification system
- Public researcher/supervisor profile pages

**Explicitly rejected/deferred already, with reasoning recorded — do not rebuild without new evidence:**
- Real-time streaming extraction (`streamGenerateContent`) — rejected, not worth the complexity over honest skeleton-loading states
- Deterministic regex-based supervisor cross-check — superseded, the real root cause (BUG_HISTORY.md #15) was already fixed
- Per-field "Confirm" buttons on the confirmation screen — rejected in favor of single final confirmation

---

## 3 & 4. Recommended implementation order, with complexity / risk / user impact

| Order | Item | Complexity | Regression Risk | User Impact |
|---|---|---|---|---|
| 1 | **Merge PR #1** (G + H) once the Vercel rate limit clears; confirm CI/Approvals pass | Trivial (already coded, reviewed, syntax-checked) | Low — additive `maxDuration`, additive prompt clarification, no logic changed | High — closes a real stuck-forever failure mode (G) and a silent data-quality gap for the primary user base (H) |
| 2 | **Verify G and H against live data**, per `CLAUDE.md`'s own core operating principle: don't assume deployed, confirm via `ai_generations`/`papers`. For H specifically, submit one real Arabic-only and one real bilingual document and check `title_ar`/`abstract_ar` populate correctly | Low (verification, not development) | None (read-only verification) | High — this is the step that turns "fixed in code" into "actually fixed," the exact gap `CURRENT_STATUS.md` warns about for every other fix in this project's history |
| 3 | **Confirm `research-platform-5zpu`'s Production Branch setting** is unaffected by deleting the other two Vercel projects (item E's residual step) | Trivial (one dashboard check) | None | Medium — silent misconfiguration here would look identical to "deploy didn't land," a failure mode this project has hit repeatedly |
| 4 | **Force/simulate a real pass-2 failure against the live deployment** to exercise the resilience-phase path (A/B) — e.g., a deliberately short `GEMINI_TIMEOUT_MS` against one real submission, then revert | Medium (needs a safe, deliberate way to trigger a failure without risking a real user's submission) | Low if done against a test submission; must not be done against a real student's paper | Medium — this is explicitly flagged in `CURRENT_STATUS.md` as "the single largest confirmed-vs-assumed gap left"; if the resilience code has a latent bug, it will otherwise only surface during a real Gemini outage, in front of a real user |
| 5 | **Founder decision on the 6 orphaned `pending` papers** (C): manually re-trigger extraction, or mark abandoned | Low (one-time SQL update once decided) | Low — isolated to 6 known rows | Low-Medium — small N, but each is a real student whose submission never resolved |
| 6 | **Technical debt paydown**, in one sitting (all independently trivial): rewrite `README.md`; fix the `.env.local.example` `GEMINI_MODEL` comment; optionally wire `scripts/test-docx-extraction.js` into a CI step | Low | Low — docs/config only, except CI wiring which touches nothing runtime | Low — affects future contributors/onboarding, not current users |
| 7 | **First post-critical feature** — see §5 below | — | — | — |

**Why this order:** items 1–4 are the direct continuation of this project's own stated priority (`CURRENT_STATUS.md`: "no feature work should start before item 1 [the resilience verification] is closed"), items 5–6 are cheap and safe to slot in wherever there's spare time without blocking anything above, and no feature work begins until all of the above are either closed or turned into an explicit, founder-acknowledged exception.

---

## 5. First feature after all critical issues are closed

**Recommendation: the phone input redesign (country picker, `libphonenumber-js`, E.164 storage) — not the landing page or the visual design system, and not Step 4 article generation.**

Reasoning:
- It is the **smallest, most mechanically-defined** of the three deferred UX items. "Landing page redesign" and "visual design system" are open-ended and need iterative founder taste/feedback (higher risk of scope creep for a non-technical founder to evaluate and sign off on); the phone input is a well-scoped library swap with clear, testable acceptance criteria (valid E.164 output).
- It's **isolated to `SubmissionForm.jsx` plus one new dependency** — it touches zero extraction-pipeline code, so it carries essentially no regression risk to the reliability work items 1–4 just finished stabilizing. This matches the project's own established philosophy of preferring the smallest safe change (`CLAUDE.md`: "the smallest change that addresses a confirmed, evidenced root cause") extended naturally to feature sequencing, not just bug fixes.
- It **closes an already-disclosed limitation** (`CLAUDE_CODE_HANDOVER.md` §8, item 9: "WhatsApp field is plain text... deferred"), rather than opening a new one.
- It gives the founder **one concrete, shippable, low-ambiguity win** to build confidence before committing to the more subjective, higher-effort landing page/design system work — which should follow immediately after, in that order — with Step 4 (article generation) remaining the larger, later milestone it already is in the roadmap.

Do **not** start Step 4 (article generation) or the publication/discovery/admin-dashboard tier next — those are explicitly "further out" per `CLAUDE_CODE_HANDOVER.md` §13, substantially larger in scope, and depend on product decisions (what an "article" looks like, what publication review means) that haven't been made yet. Sequencing them before the smaller, already-decided UX items would violate this project's own stated pattern of shipping the smallest well-evidenced next step.
