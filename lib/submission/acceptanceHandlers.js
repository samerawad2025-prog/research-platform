// lib/submission/acceptanceHandlers.js
//
// Phase 3 M2A: the server-controlled acceptance and upload foundation.
// Plain CommonJS with its collaborators passed in, like extractHandler.js,
// so it is exercised by tests against a real Postgres and a storage
// substitute (supabase/tests/submission-postgres.test.js).
//
// The flow (docs/submission-flow.md has the full contract):
//   GET  /api/submissions/terms     what may be accepted, and the processing
//                                   behaviour a new submission would get now
//   POST /api/submissions/intent    accept + choose a setting -> acceptance
//                                   record + upload authorization for ONE
//                                   server-chosen private path
//   (browser uploads the file with that authorization)
//   POST /api/submissions/finalize  server checks the uploaded object and
//                                   creates the paper exactly once
//
// Nothing the browser sends is trusted as legal text, hash, path,
// timestamp or processing permission. The endpoints are off unless
// SUBMISSION_ACCEPTANCE_FLOW=enabled, and every agreement row is inactive
// until the founder activates it.

const crypto = require('node:crypto')
const JSZip = require('jszip')
const { resolveExtractionMode } = require('../env')
const { validateWhatsApp } = require('../validation/phone')
const { AGREEMENTS, findAgreement } = require('./agreements')
const { agreementText } = require('./agreementText')
const { parseAgreement, acceptanceSentence } = require('./agreementMarkdown')

const MAX_FILE_BYTES = 20 * 1024 * 1024 // the bucket's own limit
const INTENT_TTL_SECONDS = 30 * 60
// How long a processing offer from /terms may be accepted.
const OFFER_TTL_SECONDS = 30 * 60
// Cleanup waits for the Storage upload authorization's OWN expiry (read
// from the authorization, about 2 hours; intent expiry does not revoke
// it), plus this margin for an upload that started just before it.
const UPLOAD_IN_PROGRESS_MARGIN_SECONDS = 60 * 60
const CLEANUP_BATCH = 5
const PUBLICATION_SETTINGS = ['record_abstract', 'record_abstract_fulltext']
const CLAIMED_ROLES = ['author', 'coauthor', 'authorized_depositor']
const FILE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
// Proportionate limits per client address per hour. No account needed.
const LIMITS = {
  terms: [120, 3600],
  intent: [10, 3600],
  finalize: [30, 3600],
}

const MAX_AUTHORS = 50
const INTENT_KEYS = ['offerToken', 'authors', 'agreementId', 'accepted', 'publicationSetting', 'claimedRole', 'fullName', 'email', 'whatsapp', 'whatsappCountry', 'file']
const FILE_KEYS = ['name', 'size', 'type']
const FINALIZE_KEYS = ['intentId', 'intentToken']
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const reply = (status, body) => ({ status, body })
const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')
const hmacHex = (secret, value) => crypto.createHmac('sha256', secret).update(value).digest('hex')

function flowConfig(env) {
  if (String(env.SUBMISSION_ACCEPTANCE_FLOW || '').trim().toLowerCase() !== 'enabled') {
    return { enabled: false, reason: 'not_available' }
  }
  const secret = env.SUBMISSION_TOKEN_SECRET
  if (!secret || String(secret).length < 32) return { enabled: false, reason: 'server_config' }
  return { enabled: true, secret: String(secret) }
}

function unavailable(flow) {
  return flow.reason === 'server_config'
    ? reply(503, { error: 'Server configuration error.', reason: 'server_config' })
    : reply(404, { error: 'Not available.', reason: 'not_available' })
}

// The confirmation token is derived from the intent token, which only the
// browser holds (the database keeps its hash), with a server secret. So a
// retried finalization can hand back the same token without the database
// ever storing a usable one, and a copy of the database alone cannot
// produce it. 64 hex characters, like the tokens submit_paper issues.
function confirmationTokenFor(secret, intentToken) {
  return hmacHex(secret, `confirmation:${intentToken}`)
}

function sqlCode(error) {
  const m = /submission:([a-z_]+)/.exec(error?.message || '')
  return m ? m[1] : null
}

// ---------------------------------------------------------------------------
// Processing offers. /terms signs what it showed: the processing decision
// and the agreement versions. /intent accepts only against a valid offer,
// and never records processing broader than the offer. The browser cannot
// forge or widen one: it is HMAC-signed with the server secret.
// ---------------------------------------------------------------------------
function signOffer(secret, { decision, agreements, now = Date.now() }) {
  const iat = Math.floor(now / 1000)
  const payload = { v: 1, iat, exp: iat + OFFER_TTL_SECONDS, d: decision, a: agreements.map((a) => [a.id, a.sha256]) }
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return { token: `${body}.${hmacHex(secret, `offer:${body}`)}`, payload }
}

function verifyOffer(secret, token, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 4096) return { error: 'offer_invalid' }
  const [body, mac, ...rest] = token.split('.')
  if (!body || !mac || rest.length) return { error: 'offer_invalid' }
  const expected = Buffer.from(hmacHex(secret, `offer:${body}`))
  const given = Buffer.from(mac)
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) return { error: 'offer_invalid' }
  let p
  try {
    p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'))
  } catch {
    return { error: 'offer_invalid' }
  }
  if (!p || p.v !== 1 || !['automatic', 'manual'].includes(p.d) || !Array.isArray(p.a) || !Number.isInteger(p.iat) || !Number.isInteger(p.exp)) {
    return { error: 'offer_invalid' }
  }
  if (p.exp <= Math.floor(now / 1000)) return { error: 'offer_stale', staleBecause: 'offer_expired' }
  return { offer: p }
}

function staleReply(staleBecause) {
  return reply(409, {
    error: 'The submission terms have changed. Please review them and accept again.',
    reason: 'offer_stale',
    staleBecause,
    refresh: '/api/submissions/terms',
  })
}

// The expiry Storage wrote into the upload authorization (a JWT), or null.
function authorizationExpiry(token) {
  try {
    const exp = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8')).exp
    return Number.isInteger(exp) && exp > 0 ? new Date(exp * 1000).toISOString() : null
  } catch {
    return null
  }
}

async function withinLimit({ supabase, secret, bucket, clientKey }) {
  const [limit, windowSeconds] = LIMITS[bucket]
  // The address is keyed through a secret hash and never stored as such.
  const key = `${bucket}:${hmacHex(secret, `client:${clientKey || 'unknown'}`).slice(0, 32)}`
  const { data, error } = await supabase.rpc('consume_submission_rate_limit', {
    p_key: key,
    p_limit: limit,
    p_window_seconds: windowSeconds,
  })
  if (error) return 'unavailable'
  return data === true ? 'ok' : 'limited'
}

function limitReply(state) {
  return state === 'limited'
    ? reply(429, { error: 'Too many requests. Please wait a while and try again.', reason: 'rate_limited' })
    : reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' })
}

async function readPolicy(supabase) {
  const { data, error } = await supabase.from('extraction_policy').select('mode').maybeSingle()
  if (error) return { error }
  return { mode: data?.mode === 'automatic' ? 'automatic' : 'manual' }
}

// What a new submission would get right now. The same rule the database
// applies when the acceptance is recorded (create_submission_intent): both
// the running application and the policy row must say automatic.
function previewDecision(env, policyMode) {
  return resolveExtractionMode(env).mode === 'automatic' && policyMode === 'automatic' ? 'automatic' : 'manual'
}

async function activeAgreements(supabase) {
  const { data, error } = await supabase
    .from('agreement_versions')
    .select('id, language, version_label, version_date, content_sha256, active')
    .eq('active', true)
  if (error) return { error }
  // Only rows the application itself also knows, with the same hash, and
  // whose exact text can be served: what is offered is what is shown.
  const agreements = (data || [])
    .map((row) => ({ row, known: findAgreement(row.id) }))
    .filter(({ row, known }) => known && known.sha256 === row.content_sha256 && known.language === row.language)
    .map(({ known }) => ({ known, text: agreementText(known) }))
    .filter(({ text }) => text)
    .map(({ known, text }) => ({
      id: known.id,
      language: known.language,
      versionLabel: known.versionLabel,
      versionDate: known.versionDate,
      sha256: known.sha256,
      text,
      acceptanceSentence: acceptanceSentence(parseAgreement(text)),
    }))
  return { agreements }
}

// ---------------------------------------------------------------------------
// GET /api/submissions/terms
// ---------------------------------------------------------------------------
async function handleTerms({ env = process.env, supabase, clientKey }) {
  const flow = flowConfig(env)
  if (!flow.enabled) return unavailable(flow)
  const limit = await withinLimit({ supabase, secret: flow.secret, bucket: 'terms', clientKey })
  if (limit !== 'ok') return limitReply(limit)

  const [{ agreements, error: aErr }, { mode, error: pErr }] = await Promise.all([activeAgreements(supabase), readPolicy(supabase)])
  if (aErr || pErr) return reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' })

  const decision = previewDecision(env, mode)
  const offer = signOffer(flow.secret, { decision, agreements })
  return reply(200, {
    available: agreements.length > 0,
    agreements,
    publicationSettings: PUBLICATION_SETTINGS,
    defaultPublicationSetting: 'record_abstract',
    claimedRoles: CLAIMED_ROLES,
    // A preview. The decision recorded with the acceptance (returned by
    // /intent) is authoritative, and the form must show that one.
    processing: { decision },
    // Send back with /intent. It binds the acceptance to what was shown:
    // processing broader than this offer is never recorded.
    offer: { token: offer.token, decision, expiresAt: new Date(offer.payload.exp * 1000).toISOString() },
    maxFileBytes: MAX_FILE_BYTES,
    fileTypes: Object.keys(FILE_TYPES),
  })
}

// ---------------------------------------------------------------------------
// Validation of the acceptance request. Everything the database also checks
// is checked here first, so a bad request costs no write.
// ---------------------------------------------------------------------------
function validateIntentBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' }
  // Unknown keys are refused, not ignored: a browser cannot slip in a
  // processing choice, a path, a hash or a timestamp and have it silently
  // dropped in one version and honoured in the next.
  const extra = Object.keys(body).find((k) => !INTENT_KEYS.includes(k))
  if (extra) return { error: 'unexpected_field', field: extra }

  // Exactly the boolean true. Not "true", not 1, not a missing field.
  if (body.accepted !== true) return { error: 'acceptance_required' }
  if (typeof body.offerToken !== 'string' || !body.offerToken) return { error: 'offer_invalid' }

  const agreement = typeof body.agreementId === 'string' ? findAgreement(body.agreementId) : null
  if (!agreement) return { error: 'agreement_unknown' }

  if (!PUBLICATION_SETTINGS.includes(body.publicationSetting)) return { error: 'publication_setting_invalid' }
  if (!CLAIMED_ROLES.includes(body.claimedRole)) return { error: 'claimed_role_invalid' }

  // A depositor names the actual authors; nobody else sends a list (an
  // author or co-author is linked from their own details, and the rest of
  // the team is confirmed after upload).
  let authors = null
  if (body.claimedRole === 'authorized_depositor') {
    if (!Array.isArray(body.authors) || body.authors.length < 1 || body.authors.length > MAX_AUTHORS) return { error: 'authors_required' }
    authors = body.authors.map((a) => (typeof a === 'string' ? a.trim() : ''))
    if (authors.some((a) => !a || a.length > 200)) return { error: 'authors_required' }
  } else if (body.authors !== undefined) {
    return { error: 'unexpected_field', field: 'authors' }
  }

  const fullName = typeof body.fullName === 'string' ? body.fullName.trim() : ''
  if (!fullName || fullName.length > 200) return { error: 'name_required' }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: 'email_invalid' }

  let whatsapp = null
  if (body.whatsapp !== undefined && body.whatsapp !== null && String(body.whatsapp).trim() !== '') {
    const v = validateWhatsApp(String(body.whatsapp), typeof body.whatsappCountry === 'string' ? body.whatsappCountry : undefined)
    if (v.state !== 'valid') return { error: 'whatsapp_invalid' }
    whatsapp = v.e164
  }

  const file = body.file
  if (!file || typeof file !== 'object' || Array.isArray(file)) return { error: 'file_required' }
  const extraFile = Object.keys(file).find((k) => !FILE_KEYS.includes(k))
  if (extraFile) return { error: 'unexpected_field', field: `file.${extraFile}` }
  const name = typeof file.name === 'string' ? file.name : ''
  const ext = (name.split('.').pop() || '').toLowerCase()
  if (!FILE_TYPES[ext] || name.lastIndexOf('.') < 1) return { error: 'file_type_invalid' }
  if (file.type !== FILE_TYPES[ext]) return { error: 'file_type_invalid' }
  if (!Number.isInteger(file.size) || file.size <= 0 || file.size > MAX_FILE_BYTES) return { error: 'file_size_invalid' }

  return {
    value: {
      offerToken: body.offerToken,
      agreement,
      publicationSetting: body.publicationSetting,
      claimedRole: body.claimedRole,
      authors,
      fullName,
      email,
      whatsapp,
      fileExtension: ext,
      declaredSize: file.size,
    },
  }
}

// ---------------------------------------------------------------------------
// POST /api/submissions/intent
// ---------------------------------------------------------------------------
async function handleCreateIntent({ body, env = process.env, supabase, storage, clientKey, log = console }) {
  const flow = flowConfig(env)
  if (!flow.enabled) return unavailable(flow)

  const checked = validateIntentBody(body)
  if (checked.error) {
    return reply(400, { error: 'The submission request is not valid.', reason: checked.error, ...(checked.field ? { field: checked.field } : {}) })
  }
  const v = checked.value
  const verified = verifyOffer(flow.secret, v.offerToken)
  if (verified.error === 'offer_invalid') return reply(400, { error: 'The submission request is not valid.', reason: 'offer_invalid' })
  if (verified.error) return staleReply(verified.staleBecause)
  const offered = verified.offer
  // The agreement accepted must be one the offer showed, with the same text.
  if (!offered.a.some(([id, sha]) => id === v.agreement.id && sha === v.agreement.sha256)) return staleReply('agreement_changed')

  const limit = await withinLimit({ supabase, secret: flow.secret, bucket: 'intent', clientKey })
  if (limit !== 'ok') return limitReply(limit)

  // Recalculate now. Broader than what was shown -> refuse, before any
  // record or upload authorization exists. Narrower -> proceed, and say so.
  const { mode: policyMode, error: pErr } = await readPolicy(supabase)
  if (pErr) return reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' })
  const current = previewDecision(env, policyMode)
  if (current === 'automatic' && offered.d !== 'automatic') return staleReply('processing_broadened')

  const intentToken = crypto.randomBytes(32).toString('base64url')
  const { data: intent, error } = await supabase.rpc('create_submission_intent', {
    p_intent_token_hash: sha256Hex(intentToken),
    p_agreement_version_id: v.agreement.id,
    p_agreement_language: v.agreement.language,
    p_agreement_sha256: v.agreement.sha256,
    p_claimed_role: v.claimedRole,
    p_publication_setting: v.publicationSetting,
    p_processing_mode: resolveExtractionMode(env).mode,
    p_full_name: v.fullName,
    p_email: v.email,
    p_whatsapp_number: v.whatsapp,
    p_file_extension: v.fileExtension,
    p_declared_size: v.declaredSize,
    p_ttl_seconds: INTENT_TTL_SECONDS,
    p_offer_decision: offered.d,
    p_offer_issued_at: new Date(offered.iat * 1000).toISOString(),
  })
  if (error) {
    const code = sqlCode(error)
    // The agreement was deactivated or replaced after the offer was shown.
    if (code === 'agreement_not_active' || code === 'agreement_mismatch') return staleReply('agreement_changed')
    log.error(JSON.stringify({ stage: 'intent_create_failed', pgCode: error.code ?? null }))
    return reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' })
  }

  // A depositor's author list is part of the acceptance, recorded before
  // any upload authorization exists. If it cannot be recorded, no upload is
  // possible and the (empty) acceptance simply expires.
  if (v.authors) {
    const { error: authorsError } = await supabase.rpc('record_declared_authors', { p_intent_id: intent.id, p_authors: v.authors })
    if (authorsError) {
      log.error(JSON.stringify({ stage: 'declared_authors_not_recorded', intentId: intent.id, pgCode: authorsError.code ?? null }))
      return reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' })
    }
  }

  // Authorization for exactly one object path, chosen above by the
  // database. upsert:false - an object that exists at the path cannot be
  // overwritten with it. The URL may be used again until an object exists
  // there or it expires; it is NOT single-use. What is one-time is
  // finalization (below).
  const { data: signed, error: signError } = await storage.createSignedUploadUrl(intent.object_path, { upsert: false })
  if (signError || !signed) {
    log.error(JSON.stringify({ stage: 'upload_authorization_failed', intentId: intent.id }))
    return reply(503, { error: 'Could not prepare the upload. Please try again.', reason: 'upload_authorization_failed' })
  }

  // Record when this authorization itself stops working. If it cannot be
  // read or recorded, the row keeps null, which cleanup treats as a full
  // day - later, never earlier.
  const authExpiresAt = authorizationExpiry(signed.token)
  if (authExpiresAt) {
    const { error: recError } = await supabase.rpc('record_upload_authorization', { p_intent_id: intent.id, p_expires_at: authExpiresAt })
    if (recError) log.error(JSON.stringify({ stage: 'upload_authorization_expiry_not_recorded', intentId: intent.id }))
  }

  // Bounded housekeeping, never on the critical path of this reply.
  await cleanupAbandonedIntents({ supabase, storage, limit: CLEANUP_BATCH, log }).catch(() => {})

  // Logged without any token or URL.
  log.log(JSON.stringify({ stage: 'intent_created', intentId: intent.id, decision: intent.processing_decision }))
  return reply(201, {
    intentId: intent.id,
    intentToken,
    expiresAt: intent.expires_at,
    acceptedAt: intent.accepted_at,
    agreement: { id: v.agreement.id, language: v.agreement.language, sha256: v.agreement.sha256 },
    publicationSetting: v.publicationSetting,
    // Authoritative. The form shows this, not its own guess.
    // offered = what /terms showed and was accepted. If the recorded
    // decision is narrower (the mode or policy became manual meanwhile),
    // changedFromOffer is true and the form must say so before uploading.
    processing: {
      decision: intent.processing_decision,
      offered: offered.d,
      changedFromOffer: intent.processing_decision !== offered.d,
    },
    upload: { bucket: 'papers', path: signed.path || intent.object_path, token: signed.token, signedUrl: signed.signedUrl },
    maxFileBytes: MAX_FILE_BYTES,
  })
}

async function looksLike(ext, bytes) {
  if (ext === 'pdf') return bytes.length > 5 && bytes.subarray(0, 5).toString('latin1') === '%PDF-'
  if (ext === 'docx') {
    if (!(bytes.length > 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04)) return false
    try {
      const zip = await JSZip.loadAsync(bytes)
      return Boolean(zip.file('word/document.xml'))
    } catch {
      return false
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// POST /api/submissions/finalize
// ---------------------------------------------------------------------------
async function handleFinalize({ body, env = process.env, supabase, storage, clientKey, log = console }) {
  const flow = flowConfig(env)
  if (!flow.enabled) return unavailable(flow)

  if (!body || typeof body !== 'object' || Array.isArray(body)) return reply(400, { error: 'Invalid request.', reason: 'invalid_body' })
  const extra = Object.keys(body).find((k) => !FINALIZE_KEYS.includes(k))
  if (extra) return reply(400, { error: 'Invalid request.', reason: 'unexpected_field', field: extra })
  const { intentId, intentToken } = body
  if (typeof intentId !== 'string' || !UUID.test(intentId) || typeof intentToken !== 'string' || intentToken.length < 32 || intentToken.length > 128) {
    return reply(400, { error: 'Invalid request.', reason: 'invalid_body' })
  }

  const limit = await withinLimit({ supabase, secret: flow.secret, bucket: 'finalize', clientKey })
  if (limit !== 'ok') return limitReply(limit)

  const tokenHash = sha256Hex(intentToken)
  const { data: intent, error: lookupError } = await supabase.rpc('get_submission_intent', { p_intent_id: intentId, p_intent_token_hash: tokenHash })
  if (lookupError) return reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' })
  if (!intent) return reply(404, { error: 'This submission could not be found.', reason: 'intent_not_found' })

  const confirmationToken = confirmationTokenFor(flow.secret, intentToken)

  let objectSize = null
  let objectSha = null
  // An expired acceptance goes straight to the database, which marks it
  // expired and refuses; the object is not even read.
  const expired = intent.status === 'expired' || intent.expired
  if (intent.status !== 'finalized' && !expired) {
    // Only ever the path recorded for THIS acceptance. The browser never
    // names a path, so it cannot point at anyone else's object.
    const { data: blob, error: dlError } = await storage.download(intent.object_path)
    if (dlError || !blob) return reply(409, { error: 'The file has not been uploaded yet.', reason: 'upload_missing' })
    const bytes = Buffer.from(await blob.arrayBuffer())
    if (bytes.length !== Number(intent.declared_size) || bytes.length > MAX_FILE_BYTES) {
      return reply(422, { error: 'The uploaded file does not match what was declared.', reason: 'object_size_mismatch' })
    }
    if (!(await looksLike(intent.file_extension, bytes))) {
      return reply(422, { error: 'The uploaded file is not a readable PDF or DOCX.', reason: 'object_type_invalid' })
    }
    objectSize = bytes.length
    objectSha = sha256Hex(bytes)
  }

  const { data: done, error: finError } = await supabase.rpc('finalize_submission_intent', {
    p_intent_id: intentId,
    p_intent_token_hash: tokenHash,
    // For an already-finalized acceptance these are ignored by the
    // function, which returns the existing paper unchanged.
    p_object_size: objectSize ?? 0,
    p_object_sha256: objectSha ?? '0'.repeat(64),
    p_confirmation_token_hash: sha256Hex(confirmationToken),
  })
  if (finError) {
    const code = sqlCode(finError)
    if (code === 'intent_not_found') return reply(404, { error: 'This submission could not be found.', reason: code })
    if (code === 'intent_expired') return reply(410, { error: 'This submission expired before it was completed. Please start again.', reason: code })
    if (code === 'object_size_mismatch') return reply(422, { error: 'The uploaded file does not match what was declared.', reason: code })
    log.error(JSON.stringify({ stage: 'finalize_failed', intentId, pgCode: finError.code ?? null }))
    return reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' })
  }

  if (done?.error === 'intent_expired') {
    return reply(410, { error: 'This submission expired before it was completed. Please start again.', reason: 'intent_expired' })
  }

  log.log(JSON.stringify({ stage: 'submission_finalized', intentId, alreadyFinalized: done.already_finalized, decision: done.processing_decision }))
  return reply(200, {
    confirmationToken,
    alreadyFinalized: done.already_finalized,
    processing: { decision: done.processing_decision },
    // The browser may ask /api/extract to start only when this is true;
    // the extraction route enforces the same rule on its own.
    extraction: { mayStart: done.processing_decision === 'automatic' },
  })
}

// ---------------------------------------------------------------------------
// Abandoned acceptances. Bounded per call. Removes only an expired,
// never-finalized acceptance's own object, at the path recorded for it.
// ---------------------------------------------------------------------------
async function cleanupAbandonedIntents({ supabase, storage, limit = CLEANUP_BATCH, marginSeconds = UPLOAD_IN_PROGRESS_MARGIN_SECONDS, log = console }) {
  const { data: list, error } = await supabase.rpc('expire_submission_intents', { p_limit: limit, p_margin_seconds: marginSeconds })
  if (error || !Array.isArray(list)) return { removed: 0, error: true }
  let removed = 0
  for (const item of list) {
    const own = new RegExp(`^intents/${item.id}/[0-9a-f]{24}\\.(pdf|docx)$`)
    if (!own.test(item.object_path)) continue
    const { error: rmError } = await storage.remove([item.object_path])
    if (rmError) continue
    const { error: markError } = await supabase.rpc('mark_submission_object_removed', { p_intent_id: item.id })
    if (!markError) removed += 1
  }
  if (removed) log.log(JSON.stringify({ stage: 'abandoned_intents_cleaned', removed }))
  return { removed }
}

module.exports = {
  handleTerms,
  handleCreateIntent,
  handleFinalize,
  cleanupAbandonedIntents,
  validateIntentBody,
  confirmationTokenFor,
  signOffer,
  verifyOffer,
  authorizationExpiry,
  OFFER_TTL_SECONDS,
  UPLOAD_IN_PROGRESS_MARGIN_SECONDS,
  AGREEMENTS,
  MAX_FILE_BYTES,
  INTENT_TTL_SECONDS,
  LIMITS,
}
