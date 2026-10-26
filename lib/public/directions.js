const { createHash } = require('node:crypto')
const { PUBLIC_ID, getRecord } = require('./server')
const fields = ['title', 'title_ar', 'abstract', 'abstract_ar']
const norm = s => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
function sourceHash(record) {
  return createHash('sha256').update(JSON.stringify(fields.map(k => record[k] || ''))).digest('hex')
}
function validCard(card) {
  if (!card || card.reviewed !== true || !/^[a-z0-9-]{3,80}$/.test(card.id || '') ||
      !/^\d{4}-\d{2}-\d{2}$/.test(card.reviewedAt || '') || !Number.isFinite(Date.parse(card.reviewedAt)) ||
      !Array.isArray(card.evidence) || card.evidence.length < 1 || card.evidence.length > 6) return false
  for (const locale of ['en','ar']) for (const key of ['question','opportunity','method','constraints','supervisor']) {
    if (typeof card[locale]?.[key] !== 'string' || !card[locale][key].trim() || card[locale][key].length > 2000) return false
  }
  if (new Date(card.reviewedAt).toISOString().slice(0,10) !== card.reviewedAt) return false
  return card.evidence.every(e => e && PUBLIC_ID.test(e.publicId || '') &&
    ['abstract','abstract_ar'].includes(e.field) && ['finding','method','stated_limitation'].includes(e.kind) &&
    /^[0-9a-f]{64}$/.test(e.sourceHash || '') && typeof e.quote === 'string' && norm(e.quote).length >= 8 && e.quote.length <= 1200)
}
// Human-curated pilot, no provider calls. Recheck public eligibility and the
// reviewed source on every request; no cross-request cache or stale fallback.
async function loadDirections(sb, definitions = []) {
  const records = new Map(), cards = [], ids = new Set()
  let unavailable = false
  async function record(id) {
    if (!records.has(id)) records.set(id, getRecord(sb,id))
    return records.get(id)
  }
  for (const definition of (Array.isArray(definitions) ? definitions : []).slice(0,8)) {
    if (!validCard(definition) || ids.has(definition.id)) continue
    ids.add(definition.id)
    const evidence = []
    let valid = true
    for (const e of definition.evidence) {
      const r = await record(e.publicId)
      if (r.error) unavailable = true
      if (r.error || !r.data || sourceHash(r.data) !== e.sourceHash || !norm(r.data[e.field]).includes(norm(e.quote))) { valid = false; break }
      evidence.push({ publicId:e.publicId, field:e.field, kind:e.kind, quote:e.quote,
        title:r.data.title, title_ar:r.data.title_ar })
    }
    if (valid) cards.push({ id:definition.id, reviewedAt:definition.reviewedAt, en:definition.en, ar:definition.ar,
      evidence, sourceCount:new Set(evidence.map(e=>e.publicId)).size })
  }
  return { cards, unavailable }
}
module.exports = { sourceHash, validCard, loadDirections }
