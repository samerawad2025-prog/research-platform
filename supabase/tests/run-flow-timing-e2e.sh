#!/usr/bin/env bash
# The flow-timing browser test (premature thank-you, Gemini default, manual
# choice, failure and retry, double submit) against the LOCAL Supabase stack
# (start it first: supabase/tests/local-stack/start.sh, then apply 0018 to
# it). Builds the app with local keys, then runs the test twice: the
# acceptance form (SUBMISSION_ACCEPTANCE_FLOW=enabled) and the legacy form.
# The AI provider is the in-repository mock; nothing is sent to Gemini.
#   supabase/tests/run-flow-timing-e2e.sh
# Needs Playwright with Chromium (NODE_PATH pointing at a global install is fine).
set -euo pipefail
cd "$(dirname "$0")/../.."
SB_DIR=${SB_DIR:-/var/tmp/sb}
key() { node -e "console.log(require('$SB_DIR/keys.json').$1)"; }
export NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$(key anon)"
export SUPABASE_SERVICE_ROLE_KEY="$(key service)"
export SUBMISSION_TOKEN_SECRET="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
export EXTRACTION_MODE=automatic GEMINI_DATA_TERMS=paid AI_PROVIDER=mock
export MOCK_CONTROL_FILE=${MOCK_CONTROL_FILE:-/var/tmp/mock-control.json}
echo '{}' > "$MOCK_CONTROL_FILE"
unset GEMINI_API_KEY VERCEL_ENV || true
if [ "${E2E_SKIP_BUILD:-}" != 1 ]; then npx next build > /var/tmp/timing-build.log 2>&1; fi
if curl -s -o /dev/null http://127.0.0.1:3100/; then echo "port 3100 is already in use; stop that server first" >&2; exit 1; fi
run_flow() {
  setsid node node_modules/next/dist/bin/next start -H 127.0.0.1 -p 3100 > "/var/tmp/timing-server-$1.log" 2>&1 &
  local server=$!
  until curl -sf -o /dev/null http://127.0.0.1:3100/; do sleep 1; done
  local rc=0
  E2E_FLOW=$1 node supabase/tests/flow-timing-e2e.test.js || rc=$?
  kill -- -$server 2>/dev/null || kill $server 2>/dev/null || true
  while curl -s -o /dev/null http://127.0.0.1:3100/; do sleep 1; done
  return $rc
}
SUBMISSION_ACCEPTANCE_FLOW=enabled run_flow acceptance
SUBMISSION_ACCEPTANCE_FLOW= run_flow legacy
