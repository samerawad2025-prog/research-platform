#!/usr/bin/env bash
# Tests migration 0011 against a DISPOSABLE local Postgres (never a
# Supabase project). Usage:
#   PGHOST=/path/to/socket PGPORT=55432 PGUSER=postgres supabase/tests/run-0011.sh
# Loads the pre-migration schema from git (origin/research-platform),
# seeds synthetic rows in every relevant state, applies 0011, then runs
# the assertions in 0011_manual_extraction_status.test.sql.
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=m1_migration_test
BASE_REF=${BASE_REF:-origin/research-platform}
dropdb --if-exists "$DB"
createdb "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/supabase-stubs.sql
git show "$BASE_REF:supabase/schema.sql" | psql -q -v ON_ERROR_STOP=1 -d "$DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" <<'SQL'
-- Synthetic rows only: a submitter, and one paper in each state that
-- matters to the migration. Tokens are hashed exactly as submit_paper does.
insert into researchers (id, full_name, email) values
  ('00000000-0000-0000-0000-000000000001', 'Synthetic Submitter', 'synthetic@example.invalid');
insert into papers (title, title_ar, file_path, permission_to_process, publication_scope, submitted_by,
                    extraction_status, metadata_confirmed_at, confirmation_token_hash, year)
values
  (null, 'قيد الانتظار', 'a.pdf', true, '{abstract_and_citation}', '00000000-0000-0000-0000-000000000001',
   'pending', null, encode(extensions.digest('tok-pending', 'sha256'), 'hex'), null),
  ('Confirmed thesis', null, 'b.pdf', true, '{full_paper}', '00000000-0000-0000-0000-000000000001',
   'completed', now(), encode(extensions.digest('tok-confirmed', 'sha256'), 'hex'), 2019),
  ('Partial', null, 'c.docx', true, '{metadata_and_article}', '00000000-0000-0000-0000-000000000001',
   'partial', null, encode(extensions.digest('tok-partial', 'sha256'), 'hex'), null),
  ('Failed', null, 'd.pdf', true, '{abstract_and_citation}', '00000000-0000-0000-0000-000000000001',
   'failed', null, encode(extensions.digest('tok-failed', 'sha256'), 'hex'), null);
create table pre_migration_snapshot as select id, row(p.*)::text as row_text from papers p;
SQL
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0011_manual_extraction_status.sql
# Idempotent: applying it twice is harmless.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0011_manual_extraction_status.sql
psql -v ON_ERROR_STOP=1 -d "$DB" -f supabase/tests/0011_manual_extraction_status.test.sql
dropdb "$DB"
