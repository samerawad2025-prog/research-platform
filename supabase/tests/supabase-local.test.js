#!/usr/bin/env node
//
// Phase 3 M2A against a REAL local Supabase stack: Supabase's Postgres
// image, PostgREST and the Storage API, reached through supabase-js
// exactly as the application reaches them. Never a hosted project, never
// production credentials; synthetic documents only.
//
// Start the stack first (supabase/tests/local-stack/start.sh), which
// writes the local URL, keys and JWT secret to $SB_DIR (default
// /var/tmp/sb). Then:  node supabase/tests/supabase-local.test.js
//
// What this covers that the psql-based tests cannot: the service role
// through PostgREST, anon/authenticated through PostgREST, and the real
// Storage API's signed-upload behaviour (path binding, upsert, expiry,
// privacy).

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const { PDFDocument } = require('pdf-lib')

const ROOT = path.join(__dirname, '../..')
const { handleTerms, handleCreateIntent, handleFinalize, cleanupAbandonedIntents } = require(path.join(ROOT, 'lib/submission/acceptanceHandlers'))

const SB_DIR = process.env.SB_DIR || '/var/tmp/sb'
const URL = process.env.SUPABASE_LOCAL_URL || 'http://127.0.0.1:54321'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(URL)) throw new Error('local stack only')
const keys = JSON.parse(fs.readFileSync(path.join(SB_DIR, 'keys.json'), 'utf8'))
const JWT_SECRET = fs.readFileSync(path.join(SB_DIR, 'jwt_secret'), 'utf8').trim()
const DB_CONTAINER = process.env.SB_DB_CONTAINER || 'sb-db'

const opts = { auth: { persistSession: false, autoRefreshToken: false } }
const service = createClient(URL, keys.service, opts)
const anon = createClient(URL, keys.anon, opts)
const authed = createClient(URL, keys.authenticated, opts)
const bucket = service.storage.from('papers')

function sql(text) {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=localtestpw', DB_CONTAINER, 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim()
}
const lit = (v) => (v === null ? 'null' : `'${String(v).replace(/'/g, "''")}'`)

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok     ${name}`)
  } catch (err) {
    console.error(`FAIL   ${name} — ${err.stack || err.message}`)
    failed++
  }
}

const SECRET = crypto.randomBytes(32).toString('hex')
const ENV = { SUBMISSION_ACCEPTANCE_FLOW: 'enabled', SUBMISSION_TOKEN_SECRET: SECRET, EXTRACTION_MODE: 'automatic' }
const quiet = { log() {}, warn() {}, error() {} }
let ip = 0
const nextIp = () => `192.0.2.${++ip % 250}`
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex')

async function pdf(text) {
  const d = await PDFDocument.create()
  d.addPage().drawText(text, { x: 50, y: 700 })
  return Buffer.from(await d.save())
}
const asFile = (bytes) => new Blob([bytes], { type: 'application/pdf' })

async function intent(bytes, over = {}) {
  const terms = await handleTerms({ env: ENV, supabase: service, clientKey: nextIp() })
  assert.strictEqual(terms.status, 200, JSON.stringify(terms.body))
  const r = await handleCreateIntent({
    body: { offerToken: terms.body.offer.token, agreementId: 'submission-terms-2026-09-25-en', accepted: true, publicationSetting: 'record_abstract', claimedRole: 'author', fullName: 'Synthetic Local', email: 'local@example.invalid', file: { name: 'thesis.pdf', size: bytes.length, type: 'application/pdf' }, ...over },
    env: ENV, supabase: service, storage: bucket, clientKey: nextIp(), log: quiet,
  })
  assert.strictEqual(r.status, 201, JSON.stringify(r.body))
  return r
}
// What the browser does: the anon client, the returned path and token.
const browserUpload = (r, bytes, pathOverride, uploadOpts) =>
  anon.storage.from('papers').uploadToSignedUrl(pathOverride || r.body.upload.path, r.body.upload.token, asFile(bytes), uploadOpts)
const finalize = (r) => handleFinalize({ body: { intentId: r.body.intentId, intentToken: r.body.intentToken }, env: ENV, supabase: service, storage: bucket, clientKey: nextIp(), log: quiet })
const acceptance = (id) => JSON.parse(sql(`select to_jsonb(a) from submission_acceptances a where id = ${lit(id)}`))
async function stored(p) {
  const { data, error } = await bucket.download(p)
  return error ? null : Buffer.from(await data.arrayBuffer())
}
function resign(token, patch) {
  const [, payload] = token.split('.')
  const p = { ...JSON.parse(Buffer.from(payload, 'base64url').toString()), ...patch }
  const h = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const b = Buffer.from(JSON.stringify(p)).toString('base64url')
  return `${h}.${b}.${crypto.createHmac('sha256', JWT_SECRET).update(`${h}.${b}`).digest('base64url')}`
}

async function main() {
  sql(`update agreement_versions set active = true; update extraction_policy set mode = 'automatic', changed_at = now();`)

  await check('service role: the handlers reach every new function through PostgREST', async () => {
    const bytes = await pdf('service role')
    const r = await intent(bytes)
    assert.strictEqual(r.body.processing.decision, 'automatic')
    assert.strictEqual((await browserUpload(r, bytes)).error, null)
    const f = await finalize(r)
    assert.strictEqual(f.status, 200, JSON.stringify(f.body))
    const a = acceptance(r.body.intentId)
    assert.strictEqual(a.status, 'finalized')
    assert.strictEqual(a.object_sha256, sha(bytes))
    const res = await cleanupAbandonedIntents({ supabase: service, storage: bucket, limit: 5, log: quiet })
    assert.ok(!res.error, 'expire_submission_intents and mark_submission_object_removed callable')
  })

  // The lifetime is Storage configuration (UPLOAD_SIGNED_URL_EXPIRATION_TIME;
  // self-hosted default 60 s, hosted Supabase documents 2 hours), not a
  // constant - which is why the server reads it from the token.
  await check('real Storage: the upload authorization\'s own expiry is what is recorded', async () => {
    const r = await intent(await pdf('lifetime'))
    const exp = JSON.parse(Buffer.from(r.body.upload.token.split('.')[1], 'base64url').toString()).exp
    const lifetime = exp - Math.floor(Date.now() / 1000)
    if (process.env.SB_EXPECT_UPLOAD_TTL) assert.ok(Math.abs(lifetime - Number(process.env.SB_EXPECT_UPLOAD_TTL)) < 120, `authorization lifetime ${lifetime}s`)
    const a = acceptance(r.body.intentId)
    assert.strictEqual(Date.parse(a.upload_authorization_expires_at), exp * 1000)
    console.log(`       (authorization lifetime ${lifetime}s; intent ${Math.round((Date.parse(a.expires_at) - Date.now()) / 1000)}s)`)
  })

  await check('anon and authenticated: no protected function, no acceptance/limit/agreement table', async () => {
    const r = await intent(await pdf('access'))
    const calls = [
      ['consume_submission_rate_limit', { p_key: 'k', p_limit: 1000, p_window_seconds: 60 }],
      ['create_submission_intent', { p_intent_token_hash: 'a'.repeat(64), p_agreement_version_id: 'submission-terms-2026-09-25-en', p_agreement_language: 'en', p_agreement_sha256: 'x', p_claimed_role: 'author', p_publication_setting: 'record_abstract', p_processing_mode: 'automatic', p_full_name: 'n', p_email: 'e@example.invalid', p_whatsapp_number: null, p_file_extension: 'pdf', p_declared_size: 10, p_ttl_seconds: 60, p_offer_decision: 'automatic', p_offer_issued_at: new Date().toISOString() }],
      ['get_submission_intent', { p_intent_id: r.body.intentId, p_intent_token_hash: 'x' }],
      ['finalize_submission_intent', { p_intent_id: r.body.intentId, p_intent_token_hash: 'x', p_object_size: 1, p_object_sha256: 'x', p_confirmation_token_hash: 'x' }],
      ['expire_submission_intents', { p_limit: 100, p_margin_seconds: 0 }],
      ['mark_submission_object_removed', { p_intent_id: r.body.intentId }],
      ['record_upload_authorization', { p_intent_id: r.body.intentId, p_expires_at: new Date(0).toISOString() }],
      ['record_declared_authors', { p_intent_id: r.body.intentId, p_authors: ['x'] }],
    ]
    for (const [who, client] of [['anon', anon], ['authenticated', authed]]) {
      for (const [fn, args] of calls) {
        const { error } = await client.rpc(fn, args)
        assert.ok(error, `${who} could call ${fn}`)
      }
      for (const table of ['submission_acceptances', 'agreement_versions', 'submission_rate_limits', 'extraction_policy', 'papers', 'researchers']) {
        const { data, error } = await client.from(table).select('*').limit(1)
        assert.ok(error || (Array.isArray(data) && data.length === 0), `${who} read ${table}`)
      }
    }
    const a = acceptance(r.body.intentId)
    assert.strictEqual(a.status, 'open', 'nothing changed')
    assert.ok(a.upload_authorization_expires_at && Date.parse(a.upload_authorization_expires_at) > Date.now())
  })

  await check('real Storage: an authorization uploads only to its own path', async () => {
    const bytes = await pdf('path')
    const a = await intent(bytes)
    const b = await intent(bytes)
    assert.ok((await browserUpload(b, bytes, a.body.upload.path)).error, 'B\'s token at A\'s path')
    assert.ok((await browserUpload(a, bytes, 'legacy-elsewhere.pdf')).error, 'A\'s token at an arbitrary path')
    assert.ok((await browserUpload(a, bytes, a.body.upload.path.replace('.pdf', '.docx'))).error, 'A\'s token at a sibling path')
    assert.strictEqual(await stored(a.body.upload.path), null)
    const [h, p] = a.body.upload.token.split('.')
    const forgedNoSecret = `${h}.${Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url').toString()), url: `papers/${b.body.upload.path}` })).toString('base64url')}.${a.body.upload.token.split('.')[2]}`
    assert.ok((await anon.storage.from('papers').uploadToSignedUrl(b.body.upload.path, forgedNoSecret, asFile(bytes))).error, 'a token edited without the secret')
  })

  await check('real Storage: upsert:false - an existing object, finalized or not, cannot be replaced with the authorization', async () => {
    const bytes = await pdf('original')
    const r = await intent(bytes)
    assert.strictEqual((await browserUpload(r, bytes)).error, null)
    const other = await pdf('replacement')
    assert.ok((await browserUpload(r, other)).error, 'second upload before finalize')
    assert.ok((await browserUpload(r, other, undefined, { upsert: true })).error, 'asking the client for upsert does not help')
    const f = await finalize(r)
    assert.strictEqual(f.status, 200)
    assert.ok((await browserUpload(r, other)).error, 'after finalize')
    assert.ok((await browserUpload(r, other, undefined, { upsert: true })).error, 'after finalize, upsert asked')
    assert.strictEqual(sha(await stored(r.body.upload.path)), sha(bytes), 'finalized bytes unchanged')
  })

  await check('real Storage: an expired authorization is refused; intent expiry alone does not revoke one', async () => {
    const bytes = await pdf('expiry')
    const r = await intent(bytes)
    const expired = resign(r.body.upload.token, { exp: Math.floor(Date.now() / 1000) - 5 })
    const e = await anon.storage.from('papers').uploadToSignedUrl(r.body.upload.path, expired, asFile(bytes))
    assert.ok(e.error, 'expired authorization refused')
    // The finding, on real Storage: expire the intent, the real token still uploads.
    sql(`update submission_acceptances set expires_at = now() - interval '3 hours' where id = ${lit(r.body.intentId)}`)
    await cleanupAbandonedIntents({ supabase: service, storage: bucket, limit: 100, log: quiet })
    assert.strictEqual(acceptance(r.body.intentId).status, 'expired')
    assert.strictEqual((await browserUpload(r, bytes)).error, null, 'still uploads after intent expiry')
    await cleanupAbandonedIntents({ supabase: service, storage: bucket, limit: 100, log: quiet })
    assert.ok(await stored(r.body.upload.path), 'cleanup waits for the authorization')
    assert.strictEqual((await finalize(r)).status, 410, 'but it can never be finalized')
  })

  await check('real Storage: cleanup removes an abandoned object only after its authorization + margin, never a finalized or unrelated one', async () => {
    const bytes = await pdf('cleanup')
    const gone = await intent(bytes)
    await browserUpload(gone, bytes)
    const kept = await intent(bytes)
    await browserUpload(kept, bytes)
    assert.strictEqual((await finalize(kept)).status, 200)
    const unrelated = [`legacy-${crypto.randomUUID()}.pdf`, `intents/${crypto.randomUUID()}/elsewhere.pdf`]
    for (const n of unrelated) assert.strictEqual((await bucket.upload(n, asFile(bytes))).error, null)
    sql(`update submission_acceptances set expires_at = now() - interval '5 hours', upload_authorization_expires_at = now() - interval '61 minutes'
         where id in (${lit(gone.body.intentId)}, ${lit(kept.body.intentId)})`)
    await cleanupAbandonedIntents({ supabase: service, storage: bucket, limit: 100, log: quiet })
    assert.strictEqual(await stored(gone.body.upload.path), null, 'abandoned object removed from real Storage')
    assert.ok(acceptance(gone.body.intentId).object_removed_at)
    assert.ok(await stored(kept.body.upload.path), 'finalized kept')
    for (const n of unrelated) assert.ok(await stored(n), `unrelated kept: ${n}`)
  })

  await check('real Storage + PostgREST: concurrent upload and finalization, then retry, give exactly one paper', async () => {
    const bytes = await pdf('concurrent')
    const r = await intent(bytes)
    const results = await Promise.all([finalize(r), browserUpload(r, bytes), finalize(r), finalize(r)])
    const fins = [results[0], results[2], results[3]]
    for (const f of fins) assert.ok([200, 409].includes(f.status), JSON.stringify(f.body))
    const retry = await finalize(r)
    assert.strictEqual(retry.status, 200)
    for (const f of fins.filter((x) => x.status === 200)) assert.strictEqual(f.body.confirmationToken, retry.body.confirmationToken)
    assert.strictEqual(Number(sql(`select count(*) from papers where submission_acceptance_id = ${lit(r.body.intentId)}`)), 1)
    console.log(`       (concurrent finalize statuses: ${fins.map((f) => f.status).join(', ')})`)
    // And concurrent finalization with the object in place.
    const b2 = await pdf('concurrent 2')
    const r2 = await intent(b2)
    assert.strictEqual((await browserUpload(r2, b2)).error, null)
    const many = await Promise.all([finalize(r2), finalize(r2), finalize(r2), finalize(r2)])
    assert.ok(many.every((f) => f.status === 200))
    assert.strictEqual(many.filter((f) => f.body.alreadyFinalized === false).length, 1)
    assert.strictEqual(new Set(many.map((f) => f.body.confirmationToken)).size, 1)
    assert.strictEqual(Number(sql(`select count(*) from papers where submission_acceptance_id = ${lit(r2.body.intentId)}`)), 1)
  })

  await check('bucket stays private; the old anonymous upload path is still open (closed at cutover, not by M2A)', async () => {
    const bytes = await pdf('privacy')
    const r = await intent(bytes)
    await browserUpload(r, bytes)
    const { error } = await anon.storage.from('papers').download(r.body.upload.path)
    assert.ok(error, 'anon cannot read')
    const legacy = await anon.storage.from('papers').upload(`${crypto.randomUUID()}.pdf`, asFile(bytes))
    assert.strictEqual(legacy.error, null, 'documented: the old path is open until cutover')
  })

  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll M2A real Supabase (PostgREST + Storage API) checks passed.')
}

main()
