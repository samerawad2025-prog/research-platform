const { createHash } = require('node:crypto')
const { PUBLIC_ID, isPublicEnabled } = require('../public/server')
const { authenticate } = require('../admin/handlers')
const { clientHash } = require('../public/activity')

const enabled = (env) => env.RESEARCH_KNOWLEDGE === 'enabled'
const reply = (status, body) => ({ status, body })
function sources(context) {
  return ['abstract', 'abstract_ar'].filter(k => context?.source?.[k]).map(k => ({
    id: k, text: context.source[k], anchor: k === 'abstract' ? 'abstract-en' : 'abstract-ar',
  }))
}
// Normalize each source once per response. NFC preserves meaningful distinctions
// such as superscript units; whitespace differences alone are harmless.
function evidenceIndex(context) {
  return new Map(sources(context).map(s => [s.id, s.text.normalize('NFC').replace(/\s+/g, ' ').trim()]))
}
function validClaim(claim, index) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim) ||
      typeof claim.text !== 'string' || !claim.text.trim() || claim.text.length > 3000 ||
      typeof claim.quote !== 'string' || claim.quote.length > 3000) return false
  const quote = claim.quote.normalize('NFC').replace(/\s+/g, ' ').trim()
  return quote.length >= 8 && !!index.get(claim.source)?.includes(quote)
}
function evidenceValid(claim, context) {
  return validClaim(claim, evidenceIndex(context))
}
function validateOutput(output, context, article = false) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) throw new Error('invalid_output')
  const index = evidenceIndex(context)
  const validClaims = claims => Array.isArray(claims) && claims.length >= 1 && claims.length <= 4 &&
    claims.every(c => validClaim(c, index))
  if (article) {
    if (typeof output.headline !== 'string' || !output.headline.trim() || output.headline.length > 250 ||
        typeof output.headline_ar !== 'string' || !output.headline_ar.trim() || output.headline_ar.length > 250) throw new Error('invalid_output')
    for (const k of ['en', 'ar']) if (!validClaims(output[k])) throw new Error('invalid_evidence')
    return { headline: output.headline, headline_ar: output.headline_ar,
      body_en: output.en.map(c => c.text).join('\n\n'), body_ar: output.ar.map(c => c.text).join('\n\n'),
      evidence: { en: output.en.map(({ source, quote }) => ({ source, quote })), ar: output.ar.map(({ source, quote }) => ({ source, quote })) },
      is_ai_generated: true }
  }
  if (typeof output.insufficient !== 'boolean' || !Array.isArray(output.claims)) throw new Error('invalid_output')
  if (output.insufficient) {
    if (output.claims.length !== 0) throw new Error('invalid_output')
    return { insufficient: true, claims: [] }
  }
  if (!validClaims(output.claims)) throw new Error('invalid_evidence')
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
    if (body.action === 'notice') {
      if (!safeBody(body, ['action','language'])) return reply(400, { reason:'invalid_request' })
      const { data, error } = await sb.from('knowledge_notices').select('version,text_en,text_ar').eq('version','knowledge-v1-2026-10-21').maybeSingle()
      const text = data?.[body.language === 'ar' ? 'text_ar' : 'text_en']
      if (error || typeof text !== 'string' || !text) return reply(503, { reason:'unavailable' })
      return reply(200, { version:data.version, text, hash:createHash('sha256').update(text).digest('hex') })
    }
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

function articleFailure(err, stage) {
  if (['forbidden','not_found','conflict','rate_limit'].includes(err.message)) return err.message
  if (stage === 'validate') return 'invalid_evidence'
  if (stage === 'save') return 'draft_save_failed'
  if (stage === 'generate') return err.name === 'AbortError' ? 'generation_timeout' : err.message === 'incomplete' ? 'incomplete' : 'provider_unavailable'
  return 'unavailable'
}
async function handleKnowledgeAdmin({ body, token, supabase: sb, env = process.env, generate, getUser }) {
  if (!enabled(env) || env.ADMIN_REVIEW !== 'enabled') return reply(404, { reason: 'not_available' })
  if (!sb) return reply(503, { reason: 'unavailable' })
  const actor = await authenticate(token, getUser || ((t) => sb.auth.getUser(t)))
  if (!actor) return reply(401, { reason: 'unauthenticated' })
  if (!safeBody(body,['action','paperId','hash','content','versionId','reviewed']) || !/^[0-9a-f-]{36}$/.test(body.paperId || '')) return reply(400, { reason: 'invalid_request' })
  let stage = 'load'
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
      stage = 'generate'
      const output = await generate({ context:state.source, article:true, language:'en', env })
      stage = 'validate'
      content = validateOutput(output, state.source, true)
    } else if (body.action === 'save') {
      if (body.hash !== state.source.hash || !safeBody(body.content,['headline','headline_ar','body_en','body_ar'])) return reply(409,{reason:'source_changed'})
      for (const k of ['headline','headline_ar','body_en','body_ar']) if (typeof body.content[k] !== 'string' || !body.content[k].trim() || body.content[k].length > (k.startsWith('headline') ? 250 : 12000)) return reply(400,{reason:'invalid_request'})
      content = { ...body.content, is_ai_generated:false, evidence:state.draft?.source_evidence || null }
    } else return reply(400,{reason:'invalid_request'})
    stage = 'save'
    return reply(200,await rpc(sb,'knowledge_save_draft',{p_actor:actor,p_paper:body.paperId,p_hash:state.source.hash,p_content:content}))
  } catch(err) { return reply(err.status || 503,{reason:articleFailure(err, stage)}) }
}
module.exports = { enabled, sources, evidenceValid, validateOutput, handleKnowledge, handleKnowledgeAdmin }
