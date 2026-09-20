// app/api/timing/route.js
//
// Receives the browser's stage timings and writes them to the function
// log, so client-observed time and server-observed time finally appear
// in the same place and can be compared directly.
//
// This route deliberately stores nothing. It takes no credential, so it
// must never be able to write to the database or read anything back —
// its whole job is to turn a measurement into a log line. The token
// arrives already truncated to 8 characters by lib/timing.js; it is
// re-truncated here anyway, because a client is not a trustworthy place
// to enforce that.

export const runtime = 'nodejs'

// Bounded so a malformed or hostile body cannot produce an unbounded
// log line. These limits are generous next to a real payload (8 stages).
const MAX_STAGES = 40
const MAX_KEY_LEN = 80

function clampNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : null
}

function clampStages(stages) {
  if (!stages || typeof stages !== 'object') return {}
  const out = {}
  for (const [key, value] of Object.entries(stages).slice(0, MAX_STAGES)) {
    const ms = clampNumber(value)
    if (ms !== null) out[String(key).slice(0, MAX_KEY_LEN)] = ms
  }
  return out
}

function clampList(list) {
  return Array.isArray(list) ? list.slice(0, MAX_STAGES).map((s) => String(s).slice(0, MAX_KEY_LEN)) : []
}

export async function POST(request) {
  const body = await request.json().catch(() => null)

  if (!body || typeof body !== 'object') {
    return Response.json({ ok: false }, { status: 400 })
  }

  console.log(
    JSON.stringify({
      stage: 'client_timing',
      token_prefix: String(body.token_prefix ?? '').slice(0, 8),
      total_ms: clampNumber(body.total_ms),
      stages: clampStages(body.stages),
      reached: clampList(body.reached),
      missing: clampList(body.missing),
      file_bytes: clampNumber(body.meta?.file_bytes),
      poll_attempts: clampNumber(body.meta?.poll_attempts),
      extraction_status: String(body.meta?.extraction_status ?? '').slice(0, 20) || null,
      triggered_by: String(body.meta?.triggered_by ?? '').slice(0, 20) || null,
    })
  )

  // 204: the browser has nothing to do with the response, and sending
  // no body keeps this as cheap as it can be on a metered plan.
  return new Response(null, { status: 204 })
}
