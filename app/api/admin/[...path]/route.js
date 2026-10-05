// app/api/admin/[...path]/route.js
//
// Phase 3 M4: the administrative review API. One entry point; the rules
// (authentication with Supabase Auth, authorization in the database, strict
// input, no fallback) are in lib/admin/handlers.js and docs/admin-review.md.
// Off unless ADMIN_REVIEW=enabled. Every response is uncached: it carries
// private research metadata, and for a file request a short-lived link.

import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { handleAdmin } from '../../../../lib/admin/handlers'
import { staffCookieHeader } from '../../../../lib/public/activity'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

function bearer(request) {
  const h = request.headers.get('authorization') || ''
  const m = /^Bearer\s+(\S+)$/i.exec(h)
  return m ? m[1] : null
}

async function run(request, context) {
  const { path } = await context.params
  let supabase = null
  try {
    supabase = getSupabaseAdmin()
  } catch {
    supabase = null
  }
  let body = null
  let bodyError = false
  if (request.method !== 'GET') {
    const text = await request.text().catch(() => '')
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        bodyError = true
      }
    }
  }
  const query = Object.fromEntries(new URL(request.url).searchParams.entries())
  if (!supabase) {
    return Response.json({ error: 'Not available.', reason: 'not_available' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  }
  const { status, body: out } = await handleAdmin({
    method: request.method, segments: path || [], query, body, bodyError, token: bearer(request),
    supabase, storage: supabase.storage.from('papers'),
  })
  const headers = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' }
  if (status === 200 && out?.exclude === true) {
    headers['Set-Cookie'] = staffCookieHeader(process.env, new URL(request.url).protocol === 'https:')
    return Response.json({ ok: true }, { status, headers })
  }
  return Response.json(out, { status, headers })
}

export const GET = run
export const POST = run
