// app/api/submissions/terms/route.js
//
// Phase 3 M2A. What may be accepted right now, and the processing behaviour
// a new submission would get. Off unless SUBMISSION_ACCEPTANCE_FLOW=enabled.
// Rules and tests: lib/submission/acceptanceHandlers.js.

import { getSupabaseAdmin } from '../../../../lib/supabaseAdminClient'
import { handleTerms } from '../../../../lib/submission/acceptanceHandlers'
import { clientKeyOf, adminOrNull } from '../../../../lib/submission/routeHelpers'

export const dynamic = 'force-dynamic'

export async function GET(request) {
  const supabase = adminOrNull(getSupabaseAdmin)
  if (!supabase) return Response.json({ error: 'Not available.', reason: 'not_available' }, { status: 404 })
  const { status, body } = await handleTerms({ supabase, clientKey: clientKeyOf(request) })
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } })
}
