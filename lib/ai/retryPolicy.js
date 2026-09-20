// lib/ai/retryPolicy.js
//
// Decides whether, and how long, to wait before retrying a Gemini call.
//
// Separated from gemini.js so the policy can be tested against the real
// error bodies Google actually returns, rather than reasoned about.
//
// The failure this exists for (BUG_HISTORY.md #29): on 2026-09-19 a 429
// said "Please retry in 12.577097057s" and the code retried after a
// fixed 1500ms. The second 429 then said "retry in 10.830900339s". The
// 1.746s difference between those two figures is the proof: the window
// was rolling, and the retry landed inside it. It could not have
// succeeded. A retry that is certain to fail is worse than no retry,
// because on a 429 it also spends more of the quota that was just
// exhausted.

// 503 means Google is overloaded. A retry is cheap: the failed call
// consumed nothing, and the condition is genuinely transient.
const OVERLOAD_BACKOFF_MS = 2000

// Never wait longer than this, whatever the server asks for. An
// exhausted DAILY quota returns a delay measured in hours; honouring it
// would hold a serverless function open until the platform kills it,
// turning a clean failure into a stuck paper.
const MAX_RETRY_DELAY_MS = 30_000

// Google states the delay three different ways depending on the error
// path. Checked in order of reliability, most authoritative first.
//
// 1. The standard HTTP header.
// 2. RetryInfo in the structured error details (the documented shape).
// 3. The human-readable message text, which is where the real 429 we
//    saw in production actually carried it.
function parseRetryDelayMs({ headers, body }) {
  const fromHeader = parseRetryAfterHeader(headers)
  if (fromHeader !== null) return fromHeader

  const fromDetails = parseRetryInfo(body)
  if (fromDetails !== null) return fromDetails

  return parseDelayFromMessage(body)
}

function parseRetryAfterHeader(headers) {
  // `headers` may be a real Headers object or a plain object in tests.
  const raw = typeof headers?.get === 'function' ? headers.get('retry-after') : headers?.['retry-after']
  if (!raw) return null

  // Retry-After is either delta-seconds or an HTTP date.
  const seconds = Number(String(raw).trim())
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000)

  const when = Date.parse(String(raw))
  if (Number.isFinite(when)) return Math.max(0, when - Date.now())

  return null
}

// { error: { details: [ { "@type": ".../RetryInfo", retryDelay: "12.5s" } ] } }
function parseRetryInfo(body) {
  const details = body?.error?.details
  if (!Array.isArray(details)) return null

  for (const detail of details) {
    const delay = detail?.retryDelay
    if (typeof delay !== 'string') continue
    // Protobuf Duration: a decimal number of seconds with an "s" suffix.
    const match = delay.match(/^([\d.]+)s$/)
    if (match) {
      const ms = Math.round(Number(match[1]) * 1000)
      if (Number.isFinite(ms)) return ms
    }
  }
  return null
}

// "Please retry in 12.577097057s." — the form the real production 429
// used. Deliberately last: it is prose and could change wording, but
// discarding it would have discarded the only delay we actually had.
function parseDelayFromMessage(body) {
  const message = body?.error?.message
  if (typeof message !== 'string') return null

  const match = message.match(/retry in ([\d.]+)\s*s/i)
  if (!match) return null

  const ms = Math.round(Number(match[1]) * 1000)
  return Number.isFinite(ms) ? ms : null
}

// The whole policy, in one decision.
//
// `pass` matters: on pass 2 a failure is NOT fatal. Pass 1's result is
// already in hand and the run degrades to 'partial' (BUG_HISTORY.md
// #10). Spending more of an exhausted quota, and up to 30 more seconds
// of the person's time, to improve an outcome that is already usable is
// the wrong trade. On pass 1 there is nothing to fall back to, so the
// retry is worth it.
function decideRetry({ status, pass, headers, body, alreadyRetried }) {
  if (alreadyRetried) {
    return { retry: false, reason: 'already_retried' }
  }

  if (status === 503) {
    return {
      retry: true,
      // Jitter spreads retries when several submissions hit the same
      // overload at once, so they don't all come back in lockstep.
      delayMs: withJitter(OVERLOAD_BACKOFF_MS),
      reason: 'overloaded',
    }
  }

  if (status === 429) {
    if (pass === 2) {
      return { retry: false, reason: 'quota_exhausted_pass2_degrades_to_partial' }
    }

    const stated = parseRetryDelayMs({ headers, body })

    if (stated === null) {
      // No delay given. Retrying blind against a quota limit is the
      // exact mistake this module exists to stop.
      return { retry: false, reason: 'quota_exhausted_no_delay_given' }
    }

    if (stated > MAX_RETRY_DELAY_MS) {
      // A delay this long means a quota window measured in hours, not
      // a momentary burst. Fail cleanly instead of holding the
      // function open until the platform kills it.
      return { retry: false, reason: 'quota_delay_too_long', statedDelayMs: stated }
    }

    return {
      retry: true,
      // A margin past the stated time, and jittered UPWARDS ONLY.
      //
      // Symmetric jitter is wrong here and was caught by the test: on a
      // 12.577s stated delay it produced a 12.029s wait, landing back
      // inside the very window this exists to clear. The window is also
      // rolling - the two production 429s drifted 1.746s apart - so the
      // wait may only ever be longer than stated, never shorter.
      delayMs: stated + 500 + upwardJitter(stated),
      reason: 'quota_honouring_server_delay',
      statedDelayMs: stated,
    }
  }

  // Network-level failures: transient by nature, cheap to retry.
  if (status === null || status === undefined) {
    return { retry: true, delayMs: withJitter(OVERLOAD_BACKOFF_MS), reason: 'network_error' }
  }

  return { retry: false, reason: `not_retryable_status_${status}` }
}

// +/-15%, never negative. For delays we chose ourselves, where landing
// slightly early costs nothing.
function withJitter(ms) {
  const spread = ms * 0.15
  return Math.max(0, Math.round(ms + (Math.random() * 2 - 1) * spread))
}

// 0..15% added, never subtracted. For a delay the SERVER stated, where
// landing early is the whole failure being fixed.
function upwardJitter(ms) {
  return Math.round(Math.random() * ms * 0.15)
}

module.exports = {
  decideRetry,
  parseRetryDelayMs,
  OVERLOAD_BACKOFF_MS,
  MAX_RETRY_DELAY_MS,
}
