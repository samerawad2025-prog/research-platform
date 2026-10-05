// POST /api/research/[publicId]/events — the two events only a browser can
// observe: the page stayed visible (page_view) and the citation text was
// copied successfully (citation_copy, counted as a citation export). The
// body names the event and nothing else; the server decides whether and
// what to count. -> { status, body }
const { isPublicEnabled, PUBLIC_ID } = require('./server')
const { recordEvent } = require('./activity')

const EVENTS = { page_view: 'page_view', citation_copy: 'citation_export' }

async function handleEvent({ publicId, body, headers, supabase, clientKey, env = process.env, log = console }) {
  if (!isPublicEnabled(env) || !PUBLIC_ID.test(String(publicId || ''))) return { status: 404, body: { recorded: false } }
  const site = headers?.get?.('sec-fetch-site')
  if (site && site !== 'same-origin') return { status: 403, body: { recorded: false } }
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((k) => k !== 'event') || !EVENTS[body.event]) {
    return { status: 400, body: { recorded: false } }
  }
  const result = await recordEvent({ supabase, publicId, event: EVENTS[body.event], headers, clientKey, env, log })
  if (result === 'not_eligible') return { status: 404, body: { recorded: false } }
  // "recorded" is true only when this request added one to a count.
  return { status: 202, body: { recorded: result === 'counted' } }
}

module.exports = { handleEvent, EVENTS }
