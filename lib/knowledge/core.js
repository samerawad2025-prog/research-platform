const { createHash } = require('node:crypto')
const { PUBLIC_ID, isPublicEnabled } = require('../public/server')
const { authenticate } = require('../admin/handlers')
const { clientHash } = require('../public/activity')

const enabled = (env) => env.RESEARCH_KNOWLEDGE === 'enabled'
const reply = (status, body) => ({ status, body })
const norm = (s) => String(s || '').normalize('NFKC').replace(/\s+/g, ' ').trim()
function sources(context) {
  return ['abstract', 'abstract_ar'].filter(k => context?.source?.[k]).map(k => ({
    id: k, text: context.source[k], anchor: k === 'abstract' ? 'abstract-en' : 'abstract-ar',
  }))
}
function evidenceValid(claim, context) {
  if (!claim || typeof claim.text !== 'string' || !claim.text.trim() || claim.text.length > 3000 ||
      typeof claim.quote !== 'string' || norm(claim.quote).length < 8 || claim.quote.length > 3000) return false
  const src = sources(context).find(s => s.id === claim.source)
  return !!src && norm(src.text).includes(norm(claim.quote))
}
function validateOutput(output, context, article = false) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('invalid_output')
  if (article) {
    if (typeof output.headline !== 'string' || !output.headline.trim() || output.headline.length > 250 ||
        typeof output.headline_ar !== 'string' || !output.headline_ar.trim() || output.headline_ar.length > 250) throw new Error('invalid_output')
    for (const k of ['en', 'ar']) if (!Array.isArray(output[k]) || output[k].length < 1 || output[k].length > 6 || !output[k].every(c => evidenceValid(c, context))) throw new Error('invalid_evidence')
    return { headline: output.headline, headline_ar: output.headline_ar,
      body_en: output.en.map(c => c.text).join('\n\n'), body_ar: output.ar.map(c => c.text).join('\n\n'),
      evidence: { en: output.en.map(({ source, quote }) => ({ source, quote })), ar: output.ar.map(({ source, quote }) => ({ source, quote })) },
      is_ai_generated: true }
  }
  if (output.insufficient === true) return { insufficient: true, claims: [] }
  if (!Array.isArray(output.claims) || output.claims.length < 1 || output.claims.length > 5 || !output.claims.every(c => evidenceValid(c, context))) throw new Error('invalid_evidence')
  return { insufficient: false, claims: output.claims.map(({ text, source, quote }) => ({ text, source, quote })) }
}
async function rpc(sb, name, args) {
  const r = await sb.rpc(name, args)
  if (r.error) {
    const code = /admin:(forbidden|not_found|conflict|invalid_input)/.exec(r.error.message || '')?.[1]
    const err = new Error(code || 'unavailable')
    err.status = { forbidden: 403, not_found: 404, conflict: 409, invalid_input: 400 }[code] || 503
    throw err
  }
  return r.data
}
async function limited(sb, key, limit, seconds) {
  if (await rpc(sb, 'consume_submission_rate_limit', { p_key: key, p_limit: limit, p_window_seconds: seconds }) !== true) {
    const e = new Error('rate_limit'); e.status = 429; throw e
  }
}
function safeBody(body, allowed) {
  return body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).every(k => allowed.includes(k))
}
async function handleKnowledge({ body, supabase: sb, env = process.env, headers, clientKey, generate }) {
  if (!enabled(env)) return reply(404, { reason: 'not_available' })
  if (!safeBody(body, ['action','token','language','granted','hash','publicId','question']) || !['en','ar'].includes(body.language)) return reply(400, { reason: 'invalid_request' })
  if (!sb) return reply(503, { reason: 'unavailable' })
  try {
    const key = clientHash(env, clientKey, headers).slice(0, 32)
    await limited(sb, 'knowledge-request:' + key, 60, 600)
    if (body.action === 'permission') {
      if (typeof body.token !== 'string' || !/^[0-9a-f]{64}$/.test(body.token) ||
          (body.granted !== undefined && typeof body.granted !== 'boolean') ||
          (body.granted !== undefined && !/^[0-9a-f]{64}$/.test(body.hash || ''))) return reply(400, { reason: 'invalid_request' })
      const result = await rpc(sb, 'knowledge_permission', {
        p_token_hash: createHash('sha256').update(body.token).digest('hex'), p_language: body.language,
        p_granted: body.granted ?? null, p_notice_hash: body.hash ?? null,
      })
      return reply(200, result)
    }
    if (!isPublicEnabled(env) || !PUBLIC_ID.test(body.publicId || '')) return reply(404, { reason: 'not_available' })
    if (!['source','ask'].includes(body.action)) return reply(400, { reason: 'invalid_request' })
    const context = await rpc(sb, 'knowledge_source', { p_public_id: body.publicId })
    if (!context) return reply(404, { reason: 'not_available' })
    if (body.action === 'source') return reply(200, { available: true, scope: 'abstract', sources: sources(context).map(({ id, anchor }) => ({ id, anchor })), article: await rpc(sb, 'knowledge_article', { p_public_id: body.publicId }) })
    if (typeof body.question !== 'string' || body.question.trim().length < 3 || body.question.length > 600) return reply(400, { reason: 'invalid_request' })
    await limited(sb, 'knowledge-ai-client:' + key, 10, 86400)
    // Shared cap protects the existing submission extraction quota.
    await limited(sb, 'knowledge-ai-global', 50, 86400)
    const output = await generate({ context, question: body.question.trim(), language: body.language, article: false, env })
    const answer = validateOutput(output, context)
    const fresh = await rpc(sb, 'knowledge_source', { p_public_id: body.publicId })
    if (!fresh || fresh.hash !== context.hash) return reply(409, { reason: 'source_changed' })
    return reply(200, { ...answer, scope: 'abstract', sources: sources(context).map(({ id, anchor }) => ({ id, anchor })) })
  } catch (err) { return reply(err.status || 503, { reason: ['rate_limit','forbidden','not_found','conflict','source_changed'].includes(err.message) ? err.message : 'unavailable' }) }
}

async function handleKnowledgeAdmin({ body, token, supabase: sb, env = process.env, generate, getUser }) {
  if (!enabled(env) || env.ADMIN_REVIEW !== 'enabled') return reply(404, { reason: 'not_available' })
  if (!sb) return reply(503, { reason: 'unavailable' })
  const actor = await authenticate(token, getUser || ((t) => sb.auth.getUser(t)))
  if (!actor) return reply(401, { reason: 'unauthenticated' })
  if (!safeBody(body,['action','paperId','hash','content','versionId','reviewed']) || !/^[0-9a-f-]{36}$/.test(body.paperId || '')) return reply(400, { reason: 'invalid_request' })
  try {
    const state = await rpc(sb, 'knowledge_admin', { p_actor: actor, p_paper: body.paperId })
    if (body.action === 'load') return reply(200, state)
    if (body.action === 'unpublish') return reply(200, await rpc(sb,'knowledge_publish',{p_actor:actor,p_paper:body.paperId,p_version:null,p_publish:false}))
    if (!state.source) return reply(409, { reason: 'permission_or_publication_required' })
    if (body.action === 'publish') {
      if (body.reviewed !== true || body.versionId !== state.draft?.id) return reply(400,{reason:'review_required'})
      return reply(200,await rpc(sb,'knowledge_publish',{p_actor:actor,p_paper:body.paperId,p_version:body.versionId,p_publish:true}))
    }
    let content
    if (body.action === 'generate') {
      await limited(sb, 'knowledge-article:' + actor, 5, 86400)
      await limited(sb, 'knowledge-ai-global', 50, 86400)
      content = validateOutput(await generate({ context:state.source, article:true, language:'en', env }), state.source, true)
    } else if (body.action === 'save') {
      if (body.hash !== state.source.hash || !safeBody(body.content,['headline','headline_ar','body_en','body_ar'])) return reply(409,{reason:'source_changed'})
      for (const k of ['headline','headline_ar','body_en','body_ar']) if (typeof body.content[k] !== 'string' || !body.content[k].trim() || body.content[k].length > (k.startsWith('headline') ? 250 : 12000)) return reply(400,{reason:'invalid_request'})
      content = { ...body.content, is_ai_generated:false, evidence:state.draft?.source_evidence || null }
    } else return reply(400,{reason:'invalid_request'})
    return reply(200,await rpc(sb,'knowledge_save_draft',{p_actor:actor,p_paper:body.paperId,p_hash:state.source.hash,p_content:content}))
  } catch(err) { return reply(err.status || 503,{reason:['forbidden','not_found','conflict','rate_limit'].includes(err.message)?err.message:'unavailable'}) }
}
module.exports = { enabled, sources, evidenceValid, validateOutput, handleKnowledge, handleKnowledgeAdmin }
