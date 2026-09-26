// app/api/manual-entry/route.js
//
// Records that the researcher chose to enter their details themselves
// (Phase 3 M1). Server-only, authorized by the confirmation token, like
// /api/extract. The rule lives in lib/extraction/extractHandler.js
// (handleManualChoice), where it is tested.

import { getSupabaseAdmin } from '../../../lib/supabaseAdminClient'
import { handleManualChoice } from '../../../lib/extraction/extractHandler'

export async function POST(request) {
  const { token } = await request.json().catch(() => ({}))
  const { status, body } = await handleManualChoice({ token, getSupabaseAdmin })
  return Response.json(body, { status })
}
