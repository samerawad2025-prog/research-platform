#!/usr/bin/env bash
# Release rehearsal on a disposable LOCAL Postgres (never a hosted project).
# Replays the exact production database sequence from docs/release-runbook.md:
#   1. the production schema as deployed (schema.sql at the production commit),
#   2. migrations 0011, 0012, 0013, 0015, 0016, 0017, 0018, 0019 in order, each applied
#      twice (idempotence), with the pre-release anonymous submission path
#      exercised after them (the deployed application must keep working),
#   3. migration 0014 (the cutover), after which that path must be refused,
# then checks that this migrated database has the same schema as a fresh
# install from the release's schema.sql plus 0014.
# Needs psql/createdb/pg_dump on PATH and PGHOST/PGPORT/PGUSER for a local server.
#   PROD_REF=f45dc690 scripts/rehearse-release.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PROD_REF=${PROD_REF:-origin/research-platform}
MIG=supabase/migrations
TMP=$(mktemp -d)
trap 'dropdb --if-exists rel_migrated >/dev/null 2>&1; dropdb --if-exists rel_fresh >/dev/null 2>&1; rm -rf "$TMP"' EXIT
run() { psql -X -q -v ON_ERROR_STOP=1 -d "$1" -f "$2" >/dev/null 2>"$TMP/err" || { cat "$TMP/err" >&2; exit 1; }; }
q() { psql -X -q -At -v ON_ERROR_STOP=1 -d "$1" -c "$2"; }
fingerprint() {
  q "$1" "select concat_ws(' ',
    case when exists(select 1 from information_schema.columns where table_name='papers' and column_name='manual_entry_at') then '0011' end,
    case when to_regclass('public.agreement_versions') is not null then '0012' end,
    case when exists(select 1 from information_schema.columns where table_name='researchers' and column_name='linkedin_public') then '0013' end,
    case when not exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then '0014' end,
    case when to_regclass('public.staff_members') is not null then '0015' end,
    case when to_regclass('public.public_records') is not null then '0016' end,
    case when to_regclass('public.activity_counts') is not null then '0017' end,
    case when exists(select 1 from information_schema.columns where table_name='agreement_versions' and column_name='external_ai_processing') then '0018' end,
    case when exists(select 1 from pg_constraint where conname='agreement_versions_external_ai_processing_check' and pg_get_constraintdef(oid) like '%gemini_api_unpaid%') then '0019' end,
    case when exists(select 1 from agreement_versions where id='submission-terms-2026-10-04-v4-en') then '0020' end)"
}
legacy_path() { # prints 'open' if anon can still run submit_paper and insert into storage
  q "$1" "select case when (select bool_or(has_function_privilege('anon', p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname='public' and p.proname='submit_paper')
                        and exists(select 1 from pg_policies where schemaname='storage' and policyname='anon can upload research files') then 'open' else 'closed' end"
}

echo "== 1. production schema at $PROD_REF"
dropdb --if-exists rel_migrated >/dev/null 2>&1; createdb rel_migrated
run rel_migrated supabase/tests/supabase-stubs.sql
git show "$PROD_REF:supabase/schema.sql" > "$TMP/prod.sql"; run rel_migrated "$TMP/prod.sql"
echo "   fingerprint: [$(fingerprint rel_migrated)]  legacy path: $(legacy_path rel_migrated)"

echo "== 2. pre-merge migrations (each twice)"
for m in 0011_manual_entry 0012_submission_acceptance 0013_linkedin_visibility_declared_authors 0015_admin_review 0016_public_research 0017_activity_metrics 0018_ai_processing_agreement 0019_gemini_free_tier_agreement 0020_free_tier_full_document_agreement; do
  run rel_migrated "$MIG/$m.sql"; run rel_migrated "$MIG/$m.sql"; echo "   applied $m"
done
echo "   fingerprint: [$(fingerprint rel_migrated)]  legacy path: $(legacy_path rel_migrated)"
[ "$(legacy_path rel_migrated)" = open ] || { echo "FAIL: the deployed application's path must still work before cutover" >&2; exit 1; }
# The deployed (pre-release) application's anonymous submission still works.
out=$(q rel_migrated "set role anon; select submit_paper('Synthetic Person', 'rehearsal@example.invalid', 'rehearsal.pdf', true, array['abstract_and_citation'], null) is not null")
[ "$out" = t ] || { echo "FAIL: anonymous submit_paper stopped working before cutover" >&2; exit 1; }
echo "   ok: the deployed application's anonymous submission still works"

echo "== 3. cutover (0014)"
run rel_migrated "$MIG/0014_close_legacy_submission_path.sql"
echo "   fingerprint: [$(fingerprint rel_migrated)]  legacy path: $(legacy_path rel_migrated)"
[ "$(legacy_path rel_migrated)" = closed ] || { echo "FAIL: legacy path still open after 0014" >&2; exit 1; }
if psql -X -q -At -d rel_migrated -c "set role anon; select submit_paper('Synthetic Person', 'late@example.invalid', 'late.pdf', true, array['abstract_and_citation'], null)" >/dev/null 2>&1; then
  echo "FAIL: anonymous submit_paper still executes after 0014" >&2; exit 1
fi
echo "   ok: anonymous submit_paper refused"

echo "== 4. migrated == fresh install (release schema.sql + 0014)"
dropdb --if-exists rel_fresh >/dev/null 2>&1; createdb rel_fresh
run rel_fresh supabase/tests/supabase-stubs.sql
run rel_fresh supabase/schema.sql
run rel_fresh "$MIG/0014_close_legacy_submission_path.sql"
# Compare structure only, sorted, ignoring ordering and comments.
# Structure AND privileges (grants decide who can reach what), sorted;
# pg_dump's per-run \restrict token is noise.
norm() { pg_dump -s -O --no-comments "$1" | grep -v -E '^(--|SET |SELECT pg_catalog|\\(un)?restrict |$)' | sort; }
norm rel_migrated > "$TMP/a"; norm rel_fresh > "$TMP/b"
if ! diff -q "$TMP/a" "$TMP/b" >/dev/null; then
  echo "DIFF between migrated and fresh schema:" >&2; diff "$TMP/a" "$TMP/b" | head -40 >&2; exit 1
fi
echo "   ok: identical structure and privileges ($(wc -l < "$TMP/a") schema lines)"
echo "   grants: $(q rel_migrated "select count(*) from information_schema.routine_privileges where grantee in ('anon','authenticated') and routine_schema='public'") browser-role function grants (migrated) vs $(q rel_fresh "select count(*) from information_schema.routine_privileges where grantee in ('anon','authenticated') and routine_schema='public'") (fresh)"
echo
echo "Release rehearsal passed."
