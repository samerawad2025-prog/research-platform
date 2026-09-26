#!/usr/bin/env node
//
// Phase 3 M2A against a REAL, disposable local Postgres (never a Supabase
// project), with a storage substitute (pg-adapter.js). Run by
// supabase/tests/run-0012.sh. Synthetic data only; no network.

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { PDFDocument } = require('pdf-lib')
const JSZip = require('jszip')

const ROOT = path.join(__dirname, '../..')
const { makePsql, lit, pgClient, fakeStorage } = require('./pg-adapter')
const { handleTerms, handleCreateIntent, handleFinalize, cleanupAbandonedIntents } = require(path.join(ROOT, 'lib/submission/acceptanceHandlers'))
const { handleExtract } = require(path.join(ROOT, 'lib/extraction/extractHandler'))
const { runExtraction } = require(path.join(ROOT, 'lib/extraction/orchestrator'))

const DB = 'm2a_submission_test'
const BASE_REF = process.env.BASE_REF || 'origin/research-platform'
const { psql, sqlOk, json } = makePsql(DB)

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

const network = []
global.fetch = async (url) => { network.push(String(url)); throw new Error('network is not allowed in this test') }

const SECRET = crypto.randomBytes(32).toString('hex')
const ENV = (mode) => ({ SUBMISSION_ACCEPTANCE_FLOW: 'enabled', SUBMISSION_TOKEN_SECRET: SECRET, ...(mode === undefined ? {} : { EXTRACTION_MODE: mode }) })

function logCapture() {
  const lines = []
  const push = (...a) => lines.push(a.join(' '))
  return { lines, log: push, warn: push, error: push }
}

function setup() {
  execFileSync('dropdb', ['--if-exists', DB])
  execFileSync('createdb', [DB])
  const run = (file) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  run(path.join(__dirname, 'supabase-stubs.sql'))
  const tmp = path.join(os.tmpdir(), 'm2a-pre-schema.sql')
  fs.writeFileSync(tmp, execFileSync('git', ['show', `${BASE_REF}:supabase/schema.sql`], { cwd: ROOT, encoding: 'utf8' }))
  run(tmp)
  // A pre-existing, confirmed, old-path paper: must survive untouched.
  sqlOk(`insert into researchers (id, full_name, email) values ('00000000-0000-0000-0000-000000000001', 'Legacy Submitter', 'legacy@example.invalid');
         insert into papers (id, file_path, permission_to_process, publication_scope, submitted_by, extraction_status, metadata_confirmed_at, title, confirmation_token_hash)
         values ('00000000-0000-0000-0000-0000000000aa', 'legacy.pdf', true, '{full_paper}', '00000000-0000-0000-0000-000000000001', 'completed', now(), 'Legacy thesis',
                 encode(sha256('legacy-token'::bytea), 'hex'));`)
  run(path.join(ROOT, 'supabase/migrations/0011_manual_entry.sql'))
  run(path.join(ROOT, 'supabase/migrations/0012_submission_acceptance.sql'))
  run(path.join(ROOT, 'supabase/migrations/0012_submission_acceptance.sql')) // idempotent
}

async function pdfBytes(text = 'Synthetic thesis') {
  const d = await PDFDocument.create()
  d.addPage().drawText(text, { x: 50, y: 700 })
  return Buffer.from(await d.save())
}
async function docxBytes() {
  const z = new JSZip()
  z.file('[Content_Types].xml', '<Types/>')
  z.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Synthetic</w:t></w:r></w:p></w:body></w:document>')
  return z.generateAsync({ type: 'nodebuffer' })
}

function body(over = {}) {
  return {
    agreementId: 'submission-terms-2026-09-25-en',
    accepted: true,
    publicationSetting: 'record_abstract',
    claimedRole: 'author',
    fullName: 'Synthetic Researcher',
    email: 'synthetic@example.invalid',
    file: { name: 'thesis.pdf', size: 0, type: 'application/pdf' },
    ...over,
  }
}

let ip = 0
const nextIp = () => `198.51.100.${++ip % 250}`

async function main() {
  setup()
  const storage = fakeStorage()
  const supabase = pgClient({ psql }, { storage })
  const setPolicy = (mode) => sqlOk(`update extraction_policy set mode = ${lit(mode)}, changed_at = now()`)
  const activate = (on = true) => sqlOk(`update agreement_versions set active = ${on}`)

  async function submit(opts = {}) {
    // 'mode' present but undefined means "EXTRACTION_MODE unset", so no default.
    const mode = 'mode' in opts ? opts.mode : 'automatic'
    const { bytes, name = 'thesis.pdf', type = 'application/pdf', over = {}, clientKey = nextIp(), log } = opts
    const b = bytes || (await pdfBytes())
    const r = await handleCreateIntent({ body: body({ file: { name, size: b.length, type }, ...over }), env: ENV(mode), supabase, storage, clientKey, log })
    return { r, bytes: b }
  }
  async function upload(r, bytes) {
    return storage.uploadWithToken(r.body.upload.path, r.body.upload.token, bytes)
  }
  const finalize = (r, env = ENV('automatic'), clientKey = nextIp(), log) =>
    handleFinalize({ body: { intentId: r.body.intentId, intentToken: r.body.intentToken }, env, supabase, storage, clientKey, log })
  const paperOf = (intentId) => json(`select to_jsonb(p) from papers p where submission_acceptance_id = ${lit(intentId)}`)
  const acceptanceOf = (intentId) => json(`select to_jsonb(a) from submission_acceptances a where id = ${lit(intentId)}`)
  const count = (sql) => Number(sqlOk(sql))
  const legacyBefore = json(`select to_jsonb(p) from papers p where id = '00000000-0000-0000-0000-0000000000aa'`)

  const mockProvider = { sent: [], extractMetadata: async ({ pass }) => { mockProvider.sent.push(pass); return { provider: 'fake', model: 'fake', result: { document_type: 'thesis', title: { status: 'found', value: 'Found' } } } } }
  const extract = (token, mode) =>
    handleExtract({ token, env: { EXTRACTION_MODE: mode, AI_PROVIDER: 'mock' }, getSupabaseAdmin: () => supabase, getProvider: () => mockProvider, runExtraction, log: logCapture() })

  // ------------------------------------------------------------ gating
  await check('inert by default: flow disabled, agreement inactive, secret required', async () => {
    const off = await handleCreateIntent({ body: body(), env: {}, supabase, storage, clientKey: nextIp() })
    assert.strictEqual(off.status, 404)
    const weak = await handleCreateIntent({ body: body(), env: { SUBMISSION_ACCEPTANCE_FLOW: 'enabled', SUBMISSION_TOKEN_SECRET: 'short' }, supabase, storage, clientKey: nextIp() })
    assert.strictEqual(weak.status, 503)
    const terms = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    assert.strictEqual(terms.body.available, false, 'seeded agreements are inactive')
    const { r } = await submit()
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.reason, 'agreement_not_active')
    assert.strictEqual(count('select count(*) from submission_acceptances'), 0)
  })

  activate(true)

  // ------------------------------------------------------------ acceptance
  await check('acceptance: missing, false, stringly and forged acceptances are refused and write nothing', async () => {
    const before = count('select count(*) from submission_acceptances')
    const cases = [
      [{ accepted: undefined }, 'acceptance_required'],
      [{ accepted: false }, 'acceptance_required'],
      [{ accepted: 'true' }, 'acceptance_required'],
      [{ accepted: 1 }, 'acceptance_required'],
      [{ agreementId: 'submission-terms-2019-01-01-en' }, 'agreement_unknown'],
      [{ agreementId: undefined }, 'agreement_unknown'],
      [{ agreementSha256: '0'.repeat(64) }, 'unexpected_field'],
      [{ agreementText: 'I agree to anything' }, 'unexpected_field'],
      [{ acceptedAt: '2020-01-01T00:00:00Z' }, 'unexpected_field'],
      [{ publicationSetting: 'full_paper' }, 'publication_setting_invalid'],
      [{ publicationSetting: undefined }, 'publication_setting_invalid'],
      [{ processingDecision: 'automatic' }, 'unexpected_field'],
      [{ extractionMode: 'automatic' }, 'unexpected_field'],
      [{ objectPath: 'intents/x/y.pdf' }, 'unexpected_field'],
      [{ claimedRole: 'owner' }, 'claimed_role_invalid'],
      [{ email: 'not-an-email' }, 'email_invalid'],
      [{ whatsapp: '12' }, 'whatsapp_invalid'],
    ]
    for (const [over, reason] of cases) {
      const r = await handleCreateIntent({ body: body({ ...over, file: { name: 'a.pdf', size: 100, type: 'application/pdf' } }), env: ENV('automatic'), supabase, storage, clientKey: nextIp() })
      assert.strictEqual(r.status, 400, JSON.stringify(over))
      assert.strictEqual(r.body.reason, reason, JSON.stringify(over))
    }
    assert.strictEqual(count('select count(*) from submission_acceptances'), before)
  })

  await check('acceptance: a database row whose hash differs from the application registry cannot be accepted', async () => {
    sqlOk(`update agreement_versions set content_sha256 = '${'1'.repeat(64)}' where id = 'submission-terms-2026-09-25-ar'`)
    const { r } = await submit({ over: { agreementId: 'submission-terms-2026-09-25-ar' } })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.reason, 'agreement_mismatch')
    const terms = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    assert.deepStrictEqual(terms.body.agreements.map((a) => a.language), ['en'], 'the tampered row is not offered')
    sqlOk(`update agreement_versions set content_sha256 = '54a78f8441426b5c2dd190235fb57cfaa0ae9e1a956d6aefb64ff0a13208795b' where id = 'submission-terms-2026-09-25-ar'`)
  })

  await check('file checks at acceptance: extension, declared type and size', async () => {
    for (const [file, reason] of [
      [{ name: 'thesis.doc', size: 10, type: 'application/msword' }, 'file_type_invalid'],
      [{ name: 'thesis.pdf', size: 10, type: 'text/plain' }, 'file_type_invalid'],
      [{ name: 'pdf', size: 10, type: 'application/pdf' }, 'file_type_invalid'],
      [{ name: 'thesis.pdf', size: 0, type: 'application/pdf' }, 'file_size_invalid'],
      [{ name: 'thesis.pdf', size: 20 * 1024 * 1024 + 1, type: 'application/pdf' }, 'file_size_invalid'],
      [{ name: 'thesis.pdf', size: 10.5, type: 'application/pdf' }, 'file_size_invalid'],
      [{ name: 'thesis.pdf', size: 10, type: 'application/pdf', path: 'intents/other' }, 'unexpected_field'],
    ]) {
      const r = await handleCreateIntent({ body: body({ file }), env: ENV('automatic'), supabase, storage, clientKey: nextIp() })
      assert.strictEqual(r.body.reason, reason, JSON.stringify(file))
    }
  })

  // ------------------------------------------------------------ happy path
  let happy
  await check('flow: accept -> upload -> finalize creates one paper bound to the acceptance and the document', async () => {
    setPolicy('automatic')
    const log = logCapture()
    const { r, bytes } = await submit({ mode: 'automatic', log, over: { whatsapp: '+249912345678' } })
    assert.strictEqual(r.status, 201, JSON.stringify(r.body))
    assert.strictEqual(r.body.processing.decision, 'automatic')
    assert.match(r.body.upload.path, /^intents\/[0-9a-f-]{36}\/[0-9a-f]{24}\.pdf$/)
    const a = acceptanceOf(r.body.intentId)
    assert.strictEqual(a.status, 'open')
    assert.strictEqual(a.agreement_sha256, '77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da')
    assert.strictEqual(a.identity_verified, false)
    assert.ok(Math.abs(Date.parse(a.accepted_at) - Date.now()) < 60_000, 'server time')
    assert.notStrictEqual(a.intent_token_hash, r.body.intentToken, 'only the hash is stored')
    assert.strictEqual((await upload(r, bytes)).error, null)
    const f = await finalize(r, ENV('automatic'), nextIp(), log)
    assert.strictEqual(f.status, 200, JSON.stringify(f.body))
    assert.strictEqual(f.body.alreadyFinalized, false)
    assert.strictEqual(f.body.extraction.mayStart, true)
    const p = paperOf(r.body.intentId)
    assert.strictEqual(p.file_path, r.body.upload.path)
    assert.strictEqual(p.file_sha256, crypto.createHash('sha256').update(bytes).digest('hex'))
    assert.strictEqual(p.publication_setting, 'record_abstract')
    assert.strictEqual(p.submission_extraction_policy, 'automatic')
    assert.strictEqual(p.submission_decision_source, 'server')
    assert.strictEqual(p.permission_to_process, false, 'the legacy checkbox is not claimed')
    assert.strictEqual(acceptanceOf(r.body.intentId).status, 'finalized')
    // The confirmation link works through the existing RPC; the bare id does not.
    const view = json(`select get_paper_for_confirmation(${lit(f.body.confirmationToken)})`)
    assert.strictEqual(view.paper_id, p.id)
    assert.strictEqual(json(`select get_paper_for_confirmation(${lit(p.id)})`), null)
    happy = { r, f, bytes, p, log }
  })

  await check('extraction runs only after finalization, and only as recorded', async () => {
    storage.objects.set(happy.r.body.upload.path, happy.bytes)
    mockProvider.sent = []
    const res = await extract(happy.f.body.confirmationToken, 'automatic')
    assert.strictEqual(res.status, 200, JSON.stringify(res.body))
    assert.ok(mockProvider.sent.length >= 1)
    // A second request does not start a second extraction.
    const again = await extract(happy.f.body.confirmationToken, 'automatic')
    assert.strictEqual(again.body.alreadyHandled, true)
  })

  // ------------------------------------------------------------ policy matrix
  await check('policy: automatic only when the application AND the policy row say so; unknown means manual', async () => {
    const rows = []
    for (const policy of ['automatic', 'manual']) {
      setPolicy(policy)
      for (const mode of ['automatic', 'manual', undefined, 'bogus']) {
        const { r, bytes } = await submit({ mode })
        await upload(r, bytes)
        const f = await finalize(r, ENV(mode))
        const expected = policy === 'automatic' && mode === 'automatic' ? 'automatic' : 'manual'
        rows.push([policy, String(mode), r.body.processing.decision, f.body.processing.decision])
        assert.strictEqual(r.body.processing.decision, expected, `${policy}/${mode}`)
        assert.strictEqual(paperOf(r.body.intentId).submission_extraction_policy, expected, `${policy}/${mode}`)
        const terms = await handleTerms({ env: ENV(mode), supabase, clientKey: nextIp() })
        assert.strictEqual(terms.body.processing.decision, expected, 'the preview agrees with the record')
      }
    }
    setPolicy('automatic')
  })

  await check('policy: a switch to manual between acceptance and finalization lowers the recorded decision; nothing raises it', async () => {
    setPolicy('automatic')
    const { r, bytes } = await submit({ mode: 'automatic' })
    setPolicy('manual')
    await upload(r, bytes)
    const f = await finalize(r)
    assert.strictEqual(f.body.processing.decision, 'manual')
    setPolicy('automatic')
    const { r: r2, bytes: b2 } = await submit({ mode: 'manual' })
    await upload(r2, b2)
    const f2 = await finalize(r2, ENV('automatic'))
    assert.strictEqual(f2.body.processing.decision, 'manual', 'finalizing under automatic does not raise it')
    assert.strictEqual(count(`select count(*) from papers where id = ${lit(paperOf(r2.body.intentId).id)} and submission_extraction_policy = 'manual'`), 1)
    sqlOk(`update papers set submission_extraction_policy = 'automatic', submission_decision_source = 'database_policy' where id = ${lit(paperOf(r2.body.intentId).id)}`)
    assert.strictEqual(paperOf(r2.body.intentId).submission_extraction_policy, 'manual', 'immutable')
  })

  await check('conflict: app manual + policy automatic, follow-up requests all fail, later automatic -> never extracted', async () => {
    setPolicy('automatic')
    const { r, bytes } = await submit({ mode: 'manual' })
    await upload(r, bytes)
    const f = await finalize(r, ENV('manual'))
    assert.strictEqual(f.body.processing.decision, 'manual')
    assert.strictEqual(f.body.extraction.mayStart, false)
    // Every later request that would record a manual decision fails:
    // nothing reaches the server. Then the deployment goes automatic.
    mockProvider.sent = []
    const later = await extract(f.body.confirmationToken, 'automatic')
    assert.strictEqual(later.body.restricted, 'submission_policy')
    assert.deepStrictEqual(mockProvider.sent, [])
  })

  // ------------------------------------------------------------ finalization controls
  await check('finalize: wrong token, a different intent token, and a bare id are all refused', async () => {
    const { r, bytes } = await submit()
    await upload(r, bytes)
    const { r: other } = await submit()
    for (const tok of ['x'.repeat(43), other.body.intentToken]) {
      const f = await handleFinalize({ body: { intentId: r.body.intentId, intentToken: tok }, env: ENV('automatic'), supabase, storage, clientKey: nextIp() })
      assert.strictEqual(f.status, 404)
    }
    const bare = await handleFinalize({ body: { intentId: r.body.intentId }, env: ENV('automatic'), supabase, storage, clientKey: nextIp() })
    assert.strictEqual(bare.status, 400)
    const withPath = await handleFinalize({ body: { intentId: r.body.intentId, intentToken: r.body.intentToken, objectPath: other.body.upload.path }, env: ENV('automatic'), supabase, storage, clientKey: nextIp() })
    assert.strictEqual(withPath.body.reason, 'unexpected_field')
    assert.strictEqual(acceptanceOf(r.body.intentId).status, 'open')
  })

  await check('ownership: one acceptance cannot upload to, or finalize with, another acceptance\'s object', async () => {
    const { r: a, bytes } = await submit()
    const { r: b } = await submit()
    // B's authorization at A's path is refused by storage.
    assert.ok(storage.uploadWithToken(a.body.upload.path, b.body.upload.token, bytes).error)
    // B uploads its own file; A still has none, so A cannot finalize.
    await upload(b, bytes)
    const fa = await finalize(a)
    assert.strictEqual(fa.status, 409)
    assert.strictEqual(fa.body.reason, 'upload_missing')
  })

  await check('finalize: size and type are checked against the actual object', async () => {
    const good = await pdfBytes()
    const { r: small } = await submit({ bytes: good })
    await upload(small, good.subarray(0, good.length - 1))
    assert.strictEqual((await finalize(small)).body.reason, 'object_size_mismatch')
    const fake = Buffer.alloc(good.length, 0x41)
    const { r: notPdf } = await submit({ bytes: fake })
    await upload(notPdf, fake)
    assert.strictEqual((await finalize(notPdf)).body.reason, 'object_type_invalid')
    const docx = await docxBytes()
    const { r: d } = await submit({ bytes: docx, name: 'thesis.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    await upload(d, docx)
    assert.strictEqual((await finalize(d)).status, 200)
    const zipNotDocx = await new JSZip().file('a.txt', 'x').generateAsync({ type: 'nodebuffer' })
    const { r: z } = await submit({ bytes: zipNotDocx, name: 'thesis.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' })
    await upload(z, zipNotDocx)
    assert.strictEqual((await finalize(z)).body.reason, 'object_type_invalid')
  })

  await check('finalize: repeated and concurrent calls create exactly one paper and return the same credential', async () => {
    const { r, bytes } = await submit()
    await upload(r, bytes)
    const results = await Promise.all([finalize(r), finalize(r), finalize(r)])
    assert.ok(results.every((x) => x.status === 200))
    assert.strictEqual(new Set(results.map((x) => x.body.confirmationToken)).size, 1)
    assert.strictEqual(results.filter((x) => x.body.alreadyFinalized === false).length, 1)
    assert.strictEqual(count(`select count(*) from papers where submission_acceptance_id = ${lit(r.body.intentId)}`), 1)
    const again = await finalize(r)
    assert.strictEqual(again.body.alreadyFinalized, true)
  })

  await check('expiry: an expired acceptance cannot be finalized, and is marked so', async () => {
    const { r, bytes } = await submit()
    await upload(r, bytes)
    sqlOk(`update submission_acceptances set expires_at = now() - interval '1 minute' where id = ${lit(r.body.intentId)}`)
    const f = await finalize(r)
    assert.strictEqual(f.status, 410)
    assert.strictEqual(acceptanceOf(r.body.intentId).status, 'expired')
    assert.strictEqual(count(`select count(*) from papers where submission_acceptance_id = ${lit(r.body.intentId)}`), 0)
  })

  await check('document: the authorization cannot replace a finalized document; a replaced object is never sent', async () => {
    const { r, bytes } = await submit()
    await upload(r, bytes)
    const f = await finalize(r)
    const other = await pdfBytes('A different document')
    assert.ok((await upload(r, other)).error, 'upsert:false refuses to overwrite')
    // Suppose the object were replaced by some other means anyway.
    storage.objects.set(r.body.upload.path, other)
    mockProvider.sent = []
    const res = await extract(f.body.confirmationToken, 'automatic')
    assert.strictEqual(res.body.reason, 'document_mismatch')
    assert.deepStrictEqual(mockProvider.sent, [], 'nothing was sent')
    const gen = json(`select to_jsonb(g) from ai_generations g where paper_id = ${lit(paperOf(r.body.intentId).id)} order by created_at desc limit 1`)
    assert.strictEqual(gen.provider, 'none')
  })

  await check('retry: finalize before upload, then after; extraction failure after finalize can be retried', async () => {
    const { r, bytes } = await submit()
    assert.strictEqual((await finalize(r)).body.reason, 'upload_missing')
    await upload(r, bytes)
    const f = await finalize(r)
    assert.strictEqual(f.status, 200)
    const saved = storage.objects.get(r.body.upload.path)
    storage.objects.delete(r.body.upload.path) // storage briefly unavailable
    const failedRun = await extract(f.body.confirmationToken, 'automatic')
    assert.strictEqual(failedRun.body.status, 'failed')
    storage.objects.set(r.body.upload.path, saved)
    sqlOk(`update papers set extraction_started_at = now() - interval '1 minute' where submission_acceptance_id = ${lit(r.body.intentId)}`)
    mockProvider.sent = []
    const retried = await extract(f.body.confirmationToken, 'automatic')
    assert.strictEqual(retried.status, 200, JSON.stringify(retried.body))
    assert.ok(mockProvider.sent.length >= 1)
  })

  // ------------------------------------------------------------ cleanup
  await check('cleanup: removes only abandoned acceptances\' own objects; never a finalized or unrelated one', async () => {
    const { r: abandoned, bytes } = await submit()
    await upload(abandoned, bytes)
    const { r: kept, bytes: kb } = await submit()
    await upload(kept, kb)
    await finalize(kept)
    storage.objects.set('legacy-uuid-thesis.pdf', bytes) // an old-path upload
    sqlOk(`update submission_acceptances set expires_at = now() - interval '3 hours' where id in (${lit(abandoned.body.intentId)}, ${lit(kept.body.intentId)})`)
    const res = await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(res.removed >= 1)
    assert.ok(!storage.objects.has(abandoned.body.upload.path))
    assert.ok(storage.objects.has(kept.body.upload.path), 'the finalized document stays')
    assert.ok(storage.objects.has('legacy-uuid-thesis.pdf'), 'an unrelated object stays')
    assert.strictEqual(acceptanceOf(kept.body.intentId).status, 'finalized')
    assert.ok(acceptanceOf(abandoned.body.intentId).object_removed_at, 'the acceptance record itself is kept')
    const second = await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.strictEqual(second.removed, 0, 'idempotent')
  })

  // ------------------------------------------------------------ limits, privacy, access
  await check('limits: the intent endpoint is limited per client address', async () => {
    const key = '203.0.113.7'
    let last
    for (let i = 0; i < 11; i++) last = (await submit({ clientKey: key })).r
    assert.strictEqual(last.status, 429)
    assert.strictEqual((await submit({ clientKey: '203.0.113.8' })).r.status, 201)
    assert.strictEqual(count(`select count(*) from submission_rate_limits where key like '%203.0.113%'`), 0, 'addresses are not stored')
  })

  await check('privacy: logs carry no token, signed URL, secret or contact details; anon reaches nothing new', async () => {
    const text = happy.log.lines.join('\n')
    for (const secret of [happy.r.body.intentToken, happy.f.body.confirmationToken, happy.r.body.upload.token, happy.r.body.upload.signedUrl, SECRET, 'synthetic@example.invalid', '+249912345678']) {
      assert.ok(!text.includes(secret), `leaked: ${secret.slice(0, 12)}`)
    }
    for (const sql of [
      'select * from submission_acceptances',
      'select * from agreement_versions',
      'select * from submission_rate_limits',
      'select * from extraction_policy',
      `select get_submission_intent('${happy.r.body.intentId}', 'x')`,
      `select create_submission_intent('h','submission-terms-2026-09-25-en','en','x','author','record_abstract','automatic','n','e',null,'pdf',10,60)`,
      `select finalize_submission_intent('${happy.r.body.intentId}', 'x', 1, 'x', 'x')`,
      'select expire_submission_intents(10, 0)',
    ]) {
      assert.ok(psql(`set role anon; ${sql}`).error, `anon could run: ${sql}`)
    }
  })

  await check('compatibility: the old submission path still works and is stamped from the policy row; legacy rows untouched', async () => {
    setPolicy('automatic')
    const old = json(`set role anon; select submit_paper('Old Path', 'old@example.invalid', 'uuid-old.pdf', true, array['abstract_and_citation'], null)`)
    const p = json(`select to_jsonb(p) from papers p where id = ${lit(old.paper_id)}`)
    assert.strictEqual(p.submission_decision_source, 'database_policy')
    assert.strictEqual(p.submission_extraction_policy, 'automatic')
    assert.strictEqual(p.submission_acceptance_id, null)
    const legacyAfter = json(`select to_jsonb(p) from papers p where id = '00000000-0000-0000-0000-0000000000aa'`)
    for (const k of Object.keys(legacyBefore)) assert.deepStrictEqual(legacyAfter[k], legacyBefore[k], k)
    for (const k of ['submission_decision_source', 'submission_extraction_policy', 'submission_acceptance_id', 'file_sha256', 'publication_setting']) {
      assert.strictEqual(legacyAfter[k], null, `${k} stays null on a legacy row`)
    }
  })

  assert.strictEqual(network.length, 0, 'no network request was made')
  execFileSync('dropdb', ['--if-exists', DB])
  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll M2A real-database checks passed.')
}

main()
