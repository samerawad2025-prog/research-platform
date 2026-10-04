#!/usr/bin/env bash
# Browser-to-database test for Phase 3 M2B/M3 against the LOCAL Supabase
# stack (start it first: supabase/tests/local-stack/start.sh). Builds the
# app with local keys only, starts it on 127.0.0.1:3100 with the mock AI
# provider (nothing is sent to Gemini), and runs browser-e2e.test.js.
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
export SUBMISSION_TOKEN_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export EXTRACTION_MODE=automatic
# The launch arrangement: Google's unpaid (free-tier) terms, agreement
# version 4 (migration 0020): the document itself is read. The provider is still
# the mock; it appends every request it receives to MOCK_RECORD so the test
# can check exactly what would have left the server.
export GEMINI_DATA_TERMS=unpaid
export AI_PROVIDER=mock
export MOCK_RECORD=/var/tmp/e2e-mock-requests.jsonl
export MOCK_CONTROL_FILE=/var/tmp/e2e-mock-control.json
rm -f "$MOCK_RECORD"
echo "{\"recordTo\": \"$MOCK_RECORD\"}" > "$MOCK_CONTROL_FILE"
unset GEMINI_API_KEY VERCEL_ENV || true
if [ "${E2E_SKIP_BUILD:-}" != 1 ]; then npx next build > /var/tmp/e2e-build.log 2>&1; fi
if curl -s -o /dev/null http://127.0.0.1:3100/; then echo "port 3100 is already in use; stop that server first" >&2; exit 1; fi
# Started directly (not through npx) so the trap stops the server itself.
setsid node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3100 > /var/tmp/e2e-server.log 2>&1 &
SERVER=$!
trap 'kill -- -$SERVER 2>/dev/null || kill $SERVER 2>/dev/null || true' EXIT
until curl -sf -o /dev/null http://127.0.0.1:3100/; do sleep 1; done
node supabase/tests/browser-e2e.test.js
