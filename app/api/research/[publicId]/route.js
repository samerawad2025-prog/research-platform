import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { adminOrNull } from '../../../../lib/submission/routeHelpers'
import { isPublicEnabled, getRecord } from '../../../../lib/public/server'

export const dynamic = 'force-dynamic'
const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

export async function GET(request, { params }) {
  if (!isPublicEnabled()) return Response.json({ error: 'Not found.' }, { status: 404, headers: H })
  const { publicId } = await params
  const sb = adminOrNull(getSupabaseAdmin)
  const r = sb ? await getRecord(sb, publicId) : { error: true }
  if (r.error) return Response.json({ error: 'Temporarily unavailable.' }, { status: 503, headers: H })
  if (!r.data) return Response.json({ error: 'Not found.' }, { status: 404, headers: H })
  return Response.json(r.data, { headers: H })
}
