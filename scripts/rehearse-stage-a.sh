#!/usr/bin/env bash
# Stage A rehearsal on a disposable LOCAL Postgres (never a hosted project).
#
# Replays docs/release-runbook.md "Stage A — exact procedure" step by step:
#   1. Supabase-like setup: the repository's stubs plus Supabase's default
#      grants on schema public (every new table/function is granted to anon,
#      authenticated and service_role, as on hosted Supabase), so the
#      browser-grant checks behave as they do in production;
#   2. the production schema as deployed (schema.sql at PROD_REF);
#   3. synthetic rows shaped like production on 2026-10-02 (35 papers in the
#      same status/failure/scope mix, 55 researchers, 50 author links, 70
#      ai_generations, 5 confirmed) — no production data;
#   4. supabase/release/stage-a-checks.sql PREFLIGHT, then each migration
#      0011, 0012, 0013, 0015, 0016, 0017 followed by its own check block;
#      every block must print PASS;
#   5. the data fingerprint before and after, which must be identical;
#   6. the deployed application's browser calls (role anon) against the
#      migrated database: direct table access blocked, wrong and bare-UUID
#      tokens refused, correct token read, a confirmation shaped exactly
#      like f45dc690's ConfirmationScreen, and a legacy submit_paper.
#
# Needs psql/createdb on PATH and PGHOST/PGPORT/PGUSER for a local server.
#   PROD_REF=f45dc690 scripts/rehearse-stage-a.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PROD_REF=${PROD_REF:-origin/research-platform}
DB=stage_a_rehearsal
CHECKS=supabase/release/stage-a-checks.sql
MIG=supabase/migrations
TMP=$(mktemp -d)
trap 'dropdb --if-exists $DB >/dev/null 2>&1; rm -rf "$TMP"' EXIT
psqlq() { psql -X -q -At -v ON_ERROR_STOP=1 -d $DB "$@"; }
run() { psqlq -f "$1" >/dev/null 2>"$TMP/err" || { cat "$TMP/err" >&2; exit 1; }; }
section() { awk -v h="$1" 'index($0, "-- ===================== " h) == 1 {on=1; next} /^-- =====================/ {on=0} on' "$CHECKS"; }
check() {
  section "$1" > "$TMP/check.sql"
  local out; out=$(psqlq -F ' | ' -f "$TMP/check.sql")
  echo "   [$1] $out"
  case "$out" in PASS*) ;; *) echo "STOP at $1" >&2; exit 1 ;; esac
}
fingerprint() { section "DATA FINGERPRINT" > "$TMP/fp.sql"; psqlq -F ' | ' -f "$TMP/fp.sql" | cut -d'|' -f1 | tr -d ' '; }

dropdb --if-exists $DB >/dev/null 2>&1; createdb $DB
run supabase/tests/supabase-stubs.sql
psqlq <<'SQL' >/dev/null
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
SQL
git show "$PROD_REF:supabase/schema.sql" > "$TMP/prod.sql"; run "$TMP/prod.sql"
echo "1. production schema from $PROD_REF ($(git rev-parse --short "$PROD_REF"))"

psqlq <<'SQL' >/dev/null
insert into researchers (id, full_name, email, whatsapp_number)
select ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 'Synthetic Researcher ' || i,
       case when i <= 20 then null else 'r' || i || '@example.invalid' end,
       case when i <= 34 then '+2499000' || lpad(i::text, 5, '0') end
from generate_series(1, 55) i;
insert into papers (id, submitted_by, file_path, publication_scope, extraction_status, failure_code, metadata_confirmed_at,
                    extraction_started_at, year, title, confirmation_token_hash)
select ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid,
       'synthetic-' || i || '.pdf',
       (case when i <= 5 then '{metadata_and_article}' when i <= 20 then '{full_paper}'
             when i <= 24 then '{metadata_and_article,full_paper,abstract_and_citation}' when i = 25 then '{metadata_and_article,abstract_and_citation,full_paper}'
             when i <= 27 then '{full_paper,abstract_and_citation,metadata_and_article}' when i <= 34 then '{full_paper,metadata_and_article,abstract_and_citation}'
             else '{abstract_and_citation,metadata_and_article,full_paper}' end)::text[],
       case when i <= 24 then 'completed' when i <= 32 then 'failed' else 'pending' end,
       case when i between 25 and 29 then 'api_error' when i = 30 then 'timeout' end,
       case when i <= 5 then now() - interval '3 days' end,
       case when i <= 23 then now() - interval '4 days' end,
       case when i <= 23 then 2000 + i % 20 end,
       case when i <= 24 then 'Synthetic Thesis ' || i end,
       encode(extensions.digest('tok-' || i, 'sha256'), 'hex')
from generate_series(1, 35) i;
insert into paper_researchers (paper_id, researcher_id, author_order)
select ('00000000-0000-4000-9000-' || lpad(i::text, 12, '0'))::uuid, ('00000000-0000-4000-8000-' || lpad(i::text, 12, '0'))::uuid, 1 from generate_series(1, 35) i
union all select '00000000-0000-4000-9000-000000000001', ('00000000-0000-4000-8000-' || lpad(r::text, 12, '0'))::uuid, r - 34 from generate_series(36, 40) r
union all select ('00000000-0000-4000-9000-' || lpad((r - 39)::text, 12, '0'))::uuid, ('00000000-0000-4000-8000-' || lpad(r::text, 12, '0'))::uuid, 2 from generate_series(41, 50) r;
insert into ai_generations (paper_id, generation_type, provider, model_used, status, result_data, notes)
select p.id, 'metadata_extraction', 'gemini', 'gemini-2.5-flash', case when g = 2 and p.n > 21 then 'failed' else 'success' end,
       jsonb_build_object('title', 'Synthetic', 'pass', g), 'synthetic'
from (select id, row_number() over (order by id) n from papers) p, generate_series(1, 2) g;
update papers p set last_applied_generation_id = (select a.id from ai_generations a where a.paper_id = p.id and a.status = 'success' order by a.result_data->>'pass' limit 1)
where p.id <> '00000000-0000-4000-9000-000000000035';
SQL
echo "2. synthetic production-shaped data: $(psqlq -c "select (select count(*) from papers)||' papers, '||(select count(*) from researchers)||' researchers, '||(select count(*) from paper_researchers)||' links, '||(select count(*) from ai_generations)||' ai_generations'")"

before=$(fingerprint)
echo "3. data fingerprint before: $before"
check "PREFLIGHT"
for m in 0011_manual_entry 0012_submission_acceptance 0013_linkedin_visibility_declared_authors 0015_admin_review 0016_public_research 0017_activity_metrics; do
  run "$MIG/$m.sql"
  check "AFTER ${m:0:4}"
done
after=$(fingerprint)
echo "4. data fingerprint after:  $after"
[ "$before" = "$after" ] || { echo "STOP: existing data changed" >&2; exit 1; }

echo "5. the deployed application's browser calls (role anon), after Stage A:"
out=$(psqlq <<'SQL'
set role anon;
select 'direct select on papers returns ' || count(*) || ' rows' from papers;
select 'wrong token: ' || coalesce(get_paper_for_confirmation('tok-wrong')::text, 'null');
select 'bare paper UUID as token: ' || coalesce(get_paper_for_confirmation('00000000-0000-4000-9000-000000000002')::text, 'null');
select 'correct token reads title: ' || (get_paper_for_confirmation('tok-2')->>'title');
select 'confirm (f45dc690 payload): ' || (confirm_researcher_metadata('tok-2',
  '[{"researcher_id":"00000000-0000-4000-8000-000000000002","full_name":"Synthetic Researcher 2","author_order":1,"linkedin_url":"","facebook_url":"https://facebook.com/someone"},
    {"researcher_id":"00000000-0000-4000-8000-000000000041","full_name":"Synthetic Researcher 41","author_order":2,"linkedin_url":"","facebook_url":""}]'::jsonb,
  '{"year":"٢٠١٩م","title":"Synthetic Thesis 2 (confirmed)"}'::jsonb) ? 'confirmed_at');
select 'legacy submit_paper: ' || (submit_paper('Synthetic Legacy', 'legacy@example.invalid', 'synthetic-legacy.pdf', true, array['abstract_and_citation'], null) ? 'confirmation_token');
reset role;
select 'after confirm: year=' || year || ', title=' || title from papers where id = '00000000-0000-4000-9000-000000000002';
select 'facebook stored for researcher 2: ' || (facebook_url is not null) || ', linkedin_public: ' || linkedin_public from researchers where id = '00000000-0000-4000-8000-000000000002';
select 'new legacy paper stamped: ' || coalesce(submission_extraction_policy, 'null') from papers where file_path = 'synthetic-legacy.pdf';
SQL
)
echo "$out" | sed 's/^/   /'
grep -q "direct select on papers returns 0 rows" <<<"$out"
grep -q "wrong token: null" <<<"$out"
grep -q "bare paper UUID as token: null" <<<"$out"
grep -q "correct token reads title: Synthetic Thesis 2" <<<"$out"
grep -q "confirm (f45dc690 payload): true" <<<"$out"
grep -q "legacy submit_paper: true" <<<"$out"
grep -q "after confirm: year=2019" <<<"$out"
grep -q "facebook stored for researcher 2: false" <<<"$out"
grep -q "new legacy paper stamped: manual" <<<"$out"
echo "6. anonymous access to a new table is refused:"
if psqlq -c "set role anon; select count(*) from agreement_versions" >/dev/null 2>&1; then echo "STOP: anon can read agreement_versions" >&2; exit 1; fi
echo "   anon select on agreement_versions: permission denied"
echo "Stage A rehearsal passed"
