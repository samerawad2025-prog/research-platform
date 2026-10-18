// Read-only status for a private confirmation credential. Never accepts a
// paper id, exposes reviewer details, or creates/changes an approval.
const crypto = require('node:crypto')
const { isPublicEnabled, PUBLIC_ID, getRecord, recordUrl } = require('../public/server')

async function handlePublicationStatus({ body, supabase, env = process.env }) {
  const reply = (status, data) => ({ status, body: data })
  if (!body || Array.isArray(body) || typeof body !== 'object' ||
      Object.keys(body).length !== 1 || typeof body.token !== 'string' ||
      !/^[0-9a-f]{64}$/.test(body.token)) {
    return reply(400, { reason: 'invalid_request' })
  }
  if (!supabase) return reply(503, { reason: 'unavailable' })
  try {
    const hash = crypto.createHash('sha256').update(body.token).digest('hex')
    const paper = await supabase.from('papers').select('id,metadata_confirmed_at')
      .eq('confirmation_token_hash', hash).maybeSingle()
    if (paper.error) return reply(503, { reason: 'unavailable' })
    if (!paper.data) return reply(404, { reason: 'not_found' })
    const notPublic = () => reply(200, { state: 'not_public', publicUrl: null })
    if (!paper.data.metadata_confirmed_at || !isPublicEnabled(env)) return notPublic()
    const link = await supabase.from('public_records').select('public_id')
      .eq('paper_id', paper.data.id).maybeSingle()
    if (link.error) return reply(503, { reason: 'unavailable' })
    if (!link.data) return notPublic()
    const id = link.data.public_id
    if (!PUBLIC_ID.test(id)) return reply(503, { reason: 'unavailable' })
    // Recheck the existing public rule on every lookup. An old identifier
    // is never evidence of current publication.
    const record = await getRecord(supabase, id)
    if (record.error) return reply(503, { reason: 'unavailable' })
    if (!record.data) return notPublic()
    return reply(200, { state: 'published', publicUrl: recordUrl(id, env) || `/research/${id}` })
  } catch {
    return reply(503, { reason: 'unavailable' })
  }
}
module.exports = { handlePublicationStatus }
