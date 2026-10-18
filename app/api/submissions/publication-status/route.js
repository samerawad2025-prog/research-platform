import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { adminOrNull } from '../../../../lib/submission/routeHelpers'
import { handlePublicationStatus } from '../../../../lib/submission/publicationStatus'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const body = await request.json().catch(() => null)
  const result = await handlePublicationStatus({ body, supabase: adminOrNull(getSupabaseAdmin) })
  return Response.json(result.body, {
    status: result.status,
    headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Robots-Tag': 'noindex, nofollow' },
  })
}
