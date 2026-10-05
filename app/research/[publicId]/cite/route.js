import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { clientKeyOf, adminOrNull } from '../../../../lib/submission/routeHelpers'
import { handleCite } from '../../../../lib/public/cite'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

async function run(request, { params }) {
  const { publicId } = await params
  const supabase = adminOrNull(getSupabaseAdmin)
  if (!supabase) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const r = await handleCite({ method: request.method, publicId, format: new URL(request.url).searchParams.get('format'), supabase, headers: request.headers, clientKey: clientKeyOf(request) })
  return new Response(r.body ?? null, { status: r.status, headers: r.headers })
}
export const GET = run
export const HEAD = run
