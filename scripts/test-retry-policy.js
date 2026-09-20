#!/usr/bin/env node
//
// Regression test for the Gemini retry policy (BUG_HISTORY.md #29).
//
// Run: node scripts/test-retry-policy.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// The case that matters is the real one. On 2026-09-19 a 429 said
// "Please retry in 12.577097057s" and the code retried after a fixed
// 1500ms. The second 429 then said "retry in 10.830900339s" - the
// 1.746s drift between those two figures proves the window was rolling
// and that the retry landed inside it. It could not have succeeded,
// and on a 429 it also spent more of the quota just exhausted.

const assert = require('node:assert')
const { decideRetry, parseRetryDelayMs, MAX_RETRY_DELAY_MS } = require('../lib/ai/retryPolicy')

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`ok     ${name}`)
  } catch (err) {
    console.error(`FAIL   ${name} — ${err.message}`)
    failed++
  }
}

// The literal shape of the production 429, message text and all.
const REAL_429_BODY = {
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message:
      'You exceeded your current quota, please check your plan and billing details. ' +
      'Please retry in 12.577097057s.',
  },
}

// The documented structured form.
const RETRY_INFO_BODY = {
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message: 'Quota exceeded.',
    details: [
      { '@type': 'type.googleapis.com/google.rpc.QuotaFailure', violations: [] },
      { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '14.2s' },
    ],
  },
}

// --- reading the stated delay ----------------------------------------------
check('the real production 429 message yields its stated delay', () => {
  assert.strictEqual(parseRetryDelayMs({ headers: null, body: REAL_429_BODY }), 12577)
})

check('structured RetryInfo is read', () => {
  assert.strictEqual(parseRetryDelayMs({ headers: null, body: RETRY_INFO_BODY }), 14200)
})

check('a Retry-After header in seconds wins over the body', () => {
  const headers = new Map([['retry-after', '9']])
  headers.get = Map.prototype.get.bind(headers)
  assert.strictEqual(parseRetryDelayMs({ headers, body: REAL_429_BODY }), 9000)
})

check('a plain-object headers bag works too', () => {
  assert.strictEqual(parseRetryDelayMs({ headers: { 'retry-after': '3' }, body: null }), 3000)
})

check('a Retry-After HTTP date is converted to a delay', () => {
  const when = new Date(Date.now() + 8000).toUTCString()
  const ms = parseRetryDelayMs({ headers: { 'retry-after': when }, body: null })
  assert.ok(ms > 5000 && ms <= 9000, `expected ~8000ms, got ${ms}`)
})

check('no delay anywhere yields null, not a guess', () => {
  assert.strictEqual(parseRetryDelayMs({ headers: null, body: { error: { message: 'nope' } } }), null)
  assert.strictEqual(parseRetryDelayMs({ headers: null, body: null }), null)
  assert.strictEqual(parseRetryDelayMs({ headers: {}, body: {} }), null)
})

check('a malformed retryDelay is ignored rather than becoming NaN', () => {
  const body = { error: { details: [{ '@type': 'x/RetryInfo', retryDelay: 'soon' }] } }
  assert.strictEqual(parseRetryDelayMs({ headers: null, body }), null)
})

// --- the decision ----------------------------------------------------------
check('THE REGRESSION: a pass-1 429 waits the server-stated delay, not 1500ms', () => {
  const d = decideRetry({ status: 429, pass: 1, headers: null, body: REAL_429_BODY, alreadyRetried: false })
  assert.strictEqual(d.retry, true)
  assert.strictEqual(d.statedDelayMs, 12577)
  assert.ok(
    d.delayMs > 12577,
    `must wait past the stated window, got ${d.delayMs}ms against a stated ${d.statedDelayMs}ms`
  )
  assert.ok(d.delayMs < MAX_RETRY_DELAY_MS, 'and still inside the cap')
})

check('the old fixed 1500ms would have been inside the stated window', () => {
  // Stated as a fact about the bug, so the test documents why the fix
  // exists and not merely what it does.
  assert.ok(1500 < 12577, 'the old delay was ~8x shorter than the server asked for')
})

check('a pass-2 429 does NOT retry - pass 1 is already usable', () => {
  const d = decideRetry({ status: 429, pass: 2, headers: null, body: REAL_429_BODY, alreadyRetried: false })
  assert.strictEqual(d.retry, false)
  assert.match(d.reason, /pass2/)
})

check('a 429 with no stated delay does NOT retry blind', () => {
  const d = decideRetry({ status: 429, pass: 1, headers: null, body: { error: { message: 'quota' } }, alreadyRetried: false })
  assert.strictEqual(d.retry, false)
  assert.strictEqual(d.reason, 'quota_exhausted_no_delay_given')
})

check('an hours-long quota delay fails fast instead of hanging the function', () => {
  const body = { error: { details: [{ '@type': 'x/RetryInfo', retryDelay: '3600s' }] } }
  const d = decideRetry({ status: 429, pass: 1, headers: null, body, alreadyRetried: false })
  assert.strictEqual(d.retry, false)
  assert.strictEqual(d.reason, 'quota_delay_too_long')
  assert.strictEqual(d.statedDelayMs, 3600000)
})

check('503 retries quickly - the failed call cost nothing', () => {
  const d = decideRetry({ status: 503, pass: 1, headers: null, body: null, alreadyRetried: false })
  assert.strictEqual(d.retry, true)
  assert.ok(d.delayMs > 0 && d.delayMs < 4000, `expected a short backoff, got ${d.delayMs}`)
})

check('503 retries on pass 2 as well - unlike 429, it spends no quota', () => {
  const d = decideRetry({ status: 503, pass: 2, headers: null, body: null, alreadyRetried: false })
  assert.strictEqual(d.retry, true)
})

check('a network error retries', () => {
  const d = decideRetry({ status: null, pass: 1, headers: null, body: null, alreadyRetried: false })
  assert.strictEqual(d.retry, true)
  assert.strictEqual(d.reason, 'network_error')
})

check('the retry budget is one - never a loop', () => {
  const d = decideRetry({ status: 503, pass: 1, headers: null, body: null, alreadyRetried: true })
  assert.strictEqual(d.retry, false)
  assert.strictEqual(d.reason, 'already_retried')
})

for (const status of ['timeout', 'max_tokens', 'empty_response', 'malformed_json', 400, 401, 403, 404, 500]) {
  check(`${status} is not retried`, () => {
    const d = decideRetry({ status, pass: 1, headers: null, body: null, alreadyRetried: false })
    assert.strictEqual(d.retry, false, `${status} must not be retried`)
  })
}

check('a quota wait is NEVER shorter than the server stated, across many draws', () => {
  // This caught a real bug during development: symmetric jitter pulled
  // a 12.577s stated delay down to 12.029s, back inside the window.
  for (let i = 0; i < 1000; i++) {
    const d = decideRetry({ status: 429, pass: 1, headers: null, body: REAL_429_BODY, alreadyRetried: false })
    assert.ok(
      d.delayMs > d.statedDelayMs,
      `wait ${d.delayMs}ms must exceed the stated ${d.statedDelayMs}ms - a shorter wait is the original bug`
    )
  }
})

check('jitter stays within +/-15% and never goes negative', () => {
  for (let i = 0; i < 500; i++) {
    const d = decideRetry({ status: 503, pass: 1, headers: null, body: null, alreadyRetried: false })
    assert.ok(d.delayMs >= 1700 && d.delayMs <= 2300, `jitter out of range: ${d.delayMs}`)
  }
})

check('two retries of the same 429 do not produce identical delays', () => {
  // Jitter exists so simultaneous submissions do not come back in
  // lockstep and re-exhaust the quota together.
  const delays = new Set()
  for (let i = 0; i < 50; i++) {
    delays.add(decideRetry({ status: 429, pass: 1, headers: null, body: REAL_429_BODY, alreadyRetried: false }).delayMs)
  }
  assert.ok(delays.size > 1, 'delays must be jittered, not constant')
})

// --- cost control ----------------------------------------------------------
check('a 429 can never cause more than one extra call per pass', () => {
  const first = decideRetry({ status: 429, pass: 1, headers: null, body: REAL_429_BODY, alreadyRetried: false })
  assert.strictEqual(first.retry, true)
  const second = decideRetry({ status: 429, pass: 1, headers: null, body: REAL_429_BODY, alreadyRetried: true })
  assert.strictEqual(second.retry, false)
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
