// lib/public/activity.js
//
// Phase 3 M6: collecting the aggregate activity counts (migration 0017).
// Minimal by design:
//   - no cookie or identifier is set on readers;
//   - the client is represented only by a keyed hash of the UTC date, its
//     address and its browser string, made with a server secret. The key
//     changes every UTC day, so it cannot link a client across days. It is
//     used (a) in activity_dedup, hashed again with the record and event,
//     and (b) as the key of its rows in submission_rate_limits. Both kinds
//     of row carry a timestamp (created / window start) and become eligible
//     for deletion after 2 days; deletion happens during later requests, in
//     bounded batches, or by the manual activity_purge_expired() (see
//     docs/public-research.md). Raw addresses and browser strings are never
//     stored or logged. It approximates repeat clients: people sharing a
//     connection can count as one, and a changing address as several;
//   - automated traffic (declared bots, link previews, prefetch/prerender,
//     requests without a browser string) is not counted: this filters the
//     obvious, it cannot detect every bot;
//   - staff are excluded by a cookie the SERVER signed when a verified staff
//     member opened the review area; a browser cannot claim to be staff or
//     supply a count;
//   - collection never blocks the research: every failure is swallowed and
//     reported as "not recorded", never as a count; and every metrics call
//     has a time budget (METRICS_BUDGET_MS), after which the caller stops
//     waiting, the database request is aborted and the result is reported
//     as "not recorded". A write that reached the database before the abort
//     may still complete, so a timed-out event can occasionally be counted;
//     it is never reported as counted.
// Plain CommonJS so it can be tested without Next.js.

const crypto = require('node:crypto')

const STAFF_COOKIE = 'sarp_staff_nocount'
const STAFF_COOKIE_SECONDS = 12 * 60 * 60
const EVENT_LIMIT = [300, 600] // events per client per 10 minutes, all records together
// Optional metrics work may delay a page, a citation or a document link by
// at most this long. 10-minute limit windows are epoch-aligned, so a UTC day
// boundary is always a window boundary: the daily key never splits a window.
const METRICS_BUDGET_MS = 400
const TIMEOUT = Symbol('timeout')

// Runs fn(signal) for at most ms. On timeout the signal aborts the pending
// HTTP request to the database and TIMEOUT is returned.
async function withDeadline(ms, fn) {
  const ac = new AbortController()
  let timer
  const timeout = new Promise((resolve) => { timer = setTimeout(() => { ac.abort(); resolve(TIMEOUT) }, ms) })
  try {
    return await Promise.race([Promise.resolve().then(() => fn(ac.signal)), timeout])
  } finally {
    clearTimeout(timer)
  }
}
// A supabase-js query builder accepts an abort signal; plain promises (test
// doubles) are left as they are.
function call(supabase, name, args, signal) {
  const q = supabase.rpc(name, args)
  return q && typeof q.abortSignal === 'function' ? q.abortSignal(signal) : q
}
function utcDay(now = Date.now()) {
  return new Date(now).toISOString().slice(0, 10)
}

function secretOf(env = process.env) {
  return env.SUBMISSION_TOKEN_SECRET || env.SUPABASE_SERVICE_ROLE_KEY || ''
}

// Declared crawlers, link-preview fetchers, headless and scripted clients.
const AUTOMATED = /bot|crawl|spider|slurp|preview|facebookexternalhit|whatsapp|telegram|slack|discord|embedly|skype|headless|lighthouse|pagespeed|curl|wget|python|node-fetch|undici|axios|go-http|java\/|okhttp|libwww|httpclient|scrapy|phantom|puppeteer|playwright|selenium|monitor|uptime|validator|feedfetcher|archiver/i

function get(headers, name) {
  if (!headers) return ''
  if (typeof headers.get === 'function') return headers.get(name) || ''
  return headers[name] || headers[name.toLowerCase()] || ''
}

// Why a request must not be counted, or null.
function automatedReason(headers) {
  const ua = get(headers, 'user-agent')
  if (!ua) return 'no_user_agent'
  if (AUTOMATED.test(ua)) return 'automated_agent'
  const purpose = `${get(headers, 'purpose')} ${get(headers, 'sec-purpose')} ${get(headers, 'x-purpose')} ${get(headers, 'x-moz')}`.toLowerCase()
  if (/prefetch|prerender|preview/.test(purpose)) return 'prefetch'
  if (get(headers, 'next-router-prefetch')) return 'prefetch'
  return null
}

// A per-UTC-day key for one client: the same address and browser string
// give the same key within a day and an unrelated key the next day.
function clientHash(env, clientKey, headers, now = Date.now()) {
  return crypto.createHmac('sha256', `activity:${secretOf(env)}`)
    .update(`${utcDay(now)}\n${clientKey || 'unknown'}\n${get(headers, 'user-agent')}`).digest('hex')
}

// "v1.<expiry>.<hmac>": a signed marker that says only "a verified staff
// member's browser, until <expiry>". It carries no user id or role, and it
// grants nothing: the review API authorizes by bearer token only and never
// reads cookies. Its only effect is that this browser's activity is not
// counted. Valid only if this server made it and it has not expired.
function staffMac(env, exp) {
  return crypto.createHmac('sha256', `staff-exclusion:${secretOf(env)}`).update(`v1.${exp}`).digest('hex')
}
function signStaffCookie(env, now = Date.now()) {
  const exp = Math.floor(now / 1000) + STAFF_COOKIE_SECONDS
  return `v1.${exp}.${staffMac(env, exp)}`
}
function verifyStaffCookie(env, value, now = Date.now()) {
  const m = /^v1\.(\d{9,11})\.([0-9a-f]{64})$/.exec(String(value || ''))
  if (!m || !secretOf(env)) return false
  if (Number(m[1]) * 1000 < now) return false
  const want = Buffer.from(staffMac(env, m[1]), 'hex')
  const got = Buffer.from(m[2], 'hex')
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}
function staffCookieHeader(env, secure) {
  return `${STAFF_COOKIE}=${signStaffCookie(env)}; Path=/; Max-Age=${STAFF_COOKIE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
}
function cookieValue(headers, name) {
  const raw = get(headers, 'cookie')
  for (const part of raw.split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

// -> 'counted' | 'duplicate' | 'not_eligible' | 'skipped:<reason>' | 'not_recorded'
// Never throws, and never takes longer than budgetMs.
async function recordEvent({ supabase, publicId, event, headers, clientKey, env = process.env, log = console, budgetMs = METRICS_BUDGET_MS, now = Date.now() }) {
  try {
    const why = automatedReason(headers)
    if (why) return `skipped:${why}`
    if (verifyStaffCookie(env, cookieValue(headers, STAFF_COOKIE))) return 'skipped:staff'
    if (!secretOf(env)) return 'not_recorded'
    const client = clientHash(env, clientKey, headers, now)
    const result = await withDeadline(budgetMs, async (signal) => {
      const lim = await call(supabase, 'consume_submission_rate_limit', { p_key: `activity:${client.slice(0, 32)}`, p_limit: EVENT_LIMIT[0], p_window_seconds: EVENT_LIMIT[1] }, signal)
      if (lim.error) return 'not_recorded'
      if (lim.data !== true) return 'skipped:rate_limited'
      const { data, error } = await call(supabase, 'public_record_event', { p_public_id: publicId, p_event: event, p_client: client }, signal)
      return error || typeof data !== 'string' ? 'not_recorded' : data
    })
    if (result === TIMEOUT) {
      log.error(JSON.stringify({ stage: 'activity_timed_out', event }))
      return 'not_recorded'
    }
    if (result === 'not_recorded') log.error(JSON.stringify({ stage: 'activity_not_recorded', event }))
    return result
  } catch {
    return 'not_recorded'
  }
}

// { data } or { error: true }, within budgetMs.
async function getActivity(supabase, publicId, budgetMs = METRICS_BUDGET_MS) {
  try {
    const r = await withDeadline(budgetMs, (signal) => call(supabase, 'public_activity', { p_public_id: publicId }, signal))
    if (r === TIMEOUT || !r || r.error) return { error: true }
    return { data: r.data }
  } catch {
    return { error: true }
  }
}

module.exports = {
  STAFF_COOKIE, STAFF_COOKIE_SECONDS, EVENT_LIMIT, METRICS_BUDGET_MS, withDeadline, utcDay, automatedReason, clientHash,
  signStaffCookie, verifyStaffCookie, staffCookieHeader, cookieValue, recordEvent, getActivity,
}
