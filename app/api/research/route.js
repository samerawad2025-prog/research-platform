// Public JSON: the same catalogue the /research page shows, from the same
// database function (public records only, allowlisted fields).
import { getSupabaseAdmin } from '../../../lib/supabaseAdminClient'
import { adminOrNull } from '../../../lib/submission/routeHelpers'
import { isPublicEnabled, parseFilters, getCatalogue } from '../../../lib/public/server'

export const dynamic = 'force-dynamic'
const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

export async function GET(request) {
  if (!isPublicEnabled()) return Response.json({ error: 'Not found.' }, { status: 404, headers: H })
  const sb = adminOrNull(getSupabaseAdmin)
  const filters = parseFilters(Object.fromEntries(new URL(request.url).searchParams))
  const r = sb ? await getCatalogue(sb, filters) : { error: true }
  if (r.error) return Response.json({ error: 'Temporarily unavailable.' }, { status: 503, headers: H })
  const { ok, ...body } = r.data
  return Response.json(body, { headers: H })
}
