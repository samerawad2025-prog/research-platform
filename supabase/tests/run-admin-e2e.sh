#!/usr/bin/env bash
# Admin review (Phase 3 M4) against the LOCAL Supabase
# stack (start it first: supabase/tests/local-stack/start.sh). Builds the
# app with local keys only, starts it on 127.0.0.1:3100 with the mock AI
# provider (nothing is sent to Gemini), and runs admin-e2e.test.js.
#   supabase/tests/run-browser-e2e.sh                 # before cutover
#   E2E_PHASE=after-cutover supabase/tests/run-browser-e2e.sh
# Needs Playwright with Chromium (NODE_PATH pointing at a global install is fine).
set -euo pipefail
cd "$(dirname "$0")/../.."
SB_DIR=${SB_DIR:-/var/tmp/sb}
key() { node -e "console.log(require('$SB_DIR/keys.json').$1)"; }
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(key anon)"
export SUPABASE_SERVICE_ROLE_KEY="$(key service)"
export SUBMISSION_ACCEPTANCE_FLOW=enabled
export ADMIN_REVIEW=enabled
export SUBMISSION_TOKEN_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export EXTRACTION_MODE=automatic
export AI_PROVIDER=mock
unset GEMINI_API_KEY VERCEL_ENV || true
if [ "${E2E_SKIP_BUILD:-}" != 1 ]; then npx next build > /var/tmp/e2e-build.log 2>&1; fi
if curl -s -o /dev/null http://127.0.0.1:3100/; then echo "port 3100 is already in use; stop that server first" >&2; exit 1; fi
# Started directly (not through npx) so the trap stops the server itself.
setsid node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3100 > /var/tmp/e2e-server.log 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null || kill $SERVER 2>/dev/null || true' EXIT
until curl -sf -o /dev/null http://127.0.0.1:3100/; do sleep 1; done
node supabase/tests/admin-e2e.test.js
