# HANDOVER — Sudanese Academic Research Platform

Written 2026-10-07 for the next AI coding agent (ChatGPT Codex) with GitHub, Supabase and
Vercel connectors. Every fact below was checked live on 2026-10-07 unless marked otherwise.
**Read this file first, then `AGENTS.md`, then `docs/release-runbook.md`.**

> The repository is **PUBLIC**. Never commit a key, token, secret, `.env` file, a private
> confirmation link, or a real person's personal data. Keep `.claude/settings.local.json`
> uncommitted.

---

## 1. What this is (in one minute)

A low-budget platform for Sudanese research. A researcher submits a thesis or paper
(PDF or Word), accepts a bilingual (English/Arabic) submission agreement, and the server
reads the document with **Google Gemini (free tier)** to suggest title, authors,
supervisor, year, university, etc. The researcher checks and corrects the suggestions,
then confirms. Manual entry is always available and sends nothing to Google. Later phases
add an admin review workflow and a public research catalogue (both built, **switched off**).

Owner: one non-technical founder (Samer, GitHub `samerawad2025-prog`). Near-zero budget:
never propose paid services without stating the cost. Detailed vision: `docs/vision.md`.

## 2. Where everything lives (IDs you will need)

| Thing | Value |
|---|---|
| GitHub repo | `samerawad2025-prog/research-platform` (public) |
| Production / default branch | `research-platform` (head `15f94476`) |
| Latest work branch | `claude/phase3-release-prep` (head = this handover; docs/scripts only beyond production) |
| Vercel team / project | `team_Yo4otDpDQshuzho9JhD8ykzD` (slug `samer22`) / `prj_4N8qhSrKCpNrM73qaYmErJa6cu90` (`research-platform-5zpu`) |
| Live site | https://research-platform-5zpu.vercel.app (submission form: `/submit`) — no custom domain yet |
| Current production deployment | `dpl_ApgkE3aRmCmiNSs4C58YhpdytbQZ` (commit `15f94476`, region `fra1`; a redeploy of the release deployment `dpl_HLAiNGzahHCpqG11DmhQN2LSYmP6`) |
| Old pre-release production | `dpl_AbLbM1G3PTBSWt6MSBbn4vTEUa3E` (`f45dc690`, `iad1`) — see rollback rules §8 |
| Supabase PRODUCTION | project ref `mzpkiuovjppmavqkppem` (the only real database) |
| Supabase TEST (isolated) | project ref `qwxfxckrabvuvuzidxuo` (`research-platform-test`, free plan) — used by the release branch's Previews |
| Gemini model (prod) | `gemini-3.5-flash-lite` (Vercel shared var `GEMINI_MODEL`) |

## 3. Current status (2026-10-07)

**Released to production on 2026-10-05 05:44 UTC** — the whole Phase 3 stack (PRs #16–#23)
merged top-down in one production deploy (merge commit `15f94476`).

Live and verified in production:
- New acceptance submission form; agreement **Version 4** (EN + AR) active; Gemini reads
  the document by default under the free tier; "Enter details manually" is the alternative;
  failure recovery offers manual entry; the premature "thank you" screen bug is fixed.
- Verified with 3 clearly marked synthetic submissions (text PDF, manual, scanned PDF):
  correct acceptance records, no provider call for manual entry, thank-you only after Confirm.
- Admin review (`/admin`) and public site (`/research`) return 404 (flags off).

Database (production), checked 2026-10-07:
- Migrations applied and recorded: up to 0013, 0015, 0016, 0017, 0018, 0019, 0020.
  **0014 is NOT applied.**
- Active agreement: `submission-terms-2026-10-04-v4-en` and `-v4-ar`. Versions 1–3 inactive
  (v2 = paid terms, superseded; v3 = excerpt-only, withdrawn — never activate either).
- `extraction_policy.mode = automatic` (since 2026-10-05 05:40:50 UTC).
- 39 papers, 3 acceptances (all synthetic), 0 staff, 0 auth users, 0 public records.
  No genuine submission since the release.

## 4. What to do next (in order)

1. **Stage E — apply migration 0014 (closes the old anonymous upload/`submit_paper` path).**
   Until it runs, the legacy anonymous path is still open at the database level (the new
   UI no longer uses it). Files ready: `supabase/release/stage-e-production/`
   (`00_CHECKLIST.md`, `01_preflight.sql` → `PASS`, `02_migration_0014_…sql` (SHA-256
   `799c0207…583be`), `03_verify_0014.sql` → `PASS`, `04_record_0014.sql`).
   **The Supabase connector timed out on this DDL (nothing applied); the founder runs these
   in the Supabase SQL Editor.** Afterwards verify from outside:
   `node scripts/production-verify-release.js` with `PV_ONLY=cutover`
   (needs `PV_ORIGIN`, `PV_SUPABASE_URL`, `PV_ANON_KEY` = production public anon key), and
   one signed submission with `PV_ONLY=manual` (no Gemini call). Record in
   `docs/release-runbook.md` §7.
2. **Merge the docs branch.** `claude/phase3-release-prep` holds docs/scripts written after
   the release (release record, Stage E package, this handover). Merging into
   `research-platform` triggers a production redeploy of identical app code — harmless.
3. **Stage F — administrators** (`docs/admin-review.md`, runbook §4 F): founder decisions
   D3 (volunteer confidentiality text, `docs/legal/volunteer-confidentiality.*`) and D4
   (private request log). Then `ADMIN_REVIEW=enabled` (Production only), create the first
   admin via the documented bootstrap. **Not yet authorized — ask the founder.**
   Then withdraw/reject the 3 synthetic papers (§9) in review so they are never published.
4. **Stage G — public site** (`docs/public-research.md`): domain decision (D6),
   `PUBLIC_SITE_ORIGIN`, approved University of Khartoum records (metadata + abstract only),
   then `PUBLIC_RESEARCH=enabled`. Full text stays OFF until Sudan-qualified legal advice
   (`docs/legal/README.md`).

## 5. Rules that must not be broken

From `CLAUDE.md` / `AGENTS.md` (read them fully):
- RLS on every table; anonymous access only through `SECURITY DEFINER` RPCs. The
  confirmation credential is a hashed token, **never** the paper UUID. A private
  confirmation link must never appear in any public page, index, sitemap, analytics or export.
- Publication restrictions apply on every path (page, file, API, search, sitemap, citation, counts).
- No acceptance is ever backdated or synthesized; migrations never widen existing permissions.
- **Exactly two provider calls max per extraction**; a pass-2 failure never discards pass 1.
- `ai_generations` is **append-only** — never update or delete rows.
- `supabase/schema.sql` is fresh-install only — never run it against a live database.
  Every live change is a new numbered file in `supabase/migrations/`.
- Smallest change for a confirmed, evidenced root cause. No new AI provider / heavy dependency.
- Distinct failures keep distinct messages (BUG_HISTORY #7).
- **Deployment lag has been mistaken for a bug 3+ times** — check what is deployed before
  debugging (`docs/troubleshooting.md`, `.claude/commands/verify-deployment.md`).

Founder decisions in force (2026-10-04/05):
- Gemini project is **free tier (unpaid)**; billing is not enabled. Never set
  `GEMINI_DATA_TERMS=paid`. Agreement Version 4 tells researchers that the first pages
  (scans included; names included) are sent to Google, that Google may use them to improve
  products and models, and that human reviewers may see them. No anonymization or
  no-training promises.
- Gemini reading is the default; manual entry is the secondary choice and sends nothing.
- No key rotation (decision D8, risk accepted — runbook §7a). No billing, no public
  publication, no admin creation without explicit founder approval.

## 6. Architecture in brief

- **Next.js** app (App Router) on **Vercel**; **Supabase** Postgres + Storage (bucket `papers`, private).
  `frontend/` and `backend/` are intentionally empty (see their READMEs).
- Submission flow (`docs/submission-flow.md`): `GET /api/submissions/terms` (offer + agreement
  texts) → `POST /api/submissions/intent` (acceptance, rate-limited, returns a signed upload) →
  browser uploads to Storage with the signed token → `POST /api/submissions/finalize` →
  `/confirm/<64-hex token>` → `POST /api/extract` (server, service role) → review → Confirm
  (`confirm_researcher_metadata` RPC). Manual: `/api/manual-entry`.
- Extraction (`docs/extraction-pipeline.md`, `lib/extraction/`, `lib/ai/providers/gemini.js`,
  prompt in `prompts/metadata-extraction.md`): PDF sent to Gemini (first 10 pages, up to 25 on
  pass 2), Word via `mammoth` + header text. Server gate before any call:
  `external_ai_permission(paper)` (DB, migrations 0018/0019) must permit, and the paper's
  acceptance arrangement must equal `GEMINI_DATA_TERMS`.
- Agreements: texts in `docs/legal/submission-terms.v*.{en,ar}.md`; registry with SHA-256 in
  `lib/submission/agreements.js`; DB table `agreement_versions` (hashes must match).
- Admin (`/admin`, `/api/admin/*`, migration 0015) and public pages (`/research`, 0016–0017): built, OFF.
- Key files: `lib/env.js` (env parsing), `lib/submission/acceptanceHandlers.js`,
  `lib/extraction/extractHandler.js`, `components/ConfirmationScreen.jsx`, `lib/i18n.jsx` (all UI text EN/AR).

## 7. Environment variables (names only — never print values)

Production (Vercel, Production target):
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `AI_PROVIDER` (=gemini), `GEMINI_MODEL`
(shared dev/preview/prod), `GEMINI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` (Production only, sensitive),
`EXTRACTION_MODE=automatic`, `GEMINI_DATA_TERMS=unpaid`, `SUBMISSION_ACCEPTANCE_FLOW=enabled`,
`SUBMISSION_TOKEN_SECRET` (sensitive, ≥32 chars) — the last four added 2026-10-05.
Unset in production (keep unset until their stage): `ADMIN_REVIEW`, `PUBLIC_RESEARCH`, `PUBLIC_SITE_ORIGIN`.

Preview, scoped to branch `claude/phase3-release-prep` only (isolated test setup): test-project
Supabase URL/anon/service keys, `AI_PROVIDER=mock`, `EXTRACTION_MODE=automatic`,
`GEMINI_DATA_TERMS=unpaid`, `ALLOW_PREVIEW_EXTRACTION=true`, `SUBMISSION_ACCEPTANCE_FLOW`,
`ADMIN_REVIEW`, `PUBLIC_RESEARCH` = enabled, a test `SUBMISSION_TOKEN_SECRET`. **No Gemini key in any
Preview** (verified 2026-10-05).

**Hazard (runbook §1):** any OTHER branch's Preview gets the shared vars, i.e. the PRODUCTION
database URL + anon key (no service role). Vercel SSO protects Previews. Never submit through such a
Preview. For hosted tests use the release branch (isolated) or set branch-scoped vars first and run
`scripts/check-isolation.js`.

## 8. Rollback (read before touching production)

Fastest, keeps the new code:
1. `update extraction_policy set mode = 'manual', changed_at = now();` — new submissions get hand entry.
2. Unset `GEMINI_DATA_TERMS` and redeploy — nothing is sent to Gemini at all.
3. Unset `SUBMISSION_ACCEPTANCE_FLOW` and redeploy — legacy form (only while 0014 is NOT applied).

Restoring the old code (`f45dc690`, promote `dpl_AbLbM1G3…`) is a last resort: it reads whole
documents with Gemini without an agreement, and **after 0014 it cannot work at all** (it uploads
anonymously and calls `submit_paper`) unless 0014's emergency block (bottom of the file) reopens
the bypass. Deactivating the agreement stops new offers; recorded acceptances stay (evidence).

## 9. Synthetic records in production (do not mistake for research)

Submitter "Synthetic Release Check", emails `release-check-*@example.invalid`, documents stamped
"SYNTHETIC TEST DOCUMENT" on page 1:
papers `9505ce4f-ae79-4591-adef-b3d13af1fb38` (Gemini text PDF), `a513dc03-4991-445f-a827-26c8a7af4c02`
(manual), `ee91732b-5f8d-4f19-9fe9-435d9218d5de` (Gemini scanned PDF). Kept on purpose (AI history is
append-only). Withdraw/reject them in admin review (stage F) so they are never published.

## 10. Working with the connectors (lessons learned)

**Supabase**
- Read-only checks: wrap in `begin read only; … ; rollback;` (pattern used throughout).
- **`apply_migration` and large `execute_sql` DDL on production time out at 60 s with nothing
  applied** (Stage A and 0014). Prepare numbered SQL files with PASS/STOP checks and a
  history-record insert, and have the founder run them in the SQL Editor
  (examples: `supabase/release/stage-a2-production/`, `supabase/release/stage-e-production/`).
  Small guarded transactions (e.g. activating an agreement) did work via `execute_sql`.
- Pasting into the SQL Editor adds `\r` to function bodies; harmless (compare with `\r` removed).
- Migration history rows are inserted manually (`supabase_migrations.schema_migrations`, name =
  file name without number, statement = file path + SHA-256).
- The test project has `release_test.run_remote('<full commit sha>', '<repo path>')` to apply a
  repository file at a commit (test project only).

**Vercel**
- The connector can list/read deployments, create/edit env vars, manage protection bypass, but
  **cannot delete deployments or env vars** — ask the founder to do that in the dashboard.
- Previews are behind Vercel SSO. For automated checks, create a temporary automation bypass
  (`update_project_protection_bypass` generate) and **revoke it immediately after**. Never print it.
- Env var changes take effect only on the next build; a deployment keeps the env it was built with.
- Production deploys happen on every push to `research-platform`.

**GitHub**
- CI: `.github/workflows/checks.yml` (job `test`: lint, build, unit suites) on every push and PR.
  No branch protection; gate merges on green CI yourself.
- PR stack #16–#23 is merged. No open PRs.

## 11. How to run and test

```bash
npm ci
npm run lint && npm run build && npm test     # unit suites (scripts/test-*.js)
```
Deeper suites (local Postgres 16 / local Supabase stack, see each script's header):
`supabase/tests/run-0012.sh` (Postgres suites), `supabase/tests/local-stack/start.sh`,
`run-browser-e2e.sh`, `run-flow-timing-e2e.sh` (thank-you timing), `run-admin-e2e.sh`,
`run-public-e2e.sh`; release rehearsals `scripts/rehearse-release.sh`, `scripts/rehearse-stage-a2.sh`.
Hosted checks: `scripts/hosted-verify-*.js` (Preview, test DB), `scripts/production-verify-release.js`
(production UI with stamped synthetic documents; `PV_ONLY=config,auto,manual,scan,cutover`).
Synthetic fixtures (invented people only): `scripts/fixtures/synthetic/`. Never use a real person's document.

## 12. Document map

| Need | File |
|---|---|
| Release steps, every hosted result, decisions D1–D8, blockers | `docs/release-runbook.md` (authoritative) |
| Dated status | `CURRENT_STATUS.md` |
| Phase 3 plan / milestones | `PHASE_3_PLAN.md` |
| Agent rules | `AGENTS.md`, `CLAUDE.md`, `.claude/memory/quick-reference.md` |
| Every past bug with evidence | `BUG_HISTORY.md` (check before "fixing" anything) |
| Architecture / DB / deploy / troubleshooting | `docs/architecture.md`, `docs/database.md`, `docs/deployment.md`, `docs/troubleshooting.md` |
| Submission flow, extraction, admin, public | `docs/submission-flow.md`, `docs/extraction-pipeline.md`, `docs/admin-review.md`, `docs/public-research.md` |
| Legal texts and activation rules | `docs/legal/README.md` |
| Migrations order and notes | `supabase/migrations/README.md` |
| Historical only (verify against code) | `PROJECT_MAP.md`, `CLAUDE_CODE_HANDOVER.md`, `PHASE_2_PLAN.md`, `CLEANUP_PLAN.md` |

## 13. Open items / known limitations

- 0014 pending (above). Until then acceptance is enforced by the UI/server, not the database.
- Production service-role key was once exposed; founder decided not to rotate (runbook §7a).
- Free-tier Gemini quota is shared by production; real Gemini tests consume it — keep them minimal.
- `external_ai_permission` still returns `known_names` (from the withdrawn excerpt design); unused, harmless.
- Old Preview deployments of other branches use the production DB via shared vars (hazard §7).
