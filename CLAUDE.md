# CLAUDE.md

This file is auto-loaded by Claude Code at the start of every session in this project. It exists to prevent two specific failure modes that have already happened repeatedly here: re-diagnosing a bug that's already fixed, and trusting that a fix is live in production when it isn't.

**This is a navigation hub, not a full reference.** Detail lives in `docs/`, `prompts/`, and `supabase/` — go there for anything beyond the essentials below.

---

## What this is

A low-budget platform for Sudanese research: a researcher submits a thesis or paper (PDF/DOCX), an AI extracts structured metadata, the researcher reviews and corrects it, then confirms it. The interface is bilingual (EN/AR). Submissions are accepted from any institution; public publication (Phase 3, not yet built) starts with approved University of Khartoum records only. One non-technical founder, near-zero budget — don't propose paid services or heavier dependencies without flagging the cost tradeoff explicitly. Full founding vision and product principles: `docs/vision.md`.

---

## The one operating principle that matters most here

**Deployment lag has been mistaken for a code bug at least three separate times on this project.** The fix was correct; it just wasn't live yet. Before debugging anything that looks like a regression:

1. Check whether the database reflects the expected change — a migration having run is not the same as the application code that writes to it being deployed.
2. If you have Supabase access, query `ai_generations.notes` / `papers.failure_code` / `papers.extraction_status` directly. The exact stored shape is a fingerprint of which code version produced it.
3. If you have GitHub access (the session that built most of this didn't), confirm the deployed branch matches what you're editing.

Full methodology: `docs/troubleshooting.md`. If using Claude Code's command system: `/verify-deployment`.

---

## Where everything is

| Need to know about... | Go to |
|---|---|
| **Current verified status** — what's confirmed working in production, open bugs, technical debt | `CURRENT_STATUS.md` (read this first; its dated top section is current) |
| **What's next** — Phase 3 milestones, founder decisions, unverified facts | `PHASE_3_PLAN.md` |
| Submission agreement (EN/AR) and what must be true before it is activated | `docs/legal/README.md` |
| Product vision, target users, non-negotiable standards | `docs/vision.md` |
| System architecture, stack choices and why, security model | `docs/architecture.md` |
| Database schema, tables, RPCs | `docs/database.md` + `supabase/schema.sql` (source of truth) + `supabase/functions/` |
| The two-pass extraction logic in detail | `docs/extraction-pipeline.md` |
| The actual prompt text | `prompts/metadata-extraction.md` (live) — `prompts/article-generation.md`, `prompts/validation.md` (not implemented, draft only) |
| Environment variables, deploy process | `docs/deployment.md` |
| Investigating something new | `docs/troubleshooting.md`, `.claude/memory/quick-reference.md` |
| Every bug ever fixed, with evidence | `BUG_HISTORY.md` |
| File-by-file audit of the whole repo | `PROJECT_MAP.md` (**historical**, 2026-09-12 — predates the Phase 1 closure and all of Phase 2; verify against the code) |
| Fuller architecture narrative | `CLAUDE_CODE_HANDOVER.md` (**historical**, 2026-09-12 — its §13 roadmap is superseded by `PHASE_3_PLAN.md`) |
| Earlier plans | `PHASE_2_PLAN.md`, `CLEANUP_PLAN.md` (**historical** — kept as record, not instructions) |
| Migration history and ordering | `supabase/migrations/README.md` |

`frontend/` and `backend/` are currently empty on purpose — see their own `README.md` files before assuming code should live there.

---

## Load-bearing constraints — don't weaken these without a deliberate decision

- **RLS is on for every table, fully locked to anonymous users.** The only way in is three `SECURITY DEFINER` RPCs. The confirmation flow's credential is a hashed token, **never the paper's UUID** — don't add a lookup path keyed on the bare id. (Storage is the exception: the `papers` bucket still allows anonymous inserts with no acceptance check. `PHASE_3_PLAN.md` M2 closes it; don't widen it meanwhile.)
- **The private confirmation link is never a public link.** Public records (Phase 3) get their own separate identifier; a confirmation token must never appear in a public page, search index, sitemap, analytics or export.
- **Publication restrictions apply on every path** — page, file, API response, search result, sitemap, citation export, activity count. Hiding a link is not access control.
- **No acceptance is ever backdated or synthesized**, and no migration expands an existing permission. Legacy consent columns are evidence; keep them unchanged.
- **Exactly two provider calls per extraction, enforced by the orchestrator's own control flow.** No loop should ever make this three.
- **`ai_generations` is append-only.** Never overwritten, never deleted — that's how several of the bugs in `BUG_HISTORY.md` were actually diagnosable after the fact.
- **A pass-2 failure must never discard a successful pass-1 result.** (`BUG_HISTORY.md` #10 — this already happened once.)
- **A field's JSON key must be stated explicitly in the prompt if you add one**, not left for the model to infer from a section header. (`BUG_HISTORY.md` #15 — this already happened once too.)
- **Distinct failure types get distinct messages.** Don't collapse them back into one generic error. (`BUG_HISTORY.md` #7.)
- **`schema.sql` is fresh-install only.** Never re-run it against the live database — every live change is its own file in `supabase/migrations/`.

---

## Guardrails

- Don't redesign the architecture to fix a small bug. Every fix in this project's history has been the smallest change that addresses a confirmed, evidenced root cause.
- Don't add a new AI provider, extraction mechanism, or heavy dependency unless the task explicitly calls for it.
- When something looks wrong, check `docs/troubleshooting.md`'s "known, disclosed limitations" first — some things that look like bugs are deliberate, disclosed tradeoffs.

@.claude/memory/quick-reference.md

Project commands: `/verify-deployment`, `/test-docx`, `/check-history` — defined in `.claude/commands/`.
