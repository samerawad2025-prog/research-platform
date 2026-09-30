// lib/admin/handlers.js
//
// Phase 3 M4: the administrative review API (docs/admin-review.md). Plain
// CommonJS with its collaborators passed in, like the submission handlers,
// so it is exercised against a real Postgres and a storage substitute
// (supabase/tests/admin-postgres.test.js) and against the real local
// Supabase stack (supabase/tests/admin-local.test.js).
//
// The rules, in one place:
//   * Authentication: every request carries a Supabase Auth access token.
//     It is verified with Supabase Auth itself (getUser), never decoded
//     here, and nothing in it (role, app_metadata, email) confers any
//     authority. The verified user id is the only thing used.
//   * Authorization: decided by the database, per call, from the user id:
//     role, active flag, assignment, confidentiality acknowledgement
//     (supabase/migrations/0015_admin_review.sql). This module does not
//     re-implement those rules; it authenticates, validates input, calls
//     the function and maps its answer. A denied call has no side effect.
//   * Off unless ADMIN_REVIEW=enabled (404 everywhere).
//   * Nothing secret is logged: no token, note, reason, signed URL or
//     contact detail.

const crypto = require('node:crypto')
const { loadConfidentiality } = require('./confidentiality')
const { looksLike } = require('../submission/acceptanceHandlers')
const { isPublicEnabled, recordUrl } = require('../public/server')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
const MAX_FILE_BYTES = 20 * 1024 * 1024
const SIGNED_URL_SECONDS = 60
const FILE_TYPES = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}
const DECISIONS = ['needs_changes', 'reviewed', 'approved', 'declined', 'withdrawn', 'reopen']
const RECOMMENDATIONS = ['approve', 'needs_changes', 'decline', 'hold']
const ISSUE_KINDS = ['metadata', 'rights', 'duplicate', 'document', 'privacy', 'other']
const LEGACY_SETTINGS = ['record_abstract', 'record_abstract_fulltext', 'hold']
const LANGS = ['en', 'ar', 'other']

const reply = (status, body) => ({ status, body })
const sha256Hex = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex')

// Business answers of the database functions ({ ok: false, error }).
const BUSINESS_STATUS = {
  stale_revision: 409, preconditions_failed: 422, reason_required: 400, already_pending: 409,
  not_a_legacy_record: 409, legacy_grant_does_not_cover_full_text: 422, legacy_grant_empty: 422,
  hash_mismatch: 422, size_mismatch: 422, not_pending: 409, text_mismatch: 409, no_active_version: 409,
}
const RAISED_STATUS = {
  forbidden: 403, confidentiality_required: 403, not_found: 404, invalid_input: 400, conflict: 409,
  user_not_found: 404, user_unconfirmed: 422, last_administrator: 409, original_not_registered: 409,
}

function isEnabled(env) {
  return String(env.ADMIN_REVIEW || '').trim().toLowerCase() === 'enabled'
}

async function authenticate(token, getUser) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 4096) return null
  try {
    const { data, error } = await getUser(token)
    const id = data?.user?.id
    return !error && typeof id === 'string' && UUID.test(id) ? id : null
  } catch {
    return null
  }
}

// A validator returns the cleaned value or undefined (invalid).
const v = {
  uuid: (x) => (typeof x === 'string' && UUID.test(x) ? x : undefined),
  uuidOrNull: (x) => (x === null || x === undefined ? null : typeof x === 'string' && UUID.test(x) ? x : undefined),
  text: (max, min = 1) => (x) => (typeof x === 'string' && x.trim().length >= min && x.length <= max ? x : undefined),
  textOrNull: (max) => (x) => (x === null || x === undefined || x === '' ? null : typeof x === 'string' && x.length <= max ? x : undefined),
  bool: (x) => (typeof x === 'boolean' ? x : undefined),
  oneOf: (list) => (x) => (list.includes(x) ? x : undefined),
  dateOrNull: (x) => (x === null || x === undefined || x === '' ? null : typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? x : undefined),
}

// Strict: unknown keys are refused, like the submission endpoints.
function parse(body, spec) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' }
  const extra = Object.keys(body).find((k) => !(k in spec))
  if (extra) return { error: 'unexpected_field', field: extra }
  const out = {}
  for (const [key, [check, required]] of Object.entries(spec)) {
    const raw = body[key]
    if (raw === undefined && !required) { out[key] = null; continue }
    const value = check(raw)
    if (value === undefined) return { error: 'invalid_field', field: key }
    out[key] = value
  }
  return { value: out }
}
const req = (check) => [check, true]
const opt = (check) => [check, false]

function badInput(parsed) {
  return reply(400, { error: 'The request is not valid.', reason: parsed.error, ...(parsed.field ? { field: parsed.field } : {}) })
}

function makeContext({ supabase, storage, log }) {
  // One database call, mapped. Never leaks a database message.
  async function rpc(name, args) {
    const { data, error } = await supabase.rpc(name, args)
    if (error) {
      const m = /admin:([a-z_]+)/.exec(error.message || '')
      if (m) return { reply: reply(RAISED_STATUS[m[1]] || 400, { error: 'The request was refused.', reason: m[1] }) }
      log.error(JSON.stringify({ stage: 'admin_rpc_failed', fn: name, pgCode: error.code ?? null }))
      return { reply: reply(503, { error: 'The service is not ready. Please try again later.', reason: 'database_not_ready' }) }
    }
    if (data && typeof data === 'object' && data.ok === false && data.error) {
      const { ok, error: err, ...rest } = data
      return { reply: reply(BUSINESS_STATUS[err] || 422, { error: 'The request could not be completed.', reason: err, ...rest }) }
    }
    return { data }
  }
  return { rpc, supabase, storage, log }
}

// ---------------------------------------------------------------------------
// Routes. Each: (ctx, actor, params, query, body, deps) => { status, body }.
// ---------------------------------------------------------------------------
async function simple(ctx, name, args, status = 200) {
  const r = await ctx.rpc(name, args)
  return r.reply || reply(status, r.data)
}

async function findUserId(supabase, { userId, email }) {
  if (userId) return userId
  const wanted = String(email).trim().toLowerCase()
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 100 })
    if (error) return undefined
    const hit = (data?.users || []).find((u) => String(u.email || '').toLowerCase() === wanted)
    if (hit) return hit.id
    if (!data?.users || data.users.length < 100) break
  }
  return null
}

async function downloadBytes(storage, path) {
  const { data, error } = await storage.download(path)
  if (error || !data) return null
  return Buffer.from(await data.arrayBuffer())
}

// Makes sure the original is registered with its real hash, and returns its id.
async function ensureOriginal(ctx, actor, paperId) {
  const info = await ctx.rpc('admin_original_info', { p_actor: actor, p_paper: paperId })
  if (info.reply) return info
  if (info.data.registered_id) return { id: info.data.registered_id }
  let sha = info.data.sha256
  let size = info.data.size
  if (!sha || !size) {
    // A record from before the acceptance flow has no recorded hash: it is
    // read once from private storage and recorded.
    const bytes = await downloadBytes(ctx.storage, info.data.storage_path)
    if (!bytes) return { reply: reply(409, { error: 'The original file could not be read.', reason: 'original_unavailable' }) }
    sha = sha256Hex(bytes)
    size = bytes.length
  }
  const reg = await ctx.rpc('admin_register_original', { p_actor: actor, p_paper: paperId, p_sha256: sha, p_size: Number(size) })
  if (reg.reply) return reg
  return { id: reg.data.id }
}

async function createDocument(ctx, actor, paperId, b) {
  const isCopy = b.origin === 'original_reviewed'
  let ext = null
  let declared = null
  if (!isCopy) {
    // Validated first: a bad request costs no database call.
    const f = b.file
    ext = /\.([a-z0-9]+)$/i.exec(f?.name || '')?.[1]?.toLowerCase()
    if (!f || !FILE_TYPES[ext] || f.type !== FILE_TYPES[ext] || !Number.isInteger(f.size) || f.size <= 0 || f.size > MAX_FILE_BYTES) {
      return reply(400, { error: 'The request is not valid.', reason: 'file_invalid' })
    }
    declared = f.size
  } else if (b.file) {
    return reply(400, { error: 'The request is not valid.', reason: 'file_invalid' })
  }
  const orig = await ensureOriginal(ctx, actor, paperId)
  if (orig.reply) return orig.reply
  if (isCopy) {
    const info = await ctx.rpc('admin_original_info', { p_actor: actor, p_paper: paperId })
    if (info.reply) return info.reply
    ext = /\.(pdf|docx)$/i.exec(info.data.storage_path)?.[1]?.toLowerCase()
  }
  if (!ext) return reply(400, { error: 'The request is not valid.', reason: 'file_invalid' })
  const prep = await ctx.rpc('admin_prepare_document', {
    p_actor: actor, p_paper: paperId, p_origin: b.origin, p_extension: ext, p_declared_size: declared,
    p_note: b.note, p_redaction_note: b.redactionNote,
  })
  if (prep.reply) return prep.reply
  const version = prep.data

  if (!isCopy) {
    // A redacted copy is uploaded by the browser to a private, server-chosen
    // path, then finalized (the server checks and hashes what arrived).
    const { data: signed, error } = await ctx.storage.createSignedUploadUrl(version.storage_path, { upsert: false })
    if (error || !signed) return reply(503, { error: 'Could not prepare the upload.', reason: 'upload_authorization_failed' })
    return reply(201, {
      versionId: version.id,
      upload: { bucket: 'papers', path: version.storage_path, token: signed.token, signedUrl: signed.signedUrl },
      maxFileBytes: MAX_FILE_BYTES,
    })
  }

  // The reviewed original, designated without change: copied inside private
  // storage to its own object, and only if it still has the recorded hash.
  const bytes = await downloadBytes(ctx.storage, version.original_storage_path)
  if (!bytes || sha256Hex(bytes) !== version.original_sha256) {
    return reply(409, { error: 'The original file no longer matches the recorded hash.', reason: 'original_changed' })
  }
  const { error: upError } = await ctx.storage.upload(version.storage_path, bytes, { upsert: false, contentType: FILE_TYPES[ext] })
  if (upError) return reply(503, { error: 'Could not store the copy.', reason: 'storage_unavailable' })
  const fin = await ctx.rpc('admin_finalize_document', { p_actor: actor, p_version: version.id, p_sha256: sha256Hex(bytes), p_size: bytes.length })
  if (fin.reply) return fin.reply
  return reply(201, { versionId: version.id, state: 'proposed' })
}

async function finalizeDocument(ctx, actor, versionId) {
  const info = await ctx.rpc('admin_document_upload_info', { p_actor: actor, p_version: versionId })
  if (info.reply) return info.reply
  const { storage_path: path, file_extension: ext, declared_size: declared, state } = info.data
  const bytes = await downloadBytes(ctx.storage, path)
  if (!bytes) return reply(409, { error: 'The file has not been uploaded yet.', reason: 'upload_missing' })
  if (state === 'pending_upload') {
    if (bytes.length !== Number(declared) || bytes.length > MAX_FILE_BYTES) {
      await ctx.storage.remove([path]).catch(() => {})
      return reply(422, { error: 'The uploaded file does not match what was declared.', reason: 'object_size_mismatch' })
    }
    if (!(await looksLike(ext, bytes))) {
      await ctx.storage.remove([path]).catch(() => {})
      return reply(422, { error: 'The uploaded file is not a readable PDF or DOCX.', reason: 'object_type_invalid' })
    }
  }
  const fin = await ctx.rpc('admin_finalize_document', { p_actor: actor, p_version: versionId, p_sha256: sha256Hex(bytes), p_size: bytes.length })
  if (fin.reply) return fin.reply
  return reply(200, { versionId, state: 'proposed', alreadyFinalized: Boolean(fin.data.already) })
}

async function fileAccess(ctx, actor, paperId, versionId) {
  const acc = await ctx.rpc('admin_document_access', { p_actor: actor, p_paper: paperId, p_version: versionId })
  if (acc.reply) return acc.reply
  const { data, error } = await ctx.storage.createSignedUrl(acc.data.storage_path, SIGNED_URL_SECONDS)
  if (error || !data?.signedUrl) return reply(502, { error: 'The file could not be opened.', reason: 'file_unavailable' })
  // A short-lived, single-purpose link, returned only to the person who
  // asked (and logged as a file access by the database call above).
  return reply(200, { url: data.signedUrl, expiresIn: SIGNED_URL_SECONDS })
}

async function confidentialityGet(ctx, actor, root) {
  const me = await ctx.rpc('admin_context', { p_actor: actor })
  if (me.reply) return me.reply
  const versionId = me.data.confidentiality_version_id
  const loaded = versionId ? loadConfidentiality(versionId, root) : null
  if (versionId && !loaded) return reply(503, { error: 'The confidentiality text is unavailable.', reason: 'confidentiality_unavailable' })
  return reply(200, {
    required: me.data.confidentiality_required, acknowledged: me.data.acknowledged, acknowledgedAt: me.data.acknowledged_at,
    version: loaded ? { id: loaded.id, label: loaded.versionLabel, date: loaded.versionDate, texts: loaded.texts } : null,
  })
}

async function confidentialityAcknowledge(ctx, actor, b, root) {
  const me = await ctx.rpc('admin_context', { p_actor: actor })
  if (me.reply) return me.reply
  if (!me.data.confidentiality_version_id) return reply(409, { error: 'No confidentiality text is active.', reason: 'no_active_version' })
  if (b.versionId !== me.data.confidentiality_version_id) return reply(409, { error: 'The text changed. Please read the current version.', reason: 'version_changed' })
  const loaded = loadConfidentiality(b.versionId, root)
  if (!loaded) return reply(503, { error: 'The confidentiality text is unavailable.', reason: 'confidentiality_unavailable' })
  // The hash is of the text THIS server served, not one the browser names.
  return simple(ctx, 'admin_acknowledge_confidentiality', { p_actor: actor, p_language: b.language, p_sha256: loaded.texts[b.language].sha256 })
}

// ---------------------------------------------------------------------------
// The route table.
// ---------------------------------------------------------------------------
const FORBIDDEN = () => reply(403, { error: 'The request was refused.', reason: 'forbidden' })

const ROUTES = [
  ['GET', ['me'], null, (c, a) => simple(c, 'admin_context', { p_actor: a })],
  // Staff activity is not counted on public pages (Phase 3 M6). The
  // database confirms the caller is active staff; the route then sets a
  // cookie that THIS server signs. Nothing the browser claims is trusted.
  ['POST', ['metrics-exclusion'], {}, async (c, a) => {
    const me = await c.rpc('admin_context', { p_actor: a })
    if (me.reply) return me.reply
    return reply(200, { ok: true, excludeUser: a })
  }],
  ['GET', ['confidentiality'], null, (c, a, p, q, b, d) => confidentialityGet(c, a, d.root)],
  ['POST', ['confidentiality', 'acknowledge'], { versionId: req(v.text(100)), language: req(v.oneOf(['en', 'ar'])) },
    (c, a, p, q, b, d) => confidentialityAcknowledge(c, a, b, d.root)],

  ['GET', ['queue'], null, (c, a, p, q) => {
    const allowed = ['status', 'institution', 'confirmed', 'mine', 'q', 'limit', 'offset']
    const filters = {}
    for (const k of allowed) if (q[k] !== undefined && q[k] !== '') filters[k] = q[k]
    if (filters.mine !== undefined) filters.mine = filters.mine === 'true'
    for (const k of ['limit', 'offset']) if (filters[k] !== undefined) filters[k] = Number(filters[k])
    if (['limit', 'offset'].some((k) => filters[k] !== undefined && !Number.isInteger(filters[k]))) return reply(400, { error: 'The request is not valid.', reason: 'invalid_field' })
    return simple(c, 'admin_queue', { p_actor: a, p_filters: filters })
  }],
  ['GET', ['reviews', ':id'], null, async (c, a, p, q, b, d) => {
    const r = await c.rpc('admin_review_detail', { p_actor: a, p_paper: p.id })
    if (r.reply) return r.reply
    // A link to the public page only while the public site is on AND the
    // record is public right now. Approval alone publishes nothing.
    let publicUrl = null
    if (isPublicEnabled(d.env) && r.data?.viewer_role === 'administrator' && r.data?.eligibility?.record_public) {
      const l = await c.rpc('admin_public_link', { p_actor: a, p_paper: p.id })
      if (!l.reply && l.data?.public_id) publicUrl = recordUrl(l.data.public_id, d.env) || `/research/${l.data.public_id}`
    }
    return reply(200, { ...r.data, public_url: publicUrl, public_site_enabled: isPublicEnabled(d.env) })
  }],
  ['GET', ['reviews', ':id', 'eligibility'], null, (c, a, p) => simple(c, 'admin_eligibility_preview', { p_actor: a, p_paper: p.id })],

  ['POST', ['reviews', ':id', 'decision'],
    { decision: req(v.oneOf(DECISIONS)), reason: opt(v.textOrNull(2000)), expectedRevision: opt(v.textOrNull(128)), disseminationVersionId: opt(v.uuidOrNull) },
    (c, a, p, q, b) => simple(c, 'admin_decide', { p_actor: a, p_paper: p.id, p_decision: b.decision, p_reason: b.reason, p_expected_revision: b.expectedRevision, p_dissemination: b.disseminationVersionId })],
  ['POST', ['reviews', ':id', 'notes'], { body: req(v.text(5000)) },
    (c, a, p, q, b, d) => simple(c, 'admin_add_note', { p_actor: a, p_paper: p.id, p_body: b.body }, 201)],
  ['POST', ['reviews', ':id', 'recommendation'], { recommendation: req(v.oneOf(RECOMMENDATIONS)), reason: req(v.text(2000)) },
    (c, a, p, q, b) => simple(c, 'admin_recommend', { p_actor: a, p_paper: p.id, p_recommendation: b.recommendation, p_reason: b.reason }, 201)],
  ['POST', ['reviews', ':id', 'issues'], { kind: req(v.oneOf(ISSUE_KINDS)), description: req(v.text(2000)), blocking: opt(v.bool) },
    (c, a, p, q, b) => simple(c, 'admin_raise_issue', { p_actor: a, p_paper: p.id, p_kind: b.kind, p_description: b.description, p_blocking: b.blocking ?? true }, 201)],
  ['POST', ['reviews', ':id', 'issues', ':issue', 'resolve'], { resolution: req(v.text(2000)) },
    (c, a, p, q, b) => (UUID.test(p.issue) ? simple(c, 'admin_resolve_issue', { p_actor: a, p_paper: p.id, p_issue: p.issue, p_resolution: b.resolution }) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'issue' }))],
  ['POST', ['reviews', ':id', 'assignments'], { volunteerId: req(v.uuid) },
    (c, a, p, q, b) => simple(c, 'admin_assign', { p_actor: a, p_paper: p.id, p_volunteer: b.volunteerId }, 201)],
  ['POST', ['reviews', ':id', 'assignments', ':volunteer', 'end'], {},
    (c, a, p) => (UUID.test(p.volunteer) ? simple(c, 'admin_unassign', { p_actor: a, p_paper: p.id, p_volunteer: p.volunteer }) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'volunteer' }))],
  ['POST', ['reviews', ':id', 'institution'], { institutionId: opt(v.uuidOrNull), unitId: opt(v.uuidOrNull), none: opt(v.bool) },
    (c, a, p, q, b) => simple(c, 'admin_set_paper_institution', { p_actor: a, p_paper: p.id, p_institution: b.institutionId, p_unit: b.unitId, p_none: b.none === true })],
  ['POST', ['reviews', ':id', 'legacy-setting'], { setting: req(v.oneOf(LEGACY_SETTINGS)), note: req(v.text(2000)) },
    (c, a, p, q, b) => simple(c, 'admin_set_legacy_setting', { p_actor: a, p_paper: p.id, p_setting: b.setting, p_note: b.note })],
  ['POST', ['reviews', ':id', 'authority'], { verified: req(v.bool), note: opt(v.textOrNull(2000)) },
    (c, a, p, q, b) => simple(c, 'admin_record_authority', { p_actor: a, p_paper: p.id, p_verified: b.verified, p_note: b.note })],
  ['POST', ['reviews', ':id', 'embargo'], { until: opt(v.dateOrNull), note: opt(v.textOrNull(2000)) },
    (c, a, p, q, b) => simple(c, 'admin_set_embargo', { p_actor: a, p_paper: p.id, p_until: b.until, p_note: b.note })],

  ['POST', ['reviews', ':id', 'documents'],
    { origin: req(v.oneOf(['original_reviewed', 'redacted_copy'])), note: opt(v.textOrNull(2000)), redactionNote: opt(v.textOrNull(2000)),
      file: opt((f) => (f && typeof f === 'object' && !Array.isArray(f) && Object.keys(f).every((k) => ['name', 'size', 'type'].includes(k)) ? f : undefined)) },
    (c, a, p, q, b) => createDocument(c, a, p.id, b)],
  ['POST', ['reviews', ':id', 'documents', ':version', 'finalize'], {},
    (c, a, p) => (UUID.test(p.version) ? finalizeDocument(c, a, p.version) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'version' }))],
  ['POST', ['reviews', ':id', 'documents', ':version', 'withdraw'], { reason: req(v.text(2000)) },
    (c, a, p, q, b) => (UUID.test(p.version) ? simple(c, 'admin_withdraw_document', { p_actor: a, p_version: p.version, p_reason: b.reason }) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'version' }))],
  ['POST', ['reviews', ':id', 'files', 'access'], { versionId: opt(v.uuidOrNull) },
    (c, a, p, q, b) => fileAccess(c, a, p.id, b.versionId)],

  ['GET', ['staff'], null, (c, a) => simple(c, 'admin_list_staff', { p_actor: a })],
  ['POST', ['staff'], { userId: opt(v.uuidOrNull), email: opt(v.textOrNull(254)), role: req(v.oneOf(['administrator', 'volunteer'])), active: opt(v.bool) },
    async (c, a, p, q, b) => {
      // Authorize BEFORE touching the account directory: a caller who is not
      // an active administrator gets the same refusal whatever email or id
      // they asked about, and no privileged lookup happens on their behalf.
      // admin_set_staff re-checks the role on the mutation itself.
      const me = await c.rpc('admin_context', { p_actor: a })
      if (me.reply) return me.reply.status === 403 ? FORBIDDEN() : me.reply
      if (me.data?.role !== 'administrator') return FORBIDDEN()
      if (!b.userId === !b.email) return reply(400, { error: 'Give either a user id or an email address.', reason: 'invalid_field', field: 'userId' })
      const id = await findUserId(c.supabase, b)
      if (id === undefined) return reply(503, { error: 'The account directory is unavailable.', reason: 'auth_unavailable' })
      if (id === null) return reply(404, { error: 'No account has that email address.', reason: 'user_not_found' })
      return simple(c, 'admin_set_staff', { p_actor: a, p_user: id, p_role: b.role, p_active: b.active ?? true })
    }],

  ['GET', ['institutions'], null, (c, a) => simple(c, 'admin_list_institutions', { p_actor: a })],
  ['POST', ['institutions'],
    { slug: req(v.text(60, 2)), nameEn: req(v.text(300)), nameAr: opt(v.textOrNull(300)), kind: opt(v.oneOf(['university', 'research_center', 'agency', 'other'])),
      country: opt(v.textOrNull(2)), sourceUrl: opt(v.textOrNull(500)), sourceRetrievedOn: opt(v.dateOrNull), sourceNote: opt(v.textOrNull(1000)) },
    (c, a, p, q, b) => simple(c, 'admin_create_institution', { p_actor: a, p: { slug: b.slug, name_en: b.nameEn, name_ar: b.nameAr, kind: b.kind, country: b.country, source_url: b.sourceUrl, source_retrieved_on: b.sourceRetrievedOn, source_note: b.sourceNote } }, 201)],
  ['POST', ['institutions', ':id', 'eligibility'], { eligible: req(v.bool), note: req(v.text(2000)) },
    (c, a, p, q, b) => (UUID.test(p.id) ? simple(c, 'admin_set_institution_eligibility', { p_actor: a, p_institution: p.id, p_eligible: b.eligible, p_note: b.note }) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'id' }))],
  ['POST', ['institutions', ':id', 'aliases'], { alias: req(v.text(300)), language: opt(v.oneOf(LANGS)) },
    (c, a, p, q, b) => (UUID.test(p.id) ? simple(c, 'admin_add_institution_alias', { p_actor: a, p_institution: p.id, p_alias: b.alias, p_language: b.language || 'other' }, 201) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'id' }))],
  ['POST', ['institutions', ':id', 'units'],
    { kind: opt(v.oneOf(['faculty', 'school', 'institute', 'college', 'department', 'center', 'other'])), nameEn: opt(v.textOrNull(300)), nameAr: opt(v.textOrNull(300)),
      parentUnitId: opt(v.uuidOrNull), sourceUrl: opt(v.textOrNull(500)), sourceRetrievedOn: opt(v.dateOrNull), sourceNote: opt(v.textOrNull(1000)) },
    (c, a, p, q, b) => (UUID.test(p.id) ? simple(c, 'admin_add_unit', { p_actor: a, p: { institution_id: p.id, kind: b.kind || 'faculty', name_en: b.nameEn, name_ar: b.nameAr, parent_unit_id: b.parentUnitId, source_url: b.sourceUrl, source_retrieved_on: b.sourceRetrievedOn, source_note: b.sourceNote } }, 201) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'id' }))],
  ['POST', ['units', ':id', 'verify'], { sourceUrl: req(v.text(500)), retrievedOn: req((x) => v.dateOrNull(x) || undefined), note: opt(v.textOrNull(1000)) },
    (c, a, p, q, b) => (UUID.test(p.id) ? simple(c, 'admin_verify_unit', { p_actor: a, p_unit: p.id, p_source_url: b.sourceUrl, p_retrieved_on: b.retrievedOn, p_note: b.note }) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'id' }))],
  ['POST', ['units', ':id', 'aliases'], { alias: req(v.text(300)), language: opt(v.oneOf(LANGS)) },
    (c, a, p, q, b) => (UUID.test(p.id) ? simple(c, 'admin_add_unit_alias', { p_actor: a, p_unit: p.id, p_alias: b.alias, p_language: b.language || 'other' }, 201) : reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'id' }))],
]

function matchRoute(method, segments) {
  for (const [m, pattern, spec, run] of ROUTES) {
    if (m !== method || pattern.length !== segments.length) continue
    const params = {}
    let good = true
    for (let i = 0; i < pattern.length; i++) {
      if (pattern[i].startsWith(':')) params[pattern[i].slice(1)] = segments[i]
      else if (pattern[i] !== segments[i]) { good = false; break }
    }
    if (good) return { spec, run, params }
  }
  return null
}

// { method, segments (the path after /api/admin), query, body, bodyError,
//   token, supabase, storage, env, getUser, root, log }
async function handleAdmin({ method, segments, query = {}, body, bodyError = false, token, supabase, storage, env = process.env, getUser, root, log = console }) {
  if (!isEnabled(env)) return reply(404, { error: 'Not available.', reason: 'not_available' })
  const actor = await authenticate(token, getUser || ((t) => supabase.auth.getUser(t)))
  // Every admin route answers an anonymous caller the same way, whether or
  // not it exists.
  if (!actor) return reply(401, { error: 'Sign in to continue.', reason: 'unauthenticated' })

  const route = matchRoute(method, segments)
  if (!route) return reply(404, { error: 'Not found.', reason: 'not_found' })
  // Ids in the path are UUIDs or the request is malformed.
  if (route.params.id !== undefined && !UUID.test(route.params.id)) return reply(400, { error: 'The request is not valid.', reason: 'invalid_field', field: 'id' })

  let parsed = { value: {} }
  if (route.spec) {
    if (bodyError) return reply(400, { error: 'The request is not valid.', reason: 'invalid_body' })
    parsed = parse(body ?? {}, route.spec)
    if (parsed.error) return badInput(parsed)
  }
  const ctx = makeContext({ supabase, storage, log })
  try {
    return await route.run(ctx, actor, route.params, query, parsed.value, { root, env })
  } catch (err) {
    log.error(JSON.stringify({ stage: 'admin_request_failed', name: err?.name || 'Error' }))
    return reply(500, { error: 'Something went wrong on our side.', reason: 'internal' })
  }
}

module.exports = { handleAdmin, isEnabled, authenticate, ROUTES, matchRoute }
