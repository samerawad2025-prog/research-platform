import { getSupabaseAdmin } from '../../../../../lib/supabaseAdminClient'
import { clientKeyOf, adminOrNull } from '../../../../../lib/submission/routeHelpers'
import { handleEvent } from '../../../../../lib/public/events'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'
const H = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }

export async function POST(request, { params }) {
  const { publicId } = await params
  const supabase = adminOrNull(getSupabaseAdmin)
  if (!supabase) return Response.json({ recorded: false }, { status: 503, headers: H })
  let body = null
  try { body = JSON.parse((await request.text()).slice(0, 200)) } catch { body = null }
  const r = await handleEvent({ publicId, body, headers: request.headers, supabase, clientKey: clientKeyOf(request) })
  return Response.json(r.body, { status: r.status, headers: H })
}
