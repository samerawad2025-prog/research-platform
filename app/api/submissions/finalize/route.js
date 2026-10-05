// app/api/submissions/finalize/route.js
//
// Phase 3 M2A. Off unless SUBMISSION_ACCEPTANCE_FLOW=enabled. Rules and
// tests: lib/submission/acceptanceHandlers.js. The response can carry a
// one-time credential for the submitter, so it is never cached and never
// logged.

import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { handleFinalize } from '../../../../lib/submission/acceptanceHandlers'
import { clientKeyOf, adminOrNull } from '../../../../lib/submission/routeHelpers'

export const dynamic = 'force-dynamic'

export async function POST(request) {
  const body = await request.json().catch(() => null)
  const supabase = adminOrNull(getSupabaseAdmin)
  if (!supabase) return Response.json({ error: 'Not available.', reason: 'not_available' }, { status: 404 })
  const { status, body: out } = await handleFinalize({
    body,
    supabase,
    storage: supabase.storage.from('papers'),
    clientKey: clientKeyOf(request),
  })
  return Response.json(out, { status, headers: { 'Cache-Control': 'no-store' } })
}
