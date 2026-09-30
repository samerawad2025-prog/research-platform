# Phase 3 release runbook

**This is the one authoritative release procedure for Phase 3 (M1–M6).** Where `docs/deployment.md`, `docs/submission-flow.md` ("Cutover"), `docs/admin-review.md` (§2, §9), `docs/public-research.md` (§8), `docs/legal/README.md` or `supabase/migrations/README.md` describe release steps, they explain *why*; this file says *what, in which order*. If they disagree, this file wins and the other one should be corrected.

Prepared 2026-09-30 against candidate commit `f433a37` (PR #22 head) plus the release-prep PR. Production observations below were read-only.

---

## 0. Where things stand (2026-09-30)

### Built and tested locally
Everything in PRs #16–#22 (M0 docs, M1 manual path, M2A acceptance, M2B/M3 new form + LinkedIn, M4 review, M5 public site, M6 citations/metrics). Local Postgres 16 and a local Supabase stack with real GoTrue; CI (`test`) green on every head.

Release-level local proof (this PR): `scripts/rehearse-release.sh` starts from **production's own `schema.sql`** (`origin/research-platform`), applies 0011, 0012, 0013, 0015, 0016, 0017 (each twice, proving idempotency), confirms the legacy anonymous path still works, applies 0014, confirms it is closed, and compares the result with a fresh install (release `schema.sql` + 0014). Result: **identical structure and privileges.**

### Verified on a hosted isolated environment
**Nothing.** No isolated hosted environment exists (see §2). Every hosted check in §6 is *prepared, not run*.

### Currently deployed
- Vercel production serves **`f45dc690`** (the pre-Phase-3 app). No custom domain (`research-platform-5zpu.vercel.app`), Vercel SSO on previews.
- Supabase `mzpkiuovjppmavqkppem` (the only project): live schema matches `schema.sql` at `f45dc690` exactly. Migrations applied through **0010**; 0011–0017 **not** applied. Legacy anonymous upload + `submit_paper` **open**. 35 papers (5 confirmed), 0 Auth users.
- No Phase 3 environment variable is set in production.

### Blocked or unverified
| Item | Blocked on |
|---|---|
| All hosted checks (§6) | An isolated test project (§2) — authorization needed |
| Agreement activation (§4 stage D) | §6 of the agreement: provider arrangement unverified → production must run **manual**; founder approval |
| 0014 cutover | Agreement activation + a real signed submission |
| Volunteers opening submissions | Founder approval of the confidentiality draft |
| Public site | First admin, reviewed/approved UofK records, domain decision |
| Full text | Sudan-qualified legal advice + dissemination copies (`docs/legal/README.md`); stays off |
| Client-address trust for rate limits | Hosted check H10 (does Vercel overwrite a client-sent `x-forwarded-for`?) |
| §8 request handling | Founder's private request log (process, not code) |

---

## 1. Known hazard: previews share the production database

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set for Development, Preview **and** Production. Every Vercel preview (including each PR in the stack) therefore talks to the **production** database and bucket with the anon key. `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` are Production-only, so preview server routes cannot use the service role — but a preview serving the legacy form can still upload files and call `submit_paper` against production. Only Vercel SSO keeps outsiders off previews.

**Rule:** do not submit anything through a preview until §2's branch-scoped variables are in place and `scripts/check-isolation.js` passes for it.

---

## 2. Isolated hosted test environment (needs authorization)

None exists: one Supabase project, no branches. Smallest dependable setup (free tier allows two projects; **no cost** if it stays on the free plan — Supabase branching would need a paid plan):

1. Supabase → New project `research-platform-test` (free, any region). Record its ref.
2. SQL editor on **the test project**: run `supabase/schema.sql` from the candidate commit, then `0014_close_legacy_submission_path.sql` (the post-cutover shape). For the cutover checks (H5) use a second run: `git show origin/research-platform:supabase/schema.sql`, then 0011→0013, 0015→0017, then 0014 (same order as §4).
3. Storage: create a private bucket `papers` (same settings as production).
4. Vercel → Project → Settings → Environment Variables, **Preview, branch `claude/phase3-release-prep` only**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all from the test project), `AI_PROVIDER=mock`, `EXTRACTION_MODE=manual`, `SUBMISSION_TOKEN_SECRET=<random 32+ bytes>`, `SUBMISSION_ACCEPTANCE_FLOW=enabled`, `ADMIN_REVIEW=enabled`, `PUBLIC_RESEARCH=enabled`. **No** `GEMINI_API_KEY`. `PUBLIC_SITE_ORIGIN` unset (or the preview URL for the citation/sitemap checks).
   Branch-scoped values override the all-branches Preview values for that branch only.
5. Vercel → Deployment Protection → Protection Bypass for Automation: create a token (used as `x-vercel-protection-bypass` by the checks).
6. Redeploy the branch; note the deployment URL and commit.

**Isolation proof, before any write** (all must hold):
```sh
vercel env pull .env.isolation --environment=preview --git-branch=claude/phase3-release-prep
set -a; . ./.env.isolation; set +a
PRODUCTION_SUPABASE_REF=mzpkiuovjppmavqkppem node scripts/check-isolation.js --live
rm .env.isolation
```
It prints project refs only, fails with `NOT ISOLATED` if the URL or either key names production, keys name different projects, the service key is accepted by production, `AI_PROVIDER` is not mock, a Gemini key is present, or `EXTRACTION_MODE` is not manual. Then confirm the deployment's commit in Vercel equals the candidate SHA. Only synthetic records and test accounts (`@example.test`-style addresses) are used.

---

## 3. Migrations: what is applied, and never both ways

**`schema.sql` is for an empty database only.** It already contains 0011–0013 and 0015–0017; it deliberately does **not** contain 0014 (the cutover is applied last on production; a fresh install that should match post-cutover production runs `schema.sql` then 0014). **Never run `schema.sql` against production**, and never run migrations on a database built from the current `schema.sql` except 0014.

**The tracking table is not evidence.** `supabase_migrations.schema_migrations` lists only 0008–0010 because earlier files were run by hand. Identify state by fingerprint (read-only, safe on production):
```sql
select concat_ws(' ',
  case when exists(select 1 from information_schema.columns where table_name='papers' and column_name='manual_entry_at') then '0011' end,
  case when to_regclass('public.agreement_versions') is not null then '0012' end,
  case when exists(select 1 from information_schema.columns where table_name='researchers' and column_name='linkedin_public') then '0013' end,
  case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
  case when to_regclass('public.staff_members') is not null then '0015' end,
  case when to_regclass('public.public_records') is not null then '0016' end,
  case when to_regclass('public.activity_counts') is not null then '0017' end) as applied;
```
Production today returns an empty string. All of 0011–0017 are idempotent, so re-running one already applied is harmless; skipping one is not (each checks its prerequisites and aborts).

**Dependencies:** 0012 ← 0011; 0013 ← 0012; 0015 ← 0012, 0013, Auth; 0016 ← 0015; 0017 ← 0016; 0014 ← 0012, 0013 and a live new form. Numbers are not order: **0014 is last.**

Before running any migration on production, re-run `scripts/rehearse-release.sh` locally from the exact candidate commit; it must print `Release rehearsal passed`.

---

## 4. Production sequence

Each stage ends with a check; do not start the next until it passes. "Redeploy" means Vercel → Deployments → Redeploy the current production deployment, since environment variables take effect **only on the next build/deploy**, never on a running one.

### Stage A — database, before any merge
Apply in the SQL editor, one file at a time, in order: **0011, 0012, 0013, 0015, 0016, 0017.** Not 0014.
- Safe with the deployed `f45dc690`: all additive; the rehearsal runs the legacy `submit_paper` after them.
- Verify: fingerprint = `0011 0012 0013 0015 0016 0017`; one legacy submission from production still completes; `select mode from extraction_policy;` = `manual`; `select id, active from agreement_versions;` all false; `select count(*) from staff_members;` = 0.
- Rollback: each file has a rollback block at its end; nothing is lost while no new-path data exists.

### Stage B — code to production, every flag off
Set first (Production scope): `EXTRACTION_MODE=manual`, `SUBMISSION_TOKEN_SECRET=<random>`. Leave `SUBMISSION_ACCEPTANCE_FLOW`, `ADMIN_REVIEW`, `PUBLIC_RESEARCH`, `PUBLIC_SITE_ORIGIN` unset.

Merging to `research-platform` deploys production automatically. Two options (decision D5):
- **(Recommended) one deploy:** merge top-down into the stack's own branches (release-prep into #22's branch, #22 into #21's, … #17 into #16's), then merge #16 into `research-platform` once. Only that last merge builds production.
- **Sequential:** merge #16, then retarget and merge #17 … #22. Each intermediate deploy is safe with stage A done and flags unset, but produces seven production builds.

Effect: legacy form still served; confirmation page drops Facebook (LinkedIn only); extraction is manual (no Gemini call for new papers); `/admin` and public pages answer 404.
Verify: deployment commit = merged head; a legacy submission completes and shows the manual details form; no `ai_generations` row for it; `/admin` and `/research` 404.
Rollback: Vercel → promote the previous deployment (`f45dc690`). Stage A stays.

### Stage C — hosted verification on the isolated environment
Run §6 against §2. Record results in §7. Fix before D.

### Stage D — agreement and new form (founder decision)
Preconditions: §6 H1–H4, H6 passed; production manual (agreement §6); founder approved (D2).
```sql
update agreement_versions set active = true where id in ('submission-terms-2026-09-25-en','submission-terms-2026-09-25-ar');
```
Set `SUBMISSION_ACCEPTANCE_FLOW=enabled`, redeploy. Make **one real signed submission** end to end (founder's own test document).
Rollback: unset the flag, redeploy (legacy form returns; path still open). Deactivating the agreement stops new offers; acceptances already recorded stay.

### Stage E — cutover: 0014
Right after D verifies (keep the D→E window short; acceptance is not enforced until E). Apply `0014_close_legacy_submission_path.sql`; it aborts with a named reason unless safe.
Verify from outside: anonymous upload to `papers` refused; anonymous `submit_paper` refused; a signed submission still completes; fingerprint includes `0014`.
Rollback: the emergency block at the bottom of 0014, only together with turning the flag off again. Never a resting state.

### Stage F — administrators
1. Auth → Settings: disable sign-ups; keep email confirmation; consider MFA.
2. Auth → Users → add the founder's account; confirm; copy its id.
3. `select bootstrap_first_administrator('<id>');` (owner only; refuses if an admin exists).
4. `ADMIN_REVIEW=enabled`, redeploy; sign in at `/admin`.
5. Only after D3: `update confidentiality_versions set active = (id = 'volunteer-confidentiality-2026-09-29');` Until then volunteers cannot open submissions; administrators can work.
Rollback: unset `ADMIN_REVIEW`, redeploy (data kept, audited).

### Stage G — public site (UofK, metadata + abstract only)
1. Administrators review and approve eligible UofK records (confirmed metadata, permission evidence per `docs/admin-review.md`). Legacy papers carry legacy consent only; approve only what the reviewer can justify from that evidence.
2. Soft launch: `PUBLIC_RESEARCH=enabled`, `PUBLIC_SITE_ORIGIN` unset (no indexing, empty sitemap, citations without URL). Or set the permanent origin first (D6) — changing it later breaks citations already copied.
3. Redeploy. Verify one public record, one withdrawn record, `robots.txt`, `sitemap.xml`, bucket still private, full-text requests refused.
4. **Do not** lift `release_restrictions` `fulltext_legal_advice`.
Rollback: unset `PUBLIC_RESEARCH`, redeploy (everything 404s); withdraw individual records in `/admin`.

---

## 5. Environment variables: when each takes effect

| Variable | Stage | Takes effect | Unset means |
|---|---|---|---|
| `EXTRACTION_MODE` | B (`manual`) | next deploy; per paper, `submission_extraction_policy` also stamps the DB policy | manual (logged `extraction_mode_defaulted`) |
| `SUBMISSION_TOKEN_SECRET` | B | next deploy | new endpoints refuse to issue offers |
| `SUBMISSION_ACCEPTANCE_FLOW` | D (`enabled`) | next deploy | legacy form, endpoints 404 |
| `ADMIN_REVIEW` | F | next deploy | `/admin` 404 |
| `PUBLIC_RESEARCH` | G | next deploy | public site 404 |
| `PUBLIC_SITE_ORIGIN` | G/D6 | next deploy | no canonical, no index, empty sitemap |
| `AI_PROVIDER`, `GEMINI_*` | unchanged | — | irrelevant while manual |

Every Phase 3 variable must be **Production-scoped only** (not Preview), so previews stay inert until §2's branch-scoped values exist.

---

## 6. Hosted checks (prepared, not run)

Each runs against the §2 deployment `$PREVIEW` with `-H "x-vercel-protection-bypass: $BYPASS"`, only after `check-isolation.js --live` passes. Record commit SHA and deployment id with each result.

| # | Check | How | Pass when |
|---|---|---|---|
| H1 | Auth sign-in, staff authorization, cookies | test admin via `bootstrap_first_administrator` on the test project; sign in at `/admin`; a second non-staff test user | staff sees `/admin`; non-staff and anonymous get refused; session cookies `Secure; HttpOnly; SameSite`; `/admin` responses `no-store` |
| H2 | Signed upload restrictions | run the new form; replay the signed URL with a different path, a second PUT to the same path, and after expiry | only the issued path accepted; overwrite refused; expired URL refused at the stated time |
| H3 | Storage CORS | upload from the preview origin in a browser; `curl -X OPTIONS` with `Origin: $PREVIEW` and a foreign origin | preview origin allowed; browser upload succeeds |
| H4 | Finalization and recovery | submit; interrupt after upload, retry finalize; finalize twice | exactly one paper; retry recovers; second finalize idempotent |
| H5 | Legacy path closed | on the cutover-order database after 0014: anon `POST /storage/v1/object/papers/x` and `POST /rest/v1/rpc/submit_paper` with the anon key | both refused (403/401); signed submission still works |
| H6 | Manual mode, no AI | submit; inspect `ai_generations` and function logs | no provider call; manual details form served |
| H7 | Public eligibility on every path | synthetic UofK record approved; a non-UofK and an unapproved record | only the approved one appears in page, `/api`, search, sitemap, citation export, activity; others 404 everywhere |
| H8 | Withdrawal and download expiry | withdraw the approved record; reuse a download link issued before | page/search/sitemap drop it; old link refused after expiry |
| H9 | Hosted cache | `curl -I` public page and API before/after withdrawal | `Cache-Control` as documented; withdrawn content not served from cache |
| H10 | Trusted client address | send `x-forwarded-for: 1.2.3.4` repeatedly past the limit | Vercel's value wins (limit applies to the real address); if not, fix `lib/submission/routeHelpers.js` to prefer `x-vercel-forwarded-for` before release |
| H11 | Metrics timeout and staff exclusion | lock `activity_counts` in the test DB while loading a page; view as signed-in staff | page renders within ~400 ms budget with "counts unavailable"; staff views not counted |

Full-text checks (H7/H8 document parts) only on synthetic records in the test project, by lifting the restriction **there only**.

---

## 7. Record of hosted results

| Check | Commit | Deployment | Test project ref | Result | Date |
|---|---|---|---|---|---|
| H1–H11 | — | — | — | not run (no isolated environment) | — |

---

## 8. Launch recommendation

Smallest dependable release: stages A→G with **manual processing**, the **University of Khartoum** collection only, **metadata and abstracts** for records that meet the review rules, **full text off**, **no new AI**, `PUBLIC_SITE_ORIGIN` set only once the permanent domain is decided.

### Decisions for Samer
| # | Decision | Recommendation |
|---|---|---|
| D1 | Verify the Gemini project's data-use arrangement, or stay manual | Stay manual for launch; verify later |
| D2 | Activate the submission agreement (EN/AR) | Yes, at stage D, after hosted checks |
| D3 | Approve the volunteer confidentiality text | Review now; admins can work without it |
| D4 | Keep a private §8 request log | Start one (a private spreadsheet) before D |
| D5 | Merge strategy | One final production deploy |
| D6 | Permanent domain | Soft launch without origin, then decide |
| D7 | Authorize a free second Supabase project + branch-scoped preview variables (§2) | Yes — it unblocks every hosted check |
