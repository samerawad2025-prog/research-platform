// lib/public/server.js
//
// Phase 3 M5, the public research site: configuration and the only reads
// the public pages make. Every read goes through a database function that
// re-applies publication_eligibility() and returns an allowlist of public
// fields (migration 0016); nothing here decides eligibility itself.
// Plain CommonJS so scripts/test-public.js can load it without Next.js.


const PUBLIC_ID = /^[a-hjkmnp-z2-9]{12}$/
const SIGNED_URL_SECONDS = 60
const FILE_LIMIT = [60, 600] // requests per client per 10 minutes

function isPublicEnabled(env = process.env) {
  return String(env.PUBLIC_RESEARCH || '').trim().toLowerCase() === 'enabled'
}

// The configured site origin, or null. Permanent links (canonical URLs,
// sitemap, social previews) are built ONLY from this, never from the
// request's Host header. While no permanent domain is decided it is left
// unset: pages then carry no canonical URL, ask not to be indexed, and the
// sitemap is empty.
function siteOrigin(env = process.env) {
  const raw = String(env.PUBLIC_SITE_ORIGIN || '').trim()
  if (!raw) return null
  let u
  try { u = new URL(raw) } catch { return null }
  const local = u.hostname === '127.0.0.1' || u.hostname === 'localhost'
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null
  if (u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null
  return u.origin
}

function recordUrl(publicId, env) {
  const o = siteOrigin(env)
  return o ? `${o}/research/${publicId}` : null
}

// { data } or { error: true }. An error is never treated as "nothing
// private here": callers fail closed and show no record content.
async function rpc(supabase, name, args) {
  try {
    const { data, error } = await supabase.rpc(name, args)
    if (error) return { error: true }
    return { data }
  } catch {
    return { error: true }
  }
}

async function getRecord(supabase, publicId) {
  if (!PUBLIC_ID.test(String(publicId || ''))) return { data: null }
  return rpc(supabase, 'public_record', { p_public_id: publicId })
}

const FILTER_KEYS = ['q', 'unit', 'year', 'degree', 'type', 'page']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Search parameters from the URL, cleaned. Anything malformed is dropped
// rather than passed on.
function parseFilters(sp = {}) {
  const one = (k) => { const v = sp[k]; return Array.isArray(v) ? v[0] : v }
  const f = {}
  const q = String(one('q') || '').replace(/\s+/g, ' ').trim().slice(0, 200)
  if (q) f.q = q
  const unit = String(one('unit') || '')
  if (UUID.test(unit)) f.unit = unit.toLowerCase()
  const year = String(one('year') || '')
  if (/^\d{4}$/.test(year)) f.year = Number(year)
  const degree = String(one('degree') || '').trim().slice(0, 100)
  if (degree) f.degree = degree
  const type = String(one('type') || '')
  if (type === 'thesis' || type === 'article') f.type = type
  const page = Number(one('page'))
  if (Number.isInteger(page) && page >= 1 && page <= 10000) f.page = page
  return f
}

async function getCatalogue(supabase, filters, limit = 20) {
  const r = await rpc(supabase, 'public_catalogue', { p: { ...filters, limit } })
  if (r.error || !r.data || r.data.ok !== true) return { error: true }
  return r
}

async function getSitemap(supabase) {
  return rpc(supabase, 'public_sitemap', {})
}

function safeFilename(title, format) {
  const base = String(title || 'research').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120) || 'research'
  return `${base}.${format}`
}

// GET /research/[publicId]/file?mode=read|download
// -> { status, headers, body? }. The approved dissemination copy only: the
// storage path comes from the database, the bucket stays private, and the
// link it redirects to lasts SIGNED_URL_SECONDS. Every refusal (unknown id,
// record not public, full text not public, restriction active) is the same
// 404, so nothing about a private record can be learned from it.
async function handlePublicFile({ method = 'GET', publicId, mode, supabase, storage, headers, env = process.env, clientKey, log = console }) {
  const noStore = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex' }
  const notFound = { status: 404, headers: noStore, body: 'Not found.' }
  if (!isPublicEnabled(env)) return notFound
  if (!PUBLIC_ID.test(String(publicId || ''))) return notFound

  // Proportionate limit: a keyed hash of the address, never the address.
  // Keyed by the same per-UTC-day client hash as the activity counts, so no
  // stored limiter key links a client across days.
  const { clientHash } = require('./activity')
  const key = `public_file:${clientHash(env, clientKey, headers).slice(0, 32)}`
  const lim = await rpc(supabase, 'consume_submission_rate_limit', { p_key: key, p_limit: FILE_LIMIT[0], p_window_seconds: FILE_LIMIT[1] })
  if (lim.error) return { status: 503, headers: noStore, body: 'Temporarily unavailable.' }
  if (lim.data !== true) return { status: 429, headers: { ...noStore, 'Retry-After': '600' }, body: 'Too many requests. Please try again later.' }

  const doc = await rpc(supabase, 'public_document', { p_public_id: publicId })
  if (doc.error) return { status: 503, headers: noStore, body: 'Temporarily unavailable.' }
  if (!doc.data || !doc.data.storage_path) return notFound
  // HEAD says whether the document is available; it issues no link.
  if (method === 'HEAD') return { status: 200, headers: noStore }
  const { storage_path: path, format } = doc.data
  // A DOCX has no reliable in-browser preview: it is always a download.
  const download = mode === 'download' || format !== 'pdf'
  const opts = download ? { download: safeFilename(doc.data.title, format) } : {}
  const { data, error } = await storage.createSignedUrl(path, SIGNED_URL_SECONDS, opts)
  if (error || !data?.signedUrl) {
    log.error(JSON.stringify({ stage: 'public_file_sign_failed' }))
    return { status: 503, headers: noStore, body: 'Temporarily unavailable.' }
  }
  // Counted once the link exists; a HEAD or prefetch is never counted, and a
  // counting failure never blocks the document.
  const { recordEvent } = require('./activity')
  await recordEvent({ supabase, publicId, event: download ? 'document_download' : 'document_open', headers, clientKey, env, log })
  return { status: 303, headers: { ...noStore, Location: data.signedUrl } }
}

module.exports = {
  PUBLIC_ID, SIGNED_URL_SECONDS, FILE_LIMIT, isPublicEnabled, siteOrigin, recordUrl,
  getRecord, getCatalogue, getSitemap, parseFilters, handlePublicFile, safeFilename,
}
