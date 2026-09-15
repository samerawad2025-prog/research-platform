# CLEANUP_PLAN.md

**Generated:** September 13, 2026, by direct audit of the repository (every item below was confirmed by reading the actual file, not assumed from memory). **Plan only — no deletions, moves, or renames were performed.** Each item is classified `SAFE TO DELETE`, `ARCHIVE`, or `KEEP`, with the evidence behind that classification and, where relevant, what would need to happen before acting on it.

This project has almost no accumulated cruft — it's young and has been kept deliberately minimal (see `CLAUDE.md`'s "don't add heavy dependencies" constraint). Most of what follows is small: stale example values and one outdated doc, not a backlog of dead code.

---

## Duplicate folders

**None found.** `frontend/` and `backend/` look like duplicates of the real `app/`/`lib/`/`components/` structure at a glance, but both contain only a `README.md` explaining they are **intentionally empty placeholders** reserved for a future restructuring that was scaffolded but deliberately not executed (moving the app under `frontend/` would require reconfiguring all three Vercel projects' Root Directory setting first — a live-site-breaking change that was explicitly not bundled into a docs-only pass).

| Item | Classification | Why |
|---|---|---|
| `frontend/` (README.md only) | **KEEP** | Deliberate, documented placeholder for a planned-but-not-executed restructuring. Not a duplicate of anything — the real code has never lived here. |
| `backend/` (README.md only) | **KEEP** | Same reasoning — documents that this project has no standalone backend and explains where one would go if ever added. |

No action needed unless the founder decides to actually execute the `frontend/`/`backend/` migration described in `frontend/README.md` — that's a deliberate infrastructure change, not a cleanup item, and would need its own separate, careful pass (moving code + reconfiguring 3 Vercel projects' Root Directory + redeploy verification).

---

## Obsolete files

| File | Finding | Classification |
|---|---|---|
| `README.md` (repo root) | Describes the project as **"Step 2"** ("A Next.js app with one working page: a public research submission form") — the project has since grown through the confirmation flow, two-pass extraction, and is now "Step 3" per `CLAUDE.md`. It also tells the reader to see **`DEPLOYMENT_GUIDE.md` for full setup steps** — no such file exists anywhere in the repository (confirmed via search). | **SAFE TO DELETE / REPLACE** — this is the one file a newcomer would read first, and it currently sends them to a dead file and undersells the app by a full phase. Recommend rewriting it to match `CLAUDE.md`'s actual description rather than archiving it (a `README.md` should always exist); flagged here because its *current content* is what should go, not the file itself. |
| `public/` (empty directory) | Contains no files — Next.js's `favicon.ico` for this app actually lives at `app/favicon.ico` (App Router convention), so this folder is currently unused. | **KEEP** — trivial, zero cost, and Next.js's tooling generally expects a `public/` directory to exist. Not worth any action. |

No other obsolete files were found. There are no backup files (`*.bak`, `*.old`, `*~`), no commented-out alternate implementations left in place, and no leftover ZIP-handoff artifacts in the repo itself (the handover notes that code was *delivered* as ZIPs, but none are committed here).

---

## Outdated docs

| File | Finding | Classification |
|---|---|---|
| `.env.local.example` | `GEMINI_MODEL=gemini-2.5-flash` is given as the "current, stable Flash model" default in a comment — but the actual code default (`lib/ai/providers/gemini.js:23`) is `gemini-3.6-flash`. A developer copying this file and leaving the comment's implied model unquestioned would get a stale mental model, though the app itself is unaffected (the line is commented-out/blank, so the code's own default wins). | **SAFE TO UPDATE** (not delete — this file must exist for onboarding). Update the comment and, if the intent is to show the real default explicitly, uncomment `GEMINI_MODEL=gemini-3.6-flash`. |
| `README.md` | See "Obsolete files" above — same file, same finding, listed here too since it's simultaneously an obsolete-content and outdated-doc problem. | **SAFE TO UPDATE** |

`CLAUDE.md`, `CLAUDE_CODE_HANDOVER.md`, `BUG_HISTORY.md`, `PROJECT_MAP.md`, and `CURRENT_STATUS.md` were all confirmed current as of the 2026-09-13 production-verification pass (see `CURRENT_STATUS.md`) — **KEEP**, no changes needed beyond what that pass already made.

`docs/architecture.md`, `docs/database.md`, `docs/deployment.md`, `docs/extraction-pipeline.md`, `docs/troubleshooting.md`, `docs/vision.md` — spot-checked against the current codebase during this pass (schema columns, RPC signatures, env vars, extraction flow); no contradictions found. **KEEP.**

`prompts/article-generation.md`, `prompts/validation.md` — both explicitly self-label `**Status: not implemented**` / `**Status: not a running pipeline stage**` at the top. This is accurate (confirmed: no article-generation or validation code exists anywhere in `lib/`) and is documented, deliberate draft material for future work, not stale content pretending to be current. **KEEP.**

`supabase/functions/*.sql` — these four files claim to be a mirror of `schema.sql` "purely for easier individual review." Spot-checked `get_paper_for_confirmation.sql` against `schema.sql` directly (the `failure_code` field, added in migration 0007) — **currently in sync**. Flagging as a **structural risk, not a current problem**: nothing enforces this mirror stays current, and the file's own header admits editing it directly has no effect. **KEEP for now; consider deleting this mirror entirely in a future pass** if it drifts again, since `schema.sql` is already the documented source of truth and the mirror's only value (easier per-function review) could equally be served by better organizing `schema.sql` itself.

---

## Dead code

**None found in application code.** Specifically checked for and ruled out:
- `extractTextLayer`/`pdf-parse`/`DOMMatrix` — the only remaining reference is a single explanatory comment in `lib/extraction/pdf.js` describing *why* PDF text extraction was deliberately removed (bug #2). Not dead code — a deliberate, load-bearing comment.
- `serverExternalPackages` (the old `pdf-parse` Next.js workaround) — confirmed absent from `next.config.mjs`, which is correctly minimal (`const nextConfig = {}`).
- No unused exports were found in `lib/extraction/` or `lib/ai/` — every exported function (`runExtraction`, `getMissingCriticalFields`, `getAllMissingFields`, `mergeResults`, `getDocumentType`, `decideApplication`, `buildPapersUpdate`, `APPLIABLE_FIELDS`, `extractDocxText`, `isOleCompoundFile`, `assertNotEncrypted`, `extractHeaderText`, `getPageCount`, `slicePages`, `findCandidateSections`) is imported and used by exactly the call sites `PROJECT_MAP.md` describes.

**Schema-level "dead code" (unused columns, not code):**

| Item | Finding | Classification |
|---|---|---|
| `papers.methodology`, `papers.keywords`, `papers.themes` columns | Declared nullable in `schema.sql`, never written to by any current code path (`APPLIABLE_FIELDS` in `lib/extraction/applyResult.js` does not include them) and never read by any RPC's return shape. This is a **documented, deliberate decision** (`CLAUDE_CODE_HANDOVER.md` §4: "Legacy, unused... do not resurrect extraction for these without a deliberate decision") after extraction scope was simplified for speed. | **KEEP** — removing a live database column is a schema change with real migration risk for near-zero benefit (three unused nullable columns cost nothing to leave). Not a cleanup-plan action; explicitly flagged in the docs as "don't touch without a deliberate decision," which this plan is not. |

---

## Unused dependencies

Checked every entry in `package.json` against actual imports in the codebase:

| Dependency | Used by | Classification |
|---|---|---|
| `@supabase/supabase-js` | `lib/supabaseClient.js`, `lib/supabaseAdminClient.js` | **KEEP** |
| `jszip` | `lib/extraction/docx.js` (direct header-XML reading) | **KEEP** — declared explicitly even though it also arrives transitively via `mammoth`, per `PROJECT_MAP.md`'s own note; this is intentional, not redundant. |
| `mammoth` | `lib/extraction/docx.js` | **KEEP** |
| `next`, `react`, `react-dom` | Framework itself | **KEEP** |
| `pdf-lib` | `lib/extraction/pdf.js` (page slicing only) | **KEEP** |
| `eslint`, `eslint-config-next` (dev) | `eslint.config.mjs` | **KEEP** |

**No unused dependencies were found.** `pdf-parse` was already fully removed from `package.json` in an earlier fix (`BUG_HISTORY.md` #2) — confirmed absent, not lingering. This is a genuinely lean dependency list; there is nothing to prune here.

---

## Summary table

| Category | Safe to delete | Archive | Keep (no action) |
|---|---|---|---|
| Duplicate folders | — | — | `frontend/`, `backend/` |
| Obsolete files | `README.md` content (rewrite, don't just delete the file) | — | `public/` (empty, harmless) |
| Outdated docs | — | — | `.env.local.example` (update comment, don't delete), all core docs, `prompts/*` drafts, `supabase/functions/*` mirror |
| Dead code | — | — | Nothing found; `methodology`/`keywords`/`themes` columns kept per explicit prior decision |
| Unused dependencies | — | — | All current dependencies confirmed in use |

## Recommended next step

This repository doesn't need an archive pass — nothing here qualifies as "keep around just in case." The only two concrete actions worth taking (both trivial, both editing rather than deleting) are:
1. Rewrite `README.md` to match the project's actual current state and point at real files (or point to `CLAUDE.md`/`CURRENT_STATUS.md` instead of inventing a new setup doc).
2. Fix the stale `GEMINI_MODEL` comment in `.env.local.example`.

Both are small enough to do in the same sitting as this plan, but per the instruction for this pass, no changes have been made — this file is the plan only.
