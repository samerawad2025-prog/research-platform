// lib/public/activity.js
//
// Phase 3 M6: collecting the aggregate activity counts (migration 0017).
// Minimal by design:
//   - no cookie or identifier is set on readers;
//   - the client is represented only by a keyed hash of its address and
//     browser string, made with a server secret, passed to the database for
//     one-per-day deduplication, and deleted there within 2 days;
//   - automated traffic (declared bots, link previews, prefetch/prerender,
//     requests without a browser string) is not counted: this filters the
//     obvious, it cannot detect every bot;
//   - staff are excluded by a cookie the SERVER signed when a verified staff
//     member opened the review area; a browser cannot claim to be staff or
//     supply a count;
//   - collection never blocks the research: every failure is swallowed and
//     reported as "not recorded", never as a count.
// Plain CommonJS so it can be tested without Next.js.

const crypto = require('node:crypto')

const STAFF_COOKIE = 'sarp_staff_nocount'
const STAFF_COOKIE_SECONDS = 12 * 60 * 60
const EVENT_LIMIT = [300, 600] // events per client per 10 minutes, all records together

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

function clientHash(env, clientKey, headers) {
  return crypto.createHmac('sha256', `activity:${secretOf(env)}`)
    .update(`${clientKey || 'unknown'}\n${get(headers, 'user-agent')}`).digest('hex')
}

// "<expiry>.<hmac>" — no user id in it; valid only if this server made it.
function signStaffCookie(env, userId, now = Date.now()) {
  const exp = Math.floor(now / 1000) + STAFF_COOKIE_SECONDS
  const mac = crypto.createHmac('sha256', `staff:${secretOf(env)}`).update(`${userId}.${exp}`).digest('hex')
  return `${exp}.${Buffer.from(userId).toString('base64url')}.${mac}`
}
function verifyStaffCookie(env, value, now = Date.now()) {
  const m = /^(\d{9,11})\.([A-Za-z0-9_-]{1,64})\.([0-9a-f]{64})$/.exec(String(value || ''))
  if (!m || !secretOf(env)) return false
  if (Number(m[1]) * 1000 < now) return false
  const userId = Buffer.from(m[2], 'base64url').toString()
  const want = crypto.createHmac('sha256', `staff:${secretOf(env)}`).update(`${userId}.${m[1]}`).digest()
  const got = Buffer.from(m[3], 'hex')
  return got.length === want.length && crypto.timingSafeEqual(got, want)
}
function staffCookieHeader(env, userId, secure) {
  return `${STAFF_COOKIE}=${signStaffCookie(env, userId)}; Path=/; Max-Age=${STAFF_COOKIE_SECONDS}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`
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
// Never throws.
async function recordEvent({ supabase, publicId, event, headers, clientKey, env = process.env, log = console }) {
  try {
    const why = automatedReason(headers)
    if (why) return `skipped:${why}`
    if (verifyStaffCookie(env, cookieValue(headers, STAFF_COOKIE))) return 'skipped:staff'
    if (!secretOf(env)) return 'not_recorded'
    const client = clientHash(env, clientKey, headers)
    const lim = await supabase.rpc('consume_submission_rate_limit', { p_key: `activity:${client.slice(0, 32)}`, p_limit: EVENT_LIMIT[0], p_window_seconds: EVENT_LIMIT[1] })
    if (lim.error) return 'not_recorded'
    if (lim.data !== true) return 'skipped:rate_limited'
    const { data, error } = await supabase.rpc('public_record_event', { p_public_id: publicId, p_event: event, p_client: client })
    if (error || typeof data !== 'string') {
      log.error(JSON.stringify({ stage: 'activity_not_recorded', event }))
      return 'not_recorded'
    }
    return data
  } catch {
    return 'not_recorded'
  }
}

async function getActivity(supabase, publicId) {
  try {
    const { data, error } = await supabase.rpc('public_activity', { p_public_id: publicId })
    return error ? { error: true } : { data }
  } catch {
    return { error: true }
  }
}

module.exports = {
  STAFF_COOKIE, STAFF_COOKIE_SECONDS, EVENT_LIMIT, automatedReason, clientHash,
  signStaffCookie, verifyStaffCookie, staffCookieHeader, cookieValue, recordEvent, getActivity,
}
