// The approved dissemination copy of a public full-text record: rechecked
// on every request, then a 60-second signed link to the private object.
import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { clientKeyOf, adminOrNull } from '../../../../lib/submission/routeHelpers'
import { handlePublicFile } from '../../../../lib/public/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(request, { params }) {
  const { publicId } = await params
  const supabase = adminOrNull(getSupabaseAdmin)
  if (!supabase) return new Response('Not found.', { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const mode = new URL(request.url).searchParams.get('mode')
  const r = await handlePublicFile({ publicId, mode, supabase, storage: supabase.storage.from('papers'), clientKey: clientKeyOf(request) })
  return new Response(r.body ?? null, { status: r.status, headers: r.headers })
}
