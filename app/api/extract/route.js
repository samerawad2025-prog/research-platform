// app/api/extract/route.js
//
// Server-only. Called by the browser right after a successful
// submission, and by the confirmation page's own safety net and retry,
// passing the confirmation token (never the paper's raw id as an auth
// mechanism). The rules - extraction mode, preview guard, claim
// compare-and-swap, retries, how results are applied - all live in
// lib/extraction/extractHandler.js, where they are tested directly.

import { getSupabaseAdmin } from '../../../lib/supabaseAdminClient'
import { runExtraction } from '../../../lib/extraction/orchestrator'
import { getProvider } from '../../../lib/ai'
import { handleExtract } from '../../../lib/extraction/extractHandler'

// Without this, the platform's own default function timeout (well under
// GEMINI_TIMEOUT_MS x up to 2 calls x up to 2 attempts each) can kill this
// route mid-extraction. papers.extraction_status is already 'processing'
// by then, so a kill leaves it stuck there forever with no failure_code
// and no ai_generations row. 300s is a judgment call, not a confirmed
// plan limit - verify against whichever Vercel project actually serves
// production (see docs/deployment.md, three projects are linked).
//
// STALE_CLAIM_MS in extractHandler.js must stay strictly greater than
// this (scripts/test-timing.js checks it).
export const maxDuration = 300

export async function POST(request) {
  const { token } = await request.json().catch(() => ({}))
  const { status, body } = await handleExtract({ token, getSupabaseAdmin, getProvider, runExtraction })
  return Response.json(body, { status })
}
