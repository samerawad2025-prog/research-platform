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
const { decideRetry, parseRetryDelayMs, MAX_RETRY_DELAY_MS, MAX_OVERLOAD_ATTEMPTS } = require('../lib/ai/retryPolicy')

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

// The literal free-tier 429 that failed a good Arabic DOCX in
// production on 2026-09-20, stated delay and all.
const REAL_FREE_TIER_429_BODY = {
  error: {
    code: 429,
    status: 'RESOURCE_EXHAUSTED',
    message:
      'You exceeded your current quota, please check your plan and billing details. ' +
      '\\n* Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, ' +
      'limit: 20, model: gemini-3.6-flash\\nPlease retry in 35.260544627s.',
  },
}

check('THE REGRESSION: a 35.26s per-minute quota wait is honoured, not refused', () => {
  // The cap was 30s, so this was refused by 5.26 seconds and the
  // submission failed outright - even though the per-minute window
  // resets inside a minute.
  assert.strictEqual(parseRetryDelayMs({ headers: null, body: REAL_FREE_TIER_429_BODY }), 35261)
  const d = decideRetry({ status: 429, pass: 1, body: REAL_FREE_TIER_429_BODY, attempt: 1 })
  assert.strictEqual(d.retry, true, 'a per-minute quota wait must be honoured')
  assert.ok(d.delayMs > 35261, 'and must still clear the stated window')
})

check('the cap still covers any per-minute reset with margin', () => {
  assert.ok(MAX_RETRY_DELAY_MS >= 60_000, 'a per-minute window can state up to ~60s')
})

check('an hours-long quota delay fails fast instead of hanging the function', () => {
  const body = { error: { details: [{ '@type': 'x/RetryInfo', retryDelay: '3600s' }] } }
  const d = decideRetry({ status: 429, pass: 1, headers: null, body, alreadyRetried: false })
  assert.strictEqual(d.retry, false)
  assert.strictEqual(d.reason, 'quota_delay_too_long')
  assert.strictEqual(d.statedDelayMs, 3600000)
})

// The literal 503 body Google returned on 2026-09-20, twice, on two
// real submissions that were then told their documents were unreadable.
const REAL_503_BODY = {
  error: {
    code: 503,
    status: 'UNAVAILABLE',
    message: 'This model is currently experiencing high demand. Spikes in demand are usually temporary. Please try again later.',
  },
}

check('503 retries quickly on the first failure - the call cost nothing', () => {
  const d = decideRetry({ status: 503, pass: 1, headers: null, body: REAL_503_BODY, attempt: 1 })
  assert.strictEqual(d.retry, true)
  assert.ok(d.delayMs > 0 && d.delayMs < 4000, `expected a short first backoff, got ${d.delayMs}`)
})

check('THE REGRESSION: a 503 gets more than one retry, and the waits escalate', () => {
  // Production, 2026-09-20: attempt 1 -> 503, ~2s wait, attempt 2 ->
  // 503, give up. Under ten seconds total. A demand spike lasts minutes,
  // so one short retry could never clear it.
  const first = decideRetry({ status: 503, pass: 1, body: REAL_503_BODY, attempt: 1 })
  const second = decideRetry({ status: 503, pass: 1, body: REAL_503_BODY, attempt: 2 })
  assert.strictEqual(first.retry, true)
  assert.strictEqual(second.retry, true, 'a second retry is what actually rides out a spike')
  assert.ok(
    second.delayMs > first.delayMs,
    `waits must escalate: got ${first.delayMs}ms then ${second.delayMs}ms`
  )
})

check('the 503 ladder is bounded - it cannot loop forever', () => {
  const exhausted = decideRetry({ status: 503, pass: 1, body: REAL_503_BODY, attempt: MAX_OVERLOAD_ATTEMPTS })
  assert.strictEqual(exhausted.retry, false)
  assert.strictEqual(exhausted.reason, 'overloaded_attempts_exhausted')
})

check('the whole 503 ladder stays well inside the function time budget', () => {
  let total = 0
  for (let a = 1; a < MAX_OVERLOAD_ATTEMPTS; a++) {
    total += decideRetry({ status: 503, pass: 1, body: REAL_503_BODY, attempt: a }).delayMs
  }
  assert.ok(total < 30_000, `total backoff ${total}ms must stay far below the 300s ceiling`)
})

check('a 429 still gets only ONE retry - unlike 503, it spends quota', () => {
  const second = decideRetry({ status: 429, pass: 1, body: REAL_429_BODY, attempt: 2 })
  assert.strictEqual(second.retry, false)
  assert.strictEqual(second.reason, 'already_retried')
})

check('503 retries on pass 2 as well - unlike 429, it spends no quota', () => {
  const d = decideRetry({ status: 503, pass: 2, headers: null, body: null, attempt: 1 })
  assert.strictEqual(d.retry, true)
})

check('the old boolean spelling still works', () => {
  // alreadyRetried is kept as a synonym for attempt >= 2 so older
  // callers cannot silently start retrying forever.
  assert.strictEqual(decideRetry({ status: 429, pass: 1, body: REAL_429_BODY, alreadyRetried: true }).retry, false)
  assert.strictEqual(decideRetry({ status: 429, pass: 1, body: REAL_429_BODY, alreadyRetried: false }).retry, true)
})

check('a network error retries', () => {
  const d = decideRetry({ status: null, pass: 1, headers: null, body: null, alreadyRetried: false })
  assert.strictEqual(d.retry, true)
  assert.strictEqual(d.reason, 'network_error')
})

check('every failure class has a bounded budget - none can loop', () => {
  // 503 has a ladder (it costs nothing and a spike needs riding out);
  // everything else gets exactly one retry. Both are bounded, which is
  // the property that matters.
  assert.strictEqual(
    decideRetry({ status: 503, pass: 1, body: null, attempt: MAX_OVERLOAD_ATTEMPTS }).retry,
    false,
    '503 must stop once its ladder is spent'
  )
  assert.strictEqual(
    decideRetry({ status: null, pass: 1, body: null, attempt: 2 }).retry,
    false,
    'a network error gets one retry only'
  )
  assert.strictEqual(
    decideRetry({ status: 429, pass: 1, body: REAL_429_BODY, attempt: 2 }).retry,
    false,
    'a 429 gets one retry only - it spends quota'
  )
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
