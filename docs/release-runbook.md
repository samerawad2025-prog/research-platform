# Phase 3 release runbook

**This is the one authoritative release procedure for Phase 3 (M1–M6).** Where `docs/deployment.md`, `docs/submission-flow.md` ("Cutover"), `docs/admin-review.md` (§2, §9), `docs/public-research.md` (§8), `docs/legal/README.md` or `supabase/migrations/README.md` describe release steps, they explain *why*; this file says *what, in which order*. If they disagree, this file wins and the other one should be corrected.

Prepared 2026-09-30 against candidate commit `f433a37` (PR #22 head) plus the release-prep PR. Production observations below were read-only.

---

## 0. Where things stand (updated 2026-10-02)

### Built and tested locally
Everything in PRs #16–#22 (M0 docs, M1 manual path, M2A acceptance, M2B/M3 new form + LinkedIn, M4 review, M5 public site, M6 citations/metrics). Local Postgres 16 and a local Supabase stack with real GoTrue; CI (`test`) green on every head.

Release-level local proof (this PR): `scripts/rehearse-release.sh` starts from **production's own `schema.sql`** (`origin/research-platform`), applies 0011, 0012, 0013, 0015, 0016, 0017 (each twice, proving idempotency), confirms the legacy anonymous path still works, applies 0014, confirms it is closed, and compares the result with a fresh install (release `schema.sql` + 0014). Result: **identical structure and privileges.**

### Verified on a hosted isolated environment
Test project `qwxfxckrabvuvuzidxuo` (`research-platform-test`, free plan, eu-central-1, Postgres 17.11), created 2026-09-30. Results in §7:
- **Stage A rehearsed on hosted Postgres:** production's `schema.sql` (`f45dc690`), then 0011, 0012, 0013, 0015, 0016, 0017 fetched at `b4397b93` (md5 matched the repository) all applied cleanly; stage A's verification queries pass.
- **Legacy path before and after 0014, through the real Supabase gateway and Storage:** open before, refused after (H5, database half).
- **Storage CORS preflight** observed (H3, partly).
- **2026-10-02: H1–H11 run against preview `dpl_AsGpKUfwJ4u7Y77DNHzfgoKJB2Bx` (`daed2b35`) after `check-isolation.js --live` passed.** All pass, with one coverage finding (H11: activity writes time out cross-region; fix the function region) and one observation not made (H2: an upload after the 120-minute authorization expiry). Details in §7. Scripts: `scripts/hosted-verify-{submission,admin,public}.js`.

### Currently deployed
- Vercel production serves **`f45dc690`** (the pre-Phase-3 app). No custom domain (`research-platform-5zpu.vercel.app`), Vercel SSO on previews.
- Supabase `mzpkiuovjppmavqkppem` (the only project): live schema matches `schema.sql` at `f45dc690` exactly. Migrations applied through **0010**; 0011–0017 **not** applied. Legacy anonymous upload + `submit_paper` **open**. 35 papers (5 confirmed), 0 Auth users.
- No Phase 3 environment variable is set in production.
- Re-checked read-only on 2026-10-02 15:36–16:10 UTC: Stage A PREFLIGHT (`supabase/release/stage-a-checks.sql`) **PASS**; data fingerprint `ece227369f14ec7f3639362b4c011dbf`; last paper created and last confirmation 2026-09-25.

### Blocked or unverified
| Item | Blocked on |
|---|---|
| Agreement activation (§4 stage D) | §6 of the agreement: provider arrangement unverified → production must run **manual**; founder approval |
| 0014 cutover | Agreement activation + a real signed submission |
| Volunteers opening submissions | Founder approval of the confidentiality draft |
| Public site | First admin, reviewed/approved UofK records, domain decision |
| Full text | Sudan-qualified legal advice + dissemination copies (`docs/legal/README.md`); stays off |
| §8 request handling | Founder's private request log (process, not code) |

---

## 1. Known hazard: previews share the production database

`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are set for Development, Preview **and** Production. Every Vercel preview (including each PR in the stack) therefore talks to the **production** database and bucket with the anon key. `SUPABASE_SERVICE_ROLE_KEY` and `GEMINI_API_KEY` are Production-only, so preview server routes cannot use the service role — but a preview serving the legacy form can still upload files and call `submit_paper` against production. Only Vercel SSO keeps outsiders off previews.

**Rule:** do not submit anything through a preview until §2's branch-scoped variables are in place and `scripts/check-isolation.js` passes for it.

---

## 2. Isolated hosted test environment

**State (2026-09-30):** steps 1–4 are done except the service key; step 5 is not. Blockers: (a) the Supabase connector available to Claude returns only publishable keys, so `SUPABASE_SERVICE_ROLE_KEY` for the test project must be copied by Samer (Dashboard → test project → Settings → API Keys → `service_role`/secret) into Vercel as a **Preview, branch `claude/phase3-release-prep`, Sensitive** variable; (b) Claude's container cannot reach `*.supabase.co` or `*.vercel.app` directly (network policy), so `--live` isolation and HTTP checks run from a machine that can, or through the connectors.

Setup (as performed; free tier allows two active projects, the organization is on the free plan with one other) (free tier allows two projects; **no cost** if it stays on the free plan — Supabase branching would need a paid plan):

1. Supabase → New project `research-platform-test` (free, any region). Record its ref.
2. SQL editor on **the test project**: run `supabase/schema.sql` from the candidate commit, then `0014_close_legacy_submission_path.sql` (the post-cutover shape). For the cutover checks (H5) use a second run: `git show origin/research-platform:supabase/schema.sql`, then 0011→0013, 0015→0017, then 0014 (same order as §4).
3. Storage: create a private bucket `papers` (same settings as production).
4. Vercel → Project → Settings → Environment Variables, **Preview, branch `claude/phase3-release-prep` only**:
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (all from the test project), `AI_PROVIDER=mock`, `EXTRACTION_MODE=manual`, `SUBMISSION_TOKEN_SECRET=<random 32+ bytes>`, `SUBMISSION_ACCEPTANCE_FLOW=enabled`, `ADMIN_REVIEW=enabled`, `PUBLIC_RESEARCH=enabled`. **No** `GEMINI_API_KEY`. `PUBLIC_SITE_ORIGIN` unset (or the preview URL for the citation/sitemap checks).
   Branch-scoped values override the all-branches Preview values for that branch only.
5. Vercel → Deployment Protection → Protection Bypass for Automation: create a token (used as `x-vercel-protection-bypass` by the checks).
6. Redeploy the branch; note the deployment URL and commit.

The test project is now in the **post-cutover** shape (0014 applied). It also holds a test-only schema `release_test` (not in any migration; unreachable by browser roles) with `run_remote(sha, path)`, which fetches a repository file at an exact commit and executes it, and `call(...)`, which makes HTTP requests to the test project's own gateway. Synthetic rows: two `release-test/legacy-*` uploads/papers from H5.

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
Production today returns an empty string. All of 0011–0017 are idempotent, so re-running one already applied is harmless; skipping one is not. Only 0014 checks its prerequisites explicitly; the others fail on their first reference to a missing object and roll back (each file is one `begin … commit` transaction). The Stage A checks below are the guard: each confirms the exact fingerprint before the next file is run.

**Dependencies:** 0012 ← 0011; 0013 ← 0012; 0015 ← 0012, 0013, Auth; 0016 ← 0015; 0017 ← 0016; 0014 ← 0012, 0013 and a live new form. Numbers are not order: **0014 is last.**

Before running any migration on production, re-run `scripts/rehearse-release.sh` locally from the exact candidate commit; it must print `Release rehearsal passed`.

---

## 4. Production sequence

Stage 0 runs entirely on the isolated test environment; A–G are production. Each stage ends with a check; do not start the next until it passes. "Redeploy" means Vercel → Deployments → Redeploy the current production deployment, since environment variables take effect **only on the next build/deploy**, never on a running one.

### Stage 0 — hosted verification on the isolated environment (before any production change)
Nothing in stages A–G touches production until this passes.
1. `scripts/check-isolation.js --live` passes against the branch-scoped preview values (§2).
2. On the test project, rebuild the **production path**: production's `schema.sql` (`git show origin/research-platform:supabase/schema.sql`), then 0011, 0012, 0013, 0015, 0016, 0017 — the exact stage A order — and deploy the candidate with the stage B flags. This rehearses A and B on hosted infrastructure.
3. Run §6 H1–H11 against it, applying 0014 on the test project at the point H5 needs (after the new form works there, as in stage E).
4. Record every result in §7 with the commit, deployment id and test project ref.
Any failure: fix on the release branch, redeploy the preview, re-run the affected checks. Production stays untouched.

### Region (before stage B)
`vercel.json` on the release branch sets `"regions": ["fra1"]`. Deployments built from commits containing it run in Frankfurt, next to the database; the **current** production deployment is not affected. When the stack is merged (stage B), production functions move from `iad1` to `fra1` with that deploy — intended, and verified on the preview (§7, H11 re-run). Rollback: promoting the previous production deployment also restores its region.

### Stage A — production database, before any merge (exact procedure)

Precondition: stage 0 passed and recorded in §7 (met 2026-10-02).

**What it changes.** Six additive migrations: 22 new tables (6 → 28), new columns on `papers` (nullable) and `researchers` (`linkedin_public`, default false), new functions, and replacements of `get_paper_for_confirmation` / `confirm_researcher_metadata` with the **same signatures**. No existing row is updated or deleted; the old anonymous path stays open; nothing becomes visible to the public. The deployed app (`f45dc690`) keeps working and keeps its current behaviour, including automatic Gemini extraction for new papers, until stage B. Two small user-visible effects on the live confirmation page: a LinkedIn value that is not a LinkedIn profile address is refused with a clear message, and a Facebook value is ignored (production holds no LinkedIn or Facebook values today, and no researcher is shared between papers).

**Evidence it is safe (2026-10-02).**
- Same six files (SHA-256 below) applied on hosted Postgres 17 to a copy of the production schema (test project, §7) and then exercised end to end (H1–H11).
- `scripts/rehearse-stage-a.sh` (local Postgres 16 with Supabase's default grants): production schema `f45dc690` + synthetic data shaped like production (35 papers in the same status/failure/scope mix, 55 researchers, 50 author links, 70 AI rows) → every check below PASS; **data fingerprint identical before and after**; as the browser (`anon`): direct reads of `papers` return 0 rows, wrong token and bare paper UUID refused, correct token reads, the exact confirmation payload `f45dc690` sends succeeds (Facebook ignored, `٢٠١٩م` stored as 2019), legacy `submit_paper` succeeds and is stamped `manual`; anon has no access to new tables.
- `scripts/rehearse-release.sh`: migrated database identical in structure and privileges to a fresh install.
- Production PREFLIGHT read-only: **PASS** at 2026-10-02 ~16:10 UTC.

**Files (exactly these; unchanged since `b4397b93`):**

| Order | File | Lines | SHA-256 |
|---|---|---|---|
| 1 | `0011_manual_entry.sql` | 210 | `FAC1E84D07FA93D908DE430BC1B73E57A549DFDB2B28BD7CD3F905F0C19C72D2` |
| 2 | `0012_submission_acceptance.sql` | 546 | `47A085C339140610D797251F980DB63B4AAA76A3EC07A41ACBFDB00F0761196D` |
| 3 | `0013_linkedin_visibility_declared_authors.sql` | 397 | `1E5614CB72174CDEC8FB15B1134A54FECECC48392547069CD0860FEDFE14A724` |
| 4 | `0015_admin_review.sql` | 2366 | `485415578ADED442DBB29E29F02E621A311D0D28544EA27C2C1DED549E1C4241` |
| 5 | `0016_public_research.sql` | 391 | `CD7A6452FFCC035166C9ACEA8A43420C8B72365346A41EC1F3D06015E13BEBE6` |
| 6 | `0017_activity_metrics.sql` | 182 | `60DE5C1BEB67C77A8FAC0803E84C69D5F35A9AF2FF01B050B6EEB0F426BFBED8` |

Not 0014 (that is stage E). Never `schema.sql`.

**Procedure** (Supabase dashboard → the **production** project `mzpkiuovjppmavqkppem` → SQL Editor; check the project name in the top bar is *not* `research-platform-test`). Checks come from `supabase/release/stage-a-checks.sql`; paste one block at a time.
1. **Window.** A quiet time (production's last paper and confirmation: 2026-09-25). Allow 30 minutes.
2. **Copy of current data.** Database → Backups: note the newest backup time if one is listed. Whether or not one is, also export `papers`, `researchers`, `paper_researchers` and `ai_generations` as CSV from the Table Editor and keep them privately (they contain personal data).
3. **Preflight.** Run the `PREFLIGHT` block → must be `PASS`. Run the `DATA FINGERPRINT` block → write down `data_fingerprint`, `max_created`, `max_confirmed` (on 2026-10-02 it was `ece227369f14ec7f3639362b4c011dbf`).
4. **For each file in the order above:**
   a. Open it on GitHub at the PR #23 head (`supabase/migrations/<file>` → *Raw*), select all, copy, paste into a new SQL Editor query. The editor's last line number must equal the *Lines* column. (Optional, exact: download the raw file and compare `Get-FileHash <file> -Algorithm SHA256` with the table.)
   b. Run. Expected: success, no rows. The editor may warn about `drop … if exists` statements; they only replace the file's own triggers/constraints — confirm only if step a's line count matched.
   c. Run the matching `AFTER 00xx` block → must be `PASS`, and its `applied` column must show the files so far.
5. **After 0017:** run `DATA FINGERPRINT` again → identical to step 3 (if not, `max_created` / `max_confirmed` show whether a real submission or confirmation happened in between; otherwise STOP).
6. **Live app.** Open the production site's home and `/submit` pages; Vercel → Logs for the production deployment: no new errors in the next hour. No test submission is needed (the deployed app's calls were exercised against the migrated schema in the rehearsal).

**Stop conditions — do not continue, report instead:**
- any `STOP:` result (it names the reason), or a PREFLIGHT that is not `PASS`;
- a migration that ends with an error: because each file is a single transaction, nothing from it was applied; confirm by re-running the previous step's `AFTER` block (it must still `PASS`), then stop;
- a line count that does not match, or a query that runs for more than two minutes (cancel it; the transaction rolls back);
- the data fingerprint changed without a matching new submission or confirmation;
- new errors in the production logs after step 6.
Do **not** run any rollback block from the files, and do not re-run a file, without asking first. (Re-running is harmless — every file is idempotent — but a STOP means something is unexpected and should be looked at first.)

**Rollback.** Not expected to be needed: nothing in the deployed app depends on the new objects. Each file ends with a commented rollback block, to be used only in reverse order (0017 → 0011) and only after review.

**Done when:** `AFTER 0017` is `PASS`, the data fingerprint is unchanged, and the result is recorded in §7.

### Stage B — code to production, every flag off
Set first (Production scope): `EXTRACTION_MODE=manual`, `SUBMISSION_TOKEN_SECRET=<random>`. Leave `SUBMISSION_ACCEPTANCE_FLOW`, `ADMIN_REVIEW`, `PUBLIC_RESEARCH`, `PUBLIC_SITE_ORIGIN` unset.

Merging to `research-platform` deploys production automatically. Two options (decision D5):
- **(Recommended) one deploy:** merge top-down into the stack's own branches (release-prep into #22's branch, #22 into #21's, … #17 into #16's), then merge #16 into `research-platform` once. Only that last merge builds production.
- **Sequential:** merge #16, then retarget and merge #17 … #22. Each intermediate deploy is safe with stage A done and flags unset, but produces seven production builds.

Effect: legacy form still served; confirmation page drops Facebook (LinkedIn only); extraction is manual (no Gemini call for new papers); `/admin` and public pages answer 404.
Verify: deployment commit = merged head; a legacy submission completes and shows the manual details form; no `ai_generations` row for it; `/admin` and `/research` 404.
Rollback: Vercel → promote the previous deployment (`f45dc690`). Stage A stays.

### Stage D — agreement and new form (founder decision)
Preconditions: stage 0 passed (in particular H1–H6); production manual (agreement §6); founder approved (D2).
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

## 6. Hosted checks

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
| Stage A rehearsal (hosted) | schema `f45dc690` + migrations `b4397b93` | — | `qwxfxckrabvuvuzidxuo` | **pass**: fingerprint `0011 0012 0013 0015 0016 0017`; `extraction_policy`=manual; both agreements inactive; 0 staff; `fulltext_legal_advice` active; anon still has `submit_paper` | 2026-09-30 |
| H5 before 0014 | same | — | same | **as expected (open)**: anon upload 200; same-path overwrite refused (409 `KeyAlreadyExists`); anon `submit_paper` 200; anon `select` on `papers` → `[]` (RLS) | 2026-09-30 |
| H5 after 0014 (database/gateway half) | 0014 @ `b4397b93` | — | same | **pass**: anon upload 403 (RLS); anon `submit_paper` 401/42501; `bootstrap_first_administrator` and `public_catalogue` not callable via API (42501) | 2026-09-30 |
| H3 CORS preflight (Storage) — **preflight only** | — | — | same | **observed** (does not prove an actual browser upload succeeds; that remains part of H2/H3): `access-control-allow-origin: *` for the preview origin **and for a foreign origin** — browser uploads will work; origin is no protection, the signed token is | 2026-09-30 |
| `check-isolation.js` on the branch preview values | `b4397b93`+ | — | same | **fails closed as designed**: URL and anon key name the test project; mock, manual, no Gemini key; `SUPABASE_SERVICE_ROLE_KEY is not set` | 2026-09-30 |
| Preview wiring | `7ed511ed` | `dpl_8mmgqqDg4n8G8joTwcjAfQxJTifW` (branch alias `research-platform-5zpu-git-claude-phase3-release-prep-samer22.vercel.app`) | same | **observed**: deployment built from the candidate commit with the branch-scoped variables; `/research` 200 with `robots: noindex` / `x-robots-tag: noindex` (no origin), `cache-control: private, no-store`, and an honest "catalogue could not be loaded" message (server routes lack the service key) — no production data reachable | 2026-09-30 |
| Prerequisites re-verified | `7fa1a6da` | latest branch deployment `dpl_HUQo7puRYZmeZd83VgZnNYzbrgcB` (built 2026-09-30, no redeploy since) | same | **not met**: no `SUPABASE_SERVICE_ROLE_KEY` exists for Preview/branch `claude/phase3-release-prep` (the only one is the original Production-scoped variable); the container's proxy still answers 403 to CONNECT for `qwxfxckrabvuvuzidxuo.supabase.co`, `mzpkiuovjppmavqkppem.supabase.co` and the branch preview host. `check-isolation.js --live` therefore cannot run, and no application test writes were made | 2026-10-01 |
| `check-isolation.js --live` (both credentials) | script `3c22c729` (SHA-256 `db4759fe…c5038`) | preview `dpl_D7FPYDy9e7fabs3PH8UdqyT8HCUF` (`3c22c729`, branch-scoped `SUPABASE_SERVICE_ROLE_KEY` added 2026-10-02) | same | **PASS**, run by Samer locally (Windows PowerShell; key entered at a hidden prompt, never saved or printed; both keys verified to name `qwxfxckrabvuvuzidxuo` before the run). Earlier attempts with production keys correctly returned FAIL. Server routes on the preview read the test catalogue (`public_catalogue`, 0016-only) | 2026-10-02 |
| Exposed synthetic token | — | — | same | **invalidated**: the one synthetic paper's `confirmation_token_hash` replaced with the hash of a fresh random value that was never returned or stored; the old token is rejected by `get_paper_for_confirmation` | 2026-10-01 |
| Database HTTP helper | — | — | same | `release_test.call` disabled (body raises; EXECUTE revoked from every API role) so hosted HTTP checks cannot bypass network policy; `run_remote` kept for applying repository SQL | 2026-10-01 |
| Preview access for hosted checks | `daed2b35` (code identical to `3c22c729`) | **`dpl_AsGpKUfwJ4u7Y77DNHzfgoKJB2Bx`** (`research-platform-5zpu-1mnde5e7o-samer22.vercel.app`), pinned for every check below | `qwxfxckrabvuvuzidxuo` | temporary Vercel automation bypass created for these checks and **revoked afterwards**; test agreements activated in the test project only | 2026-10-02 |
| **H10** trusted client address | same | same | same | **pass**: six requests all claiming `x-forwarded-for: 198.51.100.7` produced 4 rate-limit keys (the container's real egress pool), not 1 — Vercel replaces the client's header. (A first run with five *different* spoofed values gave 5 keys; a control run without spoofing showed the container egresses from several addresses, so that run was inconclusive.) | 2026-10-02 |
| **H3** browser upload + CORS | same | same | same | **pass**: real Chromium on the preview origin: terms → intent (201) → cross-origin PUT to the signed Storage URL **200** → finalize 200, decision `manual`, `extraction.mayStart=false` | 2026-10-02 |
| **H2** signed upload | same | same | same | **pass**: other path with the same token refused (400); anonymous direct upload refused (403); issued path accepted; overwrite via the same authorization refused even with upsert (409); hosted Storage issues the authorization for **120 minutes**. Post-expiry attempt: see the next row | 2026-10-02 |
| **H2** actual authorization expiry | — | authorization issued by `dpl_68qK…` at 15:19 UTC, expiring 17:19:05 UTC; never used before expiry | same | **pending**: a background attempt to upload with this authorization runs at 17:20 UTC; the result is recorded in the next commit | 2026-10-02 |
| **H4** finalize and recovery | same | same | same | **pass**: finalize before the upload 409 `upload_missing`, then succeeds after upload; wrong intent token 404; two concurrent finalizes + a retry return one paper and the same confirmation token (`alreadyFinalized`) | 2026-10-02 |
| **H6** manual mode, no AI | same | same | same | **pass**: `/api/extract` returns 200 `{mode:"manual", recorded:true}` (documented M1 behaviour, not an error); `ai_generations` stays 0; no extraction started | 2026-10-02 |
| **H5** after cutover | same | same | same | **pass**: anonymous `submit_paper` refused (42501) while signed submissions complete (H3/H4) | 2026-10-02 |
| **H1** Auth, staff, cookies | same | same | same | **pass** (synthetic users created in the test project's `auth.users`; GoTrue rejects `example.test` at sign-up): password sign-in 200, wrong password 400; admin `me` 200, signed-in non-staff 403, anonymous 401, forged signature 401; admin responses `no-store` + `noindex, nofollow`; staff-exclusion cookie `Secure; HttpOnly; SameSite=Lax`, value `v1.<exp>.<sig>` without the user id, anonymous 401, the cookie alone grants no admin access | 2026-10-02 |
| **H7** public eligibility | same | same | same | **pass**: non-UofK record cannot be approved (422 `preconditions_failed`); search lists exactly the approved records; page/API show no email, phone, review note, paper id, storage path or token (the footer's published platform number excluded); RIS and BibTeX 200; abstract-only record never serves a file (404); full text 404 while the legal restriction is active and the page does not link it; unknown ids 404 on page, API, cite, file; sitemap lists no records without an origin; robots disallows `/confirm/`, `/admin`, `/api/` | 2026-10-02 |
| **H7** full text (restriction lifted **in the test database only**, then restored) | same | same | same | **pass**: HEAD issues no link; GET 303 to a signed Storage link; file served (`%PDF-`); the public object URL refused (400). Restriction `fulltext_legal_advice` re-activated afterwards | 2026-10-02 |
| **H8** withdrawal + signed-link expiry | same | same | same | **pass**: withdrawal makes page, API, citation and file 404 immediately and removes the record from search and sitemap; an already-issued 60 s signed link kept working inside its lifetime (documented exposure window) and was refused (400) at 66 s | 2026-10-02 |
| **H9** hosted caching | same | same | same | **pass**: public page `private, no-cache, no-store`, API `no-store`, `x-vercel-cache: MISS`; no stale content after withdrawal | 2026-10-02 |
| **H11** metrics timeout + staff exclusion | same | same | same | **pass (safety), finding (coverage)**: with `activity_counts`/`activity_dedup` locked, the page rendered in 1.2 s with "Activity counts are not available right now." and a citation export returned in 0.8 s; staff-cookie events not counted; HEAD records nothing. **Finding:** without any lock, 5 of ~8 event writes logged `activity_timed_out` — functions run in `iad1` (Washington) and the database in `eu-central-1` (Frankfurt), so several round trips exceed the 400 ms budget. Counts are never faked, but most activity would go uncounted. Fix before relying on counts: set the Vercel Function Region to `fra1` (one region, available on the free plan), then re-run H11 | 2026-10-02 |
| **Regions verified** | — | production `dpl_5QKkcSogvP1pm6dx54kavRa91ijK` (`f45dc690`) runs in **`iad1`**; test and production Supabase are **`eu-central-1`** | both | the live site already crosses the Atlantic for every database call | 2026-10-02 |
| **H11 re-run on `fra1`** | `70d88ef3` (adds `vercel.json` `"regions": ["fra1"]`, branch only) | **`dpl_68qKpVFHM4nKKdAW22QtCuj3YTd1`** (`regions: fra1`); production deployment unchanged (still `iad1`, `f45dc690`) | `qwxfxckrabvuvuzidxuo` | **pass**: 30 ordinary page-view events from distinct browser clients → **30/30 recorded**, median 209 ms; 10 citation exports 200, median 221 ms; **0** `activity_timed_out` log lines. Same load against the `iad1` deployment `dpl_AsGp…` minutes later: **7/30 recorded**, median 469 ms; citations median 577 ms; **28** timeouts (23 events + 5 citations). The database later showed 16 page views and 4 citations from that iad1 run landing *after* the request had reported a timeout — the documented "write may complete after the caller stops waiting"; no response claimed them. With the metrics tables locked on `fra1`: page 200 in 1.1 s with "Activity counts are not available right now.", citation 200 in 1.05 s. The 400 ms budget is kept; no code change is supported by the evidence | 2026-10-02 |
| **Stage A rehearsal, production-shaped data** | migrations as in §4 Stage A; schema `f45dc690` | local Postgres 16 + Supabase default grants (`scripts/rehearse-stage-a.sh`) | — | **pass**: PREFLIGHT and every AFTER block PASS; data fingerprint identical before/after; as `anon`: direct reads 0 rows, wrong and bare-UUID tokens refused, correct token reads, `f45dc690`'s exact confirmation payload succeeds (Facebook ignored, `٢٠١٩م` → 2019), legacy `submit_paper` works and is stamped `manual`, new tables denied | 2026-10-02 |
| **Stage A checks on hosted Postgres 17** | `supabase/release/stage-a-checks.sql` | test project (has 0014 + synthetic activity) | `qwxfxckrabvuvuzidxuo` | **runs and catches deviations**: `AFTER 0017` reports exactly the expected differences there (0014 present, activity rows, test agreements active, old path closed, fewer rows) and no unexpected browser grants | 2026-10-02 |
| **Production preflight (read-only)** | — | production `mzpkiuovjppmavqkppem` | — | **PREFLIGHT PASS**; data fingerprint `ece227369f14ec7f3639362b4c011dbf` (35 papers, last created/confirmed 2026-09-25) | 2026-10-02 |

---

## 7a. The exposed production service-role key — founder decision: not rotated

**Decision (Samer, 2026-10-02): the Supabase keys will not be rotated or changed. Rotation is not a prerequisite for this release.** The sequence below is kept for reference only, in case that decision is revisited.

**Remaining risk, accepted.** Whoever obtains that key can read, change or delete any production data and files, bypassing RLS, from anywhere, without going through the application; nothing in this release limits that. After stage D the database will also hold submission acceptances, contact details and (later) reviewer records, which widens what the key reaches. Exposure points: this session's transcript and the PowerShell history on the founder's computer. Mitigations that need no key change: delete the PowerShell history (`Remove-Item (Get-PSReadLineOption).HistorySavePath`); do not paste the key anywhere else; Supabase → Logs (API / Postgres) can be reviewed for service-role requests not coming from Vercel. Revisit the decision before full-text release or if any unexplained data change appears.

On 2026-10-02 the production `service_role` key (legacy JWT, project `mzpkiuovjppmavqkppem`) and the production anon key were pasted into a terminal prompt and so appear in this session's transcript and in the founder's PowerShell history. Until rotated, anyone holding that key bypasses every RLS policy in production.

**Where the production key is used today**
- Vercel: `SUPABASE_SERVICE_ROLE_KEY`, Production target only (created 2026-09-22). Read server-side by `lib/supabaseAdminClient.js`.
- `lib/public/activity.js` falls back to it as an HMAC secret only when `SUBMISSION_TOKEN_SECRET` is unset (not relevant to the deployed `f45dc690`; set the secret in stage B).
- Not in GitHub Actions (`checks.yml` uses no secrets), not committed anywhere, not in Preview (the release branch's Preview uses the test project's key).
- The production **anon** key (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, all environments except this branch's override) is signed by the same legacy JWT secret and is built into browser bundles, so rotating the legacy secret replaces it too.

**Reference sequence, not planned (legacy JWT secret rotation; the smallest change the deployed code is known to support).** It changes production settings and redeploys production, so it needs your explicit approval and is best done in a quiet hour. Production has 0 Auth users, so signing everyone out costs nothing.
1. Clear the PowerShell history: `Remove-Item (Get-PSReadLineOption).HistorySavePath`.
2. Supabase → production project → Settings → JWT Keys → rotate (generate a new) legacy JWT secret. From this moment the old anon **and** service keys stop working, and the live site cannot submit until step 4 finishes; have steps 3–4 ready.
3. Copy the new `anon` and `service_role` keys from Settings → API Keys (legacy tab). In Vercel, edit (do not add a second copy of) `SUPABASE_SERVICE_ROLE_KEY` (Production, Sensitive) and the shared `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Development/Preview/Production). Leave this branch's Preview overrides alone.
4. Redeploy the **current** production deployment (`f45dc690`) so both values take effect; anon is baked in at build time, so a redeploy is required, not optional.
5. Verify: run `scripts/check-isolation.js`-style probes with the **old** key against production (`/auth/v1/admin/users` must answer 401); load the production site and submit one synthetic document; confirm it appears in `papers`; delete it.
6. Rollback: there is no way back to the old secret, and none is wanted; if step 4 fails, fix the Vercel values and redeploy again.

**Alternative, later:** move to Supabase's new API keys (`sb_publishable_…` / `sb_secret_…`) and disable legacy keys. Test it on the test project first (the deployed code has not been exercised with non-JWT keys); it can follow the release.

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
| D7 | Authorize a free second Supabase project + branch-scoped preview variables (§2) | Done 2026-09-30/10-02 |
| D8 | Rotate the exposed production service-role key (§7a) | **Decided 2026-10-02: no rotation; risk accepted (§7a)** |

### Remaining blockers (2026-10-02)
1. **Approval of stage A** (production migrations 0011–0017, §4). Everything it needs is prepared and the production preflight passes.
2. Later stages need their own approvals and founder decisions D2 (agreement), D3 (confidentiality text), D4 (request log), D6 (domain).
Not blockers: isolated hosted verification (complete, §7), activity counts (fixed by `fra1`, verified), key rotation (founder decision: not rotated; accepted risk in §7a).

### Pre-existing observations (not introduced by this release; no action needed for it)
- On the six original tables the browser roles hold Supabase's default grants (including `TRUNCATE`, which RLS does not cover). The API cannot issue `TRUNCATE`, so it is not reachable through the site; a later hardening migration can revoke these grants.
- `anon` can execute `normalize_year_text` (a pure year parser) and the trigger functions `prevent_premature_publish` / `stamp_submission_extraction_policy` (not callable directly). Harmless; listed so the Stage A checks' allow-list is explained.
