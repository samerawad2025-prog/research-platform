#!/usr/bin/env bash
# A disposable, LOCAL Supabase stack for supabase/tests/supabase-local.test.js:
# Supabase's Postgres image, PostgREST and the Storage API (file backend),
# plus a small gateway on 127.0.0.1:54321 standing in for Kong. No hosted
# project, no production credentials, no cost. Needs Docker and Node.
#
#   supabase/tests/local-stack/start.sh      # start + load schema
#   SB_EXPECT_UPLOAD_TTL=7200 node supabase/tests/supabase-local.test.js
#   supabase/tests/local-stack/start.sh stop
#
# UPLOAD_SIGNED_URL_EXPIRATION_TIME is set to 7200 s, the lifetime hosted
# Supabase documents for signed upload URLs; the Storage API's own default
# is 60 s. Confirm the real value on the preview project before cutover.
set -euo pipefail
cd "$(dirname "$0")/../../.."
SB_DIR=${SB_DIR:-/var/tmp/sb}
PW=localtestpw
if [ "${1:-}" = stop ]; then
  docker rm -f sb-auth sb-storage sb-rest sb-db >/dev/null 2>&1 || true
  docker network rm sb >/dev/null 2>&1 || true
  [ -f "$SB_DIR/gateway.pid" ] && kill "$(cat "$SB_DIR/gateway.pid")" 2>/dev/null || true
  exit 0
fi
mkdir -p "$SB_DIR"
SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
echo -n "$SECRET" > "$SB_DIR/jwt_secret"
node -e '
const c=require("crypto"),s=process.argv[1],b=(o)=>Buffer.from(JSON.stringify(o)).toString("base64url")
const jwt=(role)=>{const h=b({alg:"HS256",typ:"JWT"}),p=b({role,iss:"supabase-local",iat:1700000000,exp:2000000000});return h+"."+p+"."+c.createHmac("sha256",s).update(h+"."+p).digest("base64url")}
console.log(JSON.stringify({anon:jwt("anon"),service:jwt("service_role"),authenticated:jwt("authenticated")}))' "$SECRET" > "$SB_DIR/keys.json"
key() { node -e "console.log(require('$SB_DIR/keys.json').$1)"; }

docker network create sb >/dev/null 2>&1 || true
docker run -d --name sb-db --network sb -p 54322:5432 -e POSTGRES_PASSWORD=$PW -e JWT_SECRET="$SECRET" supabase/postgres:17.6.1.011 >/dev/null
until docker exec sb-db pg_isready -h localhost >/dev/null 2>&1; do sleep 1; done
sleep 3
PSQL="docker exec -i -e PGPASSWORD=$PW sb-db psql -h localhost -U supabase_admin -d postgres -v ON_ERROR_STOP=1 -q"
$PSQL -c "alter role authenticator with password '$PW'; alter role supabase_storage_admin with password '$PW'; alter role supabase_auth_admin with password '$PW';"

docker run -d --name sb-rest --network sb -p 54330:3000 \
  -e PGRST_DB_URI="postgres://authenticator:$PW@sb-db:5432/postgres" -e PGRST_DB_SCHEMAS=public,storage \
  -e PGRST_DB_ANON_ROLE=anon -e PGRST_JWT_SECRET="$SECRET" -e PGRST_DB_USE_LEGACY_GUCS=false postgrest/postgrest:v12.2.12 >/dev/null
docker run -d --name sb-storage --network sb -p 54331:5000 \
  -e ANON_KEY="$(key anon)" -e SERVICE_KEY="$(key service)" -e PGRST_JWT_SECRET="$SECRET" -e AUTH_JWT_SECRET="$SECRET" \
  -e DATABASE_URL="postgres://supabase_storage_admin:$PW@sb-db:5432/postgres" -e POSTGREST_URL=http://sb-rest:3000 \
  -e FILE_SIZE_LIMIT=52428800 -e STORAGE_BACKEND=file -e FILE_STORAGE_BACKEND_PATH=/var/lib/storage \
  -e TENANT_ID=stub -e REGION=local -e GLOBAL_S3_BUCKET=stub -e ENABLE_IMAGE_TRANSFORMATION=false \
  -e UPLOAD_SIGNED_URL_EXPIRATION_TIME=7200 supabase/storage-api:v1.28.0 >/dev/null

# Supabase Auth (GoTrue). Public sign-up is off, as recommended for
# production: accounts are created by an operator, never by a visitor.
docker run -d --name sb-auth --network sb -p 54332:9999 \
  -e GOTRUE_API_HOST=0.0.0.0 -e GOTRUE_API_PORT=9999 -e API_EXTERNAL_URL=http://127.0.0.1:54321 \
  -e GOTRUE_DB_DRIVER=postgres -e GOTRUE_DB_DATABASE_URL="postgres://supabase_auth_admin:$PW@sb-db:5432/postgres" \
  -e DATABASE_URL="postgres://supabase_auth_admin:$PW@sb-db:5432/postgres" \
  -e GOTRUE_SITE_URL=http://127.0.0.1:3100 -e GOTRUE_JWT_SECRET="$SECRET" -e GOTRUE_JWT_EXP=3600 \
  -e GOTRUE_DISABLE_SIGNUP=true -e GOTRUE_MAILER_AUTOCONFIRM=false -e GOTRUE_EXTERNAL_EMAIL_ENABLED=true \
  supabase/gotrue:v2.174.0 >/dev/null
until curl -sf http://127.0.0.1:54332/health >/dev/null; do sleep 1; done

node supabase/tests/local-stack/gateway.js > "$SB_DIR/gateway.log" 2>&1 &
echo $! > "$SB_DIR/gateway.pid"
until curl -sf http://127.0.0.1:54321/storage/v1/status >/dev/null; do sleep 1; done

# The production schema as of the base branch, then the release migrations
# in production order (0014, the cutover, is left to the tests that need it).
git show "${BASE_REF:-origin/research-platform}:supabase/schema.sql" | $PSQL
$PSQL < supabase/migrations/0011_manual_entry.sql
$PSQL < supabase/migrations/0012_submission_acceptance.sql
$PSQL < supabase/migrations/0013_linkedin_visibility_declared_authors.sql
$PSQL < supabase/migrations/0015_admin_review.sql
$PSQL < supabase/migrations/0016_public_research.sql
$PSQL < supabase/migrations/0017_activity_metrics.sql
$PSQL < supabase/migrations/0018_ai_processing_agreement.sql
$PSQL < supabase/migrations/0019_gemini_free_tier_agreement.sql
$PSQL < supabase/migrations/0020_free_tier_full_document_agreement.sql
$PSQL -c "notify pgrst, 'reload schema'"
echo "local Supabase stack ready at http://127.0.0.1:54321 (keys in $SB_DIR)"
