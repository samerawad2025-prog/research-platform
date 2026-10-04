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
const { handleTerms, handleCreateIntent, handleFinalize, cleanupAbandonedIntents, signOffer } = require(path.join(ROOT, 'lib/submission/acceptanceHandlers'))
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
// Paid Gemini terms are attested by default (GEMINI_DATA_TERMS, migration
// 0018); tests about the attestation itself pass their own environment.
const ENV = (mode) => ({ SUBMISSION_ACCEPTANCE_FLOW: 'enabled', SUBMISSION_TOKEN_SECRET: SECRET, GEMINI_DATA_TERMS: 'paid', ...(mode === undefined ? {} : { EXTRACTION_MODE: mode }) })
const V1 = 'submission-terms-2026-09-25-en'
const V2 = 'submission-terms-2026-10-04-en'
const V3 = 'submission-terms-2026-10-04-v3-en'
const V3_AR = 'submission-terms-2026-10-04-v3-ar'
// Google's unpaid (free-tier) terms attested (migration 0019).
const FREE = (mode) => ({ ...ENV(mode), GEMINI_DATA_TERMS: 'unpaid' })
const FIXTURE = (name) => fs.readFileSync(path.join(ROOT, 'scripts/fixtures/synthetic', name))
const PERSONAL = [/Amna/i, /Elhassan/i, /Kamal/i, /Yousif/i, /Nafisa/i, /Fatima/i, /Hassan Ali/i, /Sara Ahmed/i, /Babiker/i, /@/, /912\s?345/, /0412345/]

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
  sqlOk(`insert into researchers (id, full_name, email, linkedin_url, facebook_url) values ('00000000-0000-0000-0000-000000000001', 'Legacy Submitter', 'legacy@example.invalid', 'https://www.linkedin.com/in/legacy', 'https://facebook.com/legacy');
         insert into paper_researchers (paper_id, researcher_id, author_order) select '00000000-0000-0000-0000-0000000000aa', '00000000-0000-0000-0000-000000000001', 1 where false;
         insert into papers (id, file_path, permission_to_process, publication_scope, submitted_by, extraction_status, metadata_confirmed_at, title, confirmation_token_hash)
         values ('00000000-0000-0000-0000-0000000000aa', 'legacy.pdf', true, '{full_paper}', '00000000-0000-0000-0000-000000000001', 'completed', now(), 'Legacy thesis',
                 encode(sha256('legacy-token'::bytea), 'hex'));`)
  run(path.join(ROOT, 'supabase/migrations/0011_manual_entry.sql'))
  run(path.join(ROOT, 'supabase/migrations/0012_submission_acceptance.sql'))
  run(path.join(ROOT, 'supabase/migrations/0012_submission_acceptance.sql')) // idempotent
  run(path.join(ROOT, 'supabase/migrations/0013_linkedin_visibility_declared_authors.sql'))
  run(path.join(ROOT, 'supabase/migrations/0013_linkedin_visibility_declared_authors.sql')) // idempotent
  run(path.join(ROOT, 'supabase/migrations/0018_ai_processing_agreement.sql'))
  run(path.join(ROOT, 'supabase/migrations/0018_ai_processing_agreement.sql')) // idempotent
  run(path.join(ROOT, 'supabase/migrations/0019_gemini_free_tier_agreement.sql'))
  run(path.join(ROOT, 'supabase/migrations/0019_gemini_free_tier_agreement.sql')) // idempotent
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
    offerToken: 'placeholder',
    agreementId: V2,
    accepted: true,
    publicationSetting: 'record_abstract',
    claimedRole: 'author',
    processingChoice: 'automatic',
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
  // Version 2 by default: the version whose text describes Gemini reading.
  // A version without that disclosure can never lead to automatic reading.
  const activate = (on = true, ids = ['submission-terms-2026-10-04-en', 'submission-terms-2026-10-04-ar']) =>
    sqlOk(`update agreement_versions set active = (${on} and id in (${ids.map(lit).join(', ')}))`)

  async function submit(opts = {}) {
    // 'mode' present but undefined means "EXTRACTION_MODE unset", so no default.
    const mode = 'mode' in opts ? opts.mode : 'automatic'
    const { bytes, name = 'thesis.pdf', type = 'application/pdf', over = {}, clientKey = nextIp(), log } = opts
    const b = bytes || (await pdfBytes())
    // The offer the researcher was shown: from /terms, under the same
    // environment unless the test supplies its own.
    const offerToken = opts.offerToken || (await handleTerms({ env: ENV('termsMode' in opts ? opts.termsMode : mode), supabase, clientKey })).body.offer.token
    // Like the form: automatic reading can be chosen only when it was offered.
    let offered = 'manual'
    try { offered = JSON.parse(Buffer.from(offerToken.split('.')[0], 'base64url').toString()).d } catch { /* a forged token */ }
    const processingChoice = offered === 'automatic' ? 'automatic' : 'manual'
    const r = await handleCreateIntent({ body: body({ offerToken, processingChoice, file: { name, size: b.length, type }, ...over }), env: ENV(mode), supabase, storage, clientKey, log })
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
    handleExtract({ token, env: { EXTRACTION_MODE: mode, GEMINI_DATA_TERMS: 'paid', AI_PROVIDER: 'mock' }, getSupabaseAdmin: () => supabase, getProvider: () => mockProvider, runExtraction, log: logCapture() })

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
    assert.strictEqual(r.body.reason, 'offer_stale')
    assert.strictEqual(r.body.staleBecause, 'agreement_changed')
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
      [{ offerToken: undefined }, 'offer_invalid'],
      [{ offerToken: 'not.an.offer' }, 'offer_invalid'],
      [{ offerToken: 'placeholder' }, 'offer_invalid'],
    ]
    for (const [over, reason] of cases) {
      const r = await handleCreateIntent({ body: body({ ...over, file: { name: 'a.pdf', size: 100, type: 'application/pdf' } }), env: ENV('automatic'), supabase, storage, clientKey: nextIp() })
      assert.strictEqual(r.status, 400, JSON.stringify(over))
      assert.strictEqual(r.body.reason, reason, JSON.stringify(over))
    }
    assert.strictEqual(count('select count(*) from submission_acceptances'), before)
  })

  await check('acceptance: a database row whose hash differs from the application registry cannot be accepted', async () => {
    sqlOk(`update agreement_versions set content_sha256 = '${'1'.repeat(64)}' where id = 'submission-terms-2026-10-04-ar'`)
    const { r } = await submit({ over: { agreementId: 'submission-terms-2026-10-04-ar' } })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.reason, 'offer_stale', 'the tampered row was never offered')
    const terms = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    assert.deepStrictEqual(terms.body.agreements.map((a) => a.language), ['en'], 'the tampered row is not offered')
    sqlOk(`update agreement_versions set content_sha256 = '3bcfe8c27a1046835423b38dc59e7f17d5b4deae94a28cf8273208ea5a71faf0' where id = 'submission-terms-2026-10-04-ar'`)
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
    assert.strictEqual(a.agreement_sha256, '468c51eb1e8edb493de94a969415c8fce28344523503bc43f409a2a45f459367')
    assert.strictEqual(a.processing_choice, 'automatic')
    assert.strictEqual(a.ai_processing_terms, 'gemini_api_paid', 'the arrangement automatic reading was permitted under')
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
    assert.strictEqual(view.automatic_processing, true)
    assert.deepStrictEqual(json(`select external_ai_permission(${lit(p.id)})`), { permitted: true, terms: 'gemini_api_paid', agreement_version_id: V2, known_names: ['Synthetic Researcher'] })
    assert.strictEqual(p.manual_entry_at, null)
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

  // ------------------------------------------------------------ cleanup (upload-authorization lifecycle)
  const eligible = (limit = 100, margin = 3600) => json(`select expire_submission_intents(${limit}, ${margin})`).map((x) => x.id)
  const authPast = (id, minutes) => sqlOk(`update submission_acceptances set upload_authorization_expires_at = now() - interval '${minutes} minutes' where id = ${lit(id)}`)

  await check('cleanup: the upload authorization\'s own expiry is recorded at acceptance', async () => {
    const { r } = await submit()
    const a = acceptanceOf(r.body.intentId)
    const authExp = Date.parse(a.upload_authorization_expires_at)
    const intentExp = Date.parse(a.expires_at)
    assert.ok(authExp - Date.now() > 110 * 60_000, 'about two hours, read from the authorization')
    assert.ok(authExp > intentExp, 'outlives the 30-minute intent')
  })

  await check('cleanup: ordinary expiry - an expired intent\'s authorization still uploads, so nothing is removed until it has expired too', async () => {
    const { r, bytes } = await submit()
    sqlOk(`update submission_acceptances set expires_at = now() - interval '3 hours' where id = ${lit(r.body.intentId)}`)
    await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.strictEqual(acceptanceOf(r.body.intentId).status, 'expired')
    // The reproduced finding: intent expiry does not revoke the authorization.
    assert.strictEqual((await upload(r, bytes)).error, null, 'the authorization still works')
    await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(storage.objects.has(r.body.upload.path), 'not removed while an upload can still land')
    assert.ok(!eligible().includes(r.body.intentId))
    // Authorization expired, but inside the in-progress margin: still kept.
    storage.expireGrant(r.body.upload.token)
    authPast(r.body.intentId, 10)
    await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(storage.objects.has(r.body.upload.path), 'an upload started just before expiry may still be arriving')
    // Past authorization expiry + margin: removed, and nothing can recreate it.
    authPast(r.body.intentId, 61)
    await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(!storage.objects.has(r.body.upload.path), 'removed')
    assert.ok(acceptanceOf(r.body.intentId).object_removed_at, 'recorded; the acceptance row is kept')
    assert.match((await upload(r, bytes)).error?.message || '', /expired/, 'the authorization no longer uploads')
    assert.ok(!eligible().includes(r.body.intentId), 'done: not returned again')
  })

  await check('cleanup: expiry recorded during finalization gets no shortcut', async () => {
    const { r, bytes } = await submit()
    await upload(r, bytes)
    sqlOk(`update submission_acceptances set expires_at = now() - interval '1 second' where id = ${lit(r.body.intentId)}`)
    assert.strictEqual((await finalize(r)).status, 410)
    assert.strictEqual(acceptanceOf(r.body.intentId).status, 'expired')
    await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(storage.objects.has(r.body.upload.path), 'kept while the authorization is live')
    storage.expireGrant(r.body.upload.token)
    authPast(r.body.intentId, 61)
    await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(!storage.objects.has(r.body.upload.path))
  })

  await check('cleanup: an unknown authorization expiry is treated as a full day', async () => {
    const { r, bytes } = await submit()
    await upload(r, bytes)
    sqlOk(`update submission_acceptances set expires_at = now() - interval '3 hours', upload_authorization_expires_at = null where id = ${lit(r.body.intentId)}`)
    eligible()
    assert.ok(!eligible().includes(r.body.intentId))
    sqlOk(`update submission_acceptances set created_at = now() - interval '26 hours' where id = ${lit(r.body.intentId)}`)
    assert.ok(eligible().includes(r.body.intentId))
    storage.objects.delete(r.body.upload.path)
    sqlOk(`select mark_submission_object_removed(${lit(r.body.intentId)})`)
  })

  await check('cleanup: an object that landed after an early removal is found and removed again', async () => {
    const { r, bytes } = await submit()
    // State left by a removal made before the safe point (e.g. by the
    // pre-correction cleanup): removed 3h ago, authorization expired 90 min
    // ago, so an upload after the removal was possible.
    sqlOk(`update submission_acceptances set status = 'expired', expires_at = now() - interval '4 hours',
             upload_authorization_expires_at = now() - interval '90 minutes', object_removed_at = now() - interval '3 hours'
           where id = ${lit(r.body.intentId)}`)
    storage.objects.set(r.body.upload.path, bytes) // the recreated orphan
    await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(!storage.objects.has(r.body.upload.path), 'recreated orphan removed')
    assert.ok(!eligible().includes(r.body.intentId), 'removed after the safe point: final')
  })

  await check('cleanup: removes only abandoned acceptances\' own objects; never a finalized or unrelated one', async () => {
    const { r: abandoned, bytes } = await submit()
    await upload(abandoned, bytes)
    const { r: kept, bytes: kb } = await submit()
    await upload(kept, kb)
    await finalize(kept)
    storage.objects.set('legacy-uuid-thesis.pdf', bytes) // an old-path upload
    sqlOk(`update submission_acceptances set expires_at = now() - interval '5 hours', upload_authorization_expires_at = now() - interval '3 hours'
           where id in (${lit(abandoned.body.intentId)}, ${lit(kept.body.intentId)})`)
    const res = await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.ok(res.removed >= 1)
    assert.ok(!storage.objects.has(abandoned.body.upload.path))
    assert.ok(storage.objects.has(kept.body.upload.path), 'the finalized document stays')
    assert.ok(storage.objects.has('legacy-uuid-thesis.pdf'), 'an unrelated object stays')
    assert.strictEqual(acceptanceOf(kept.body.intentId).status, 'finalized')
    assert.ok(!eligible().includes(kept.body.intentId))
    assert.ok(acceptanceOf(abandoned.body.intentId).object_removed_at, 'the acceptance record itself is kept')
    const second = await cleanupAbandonedIntents({ supabase, storage, limit: 100, log: logCapture() })
    assert.strictEqual(second.removed, 0, 'idempotent')
  })

  await check('cleanup: the database work is bounded - p_limit caps rows expired as well as rows returned', async () => {
    const ids = []
    for (let i = 0; i < 7; i++) ids.push((await submit()).r.body.intentId)
    sqlOk(`update submission_acceptances set expires_at = now() - interval '5 hours', upload_authorization_expires_at = now() - interval '3 hours' where id in (${ids.map(lit).join(',')})`)
    const openExpired = () => count(`select count(*) from submission_acceptances where status = 'open' and expires_at < now()`)
    const before = openExpired()
    assert.ok(before >= 7)
    const out = eligible(2)
    assert.strictEqual(before - openExpired(), 2, 'exactly two rows updated')
    assert.ok(out.length <= 2)
    for (let i = 0; i < 10; i++) eligible(100)
    assert.strictEqual(openExpired(), 0)
    for (const id of ids) sqlOk(`select mark_submission_object_removed(${lit(id)})`)
  })

  // ------------------------------------------------------------ depositor versus authorship
  const researchersOf = (intentId) =>
    json(`select coalesce(jsonb_agg(jsonb_build_object('email', r.email, 'name', r.full_name, 'order', pr.author_order) order by pr.author_order nulls last), '[]')
          from paper_researchers pr join researchers r on r.id = pr.researcher_id
          where pr.paper_id = (select id from papers where submission_acceptance_id = ${lit(intentId)})`)

  await check('depositor: a librarian or volunteer depositor is recorded but never made an author; the declared authors are linked in order', async () => {
    const before = count('select count(*) from submission_acceptances')
    for (const authors of [undefined, [], [''], ['x'.repeat(201)], [42]]) {
      const { r } = await submit({ over: { claimedRole: 'authorized_depositor', ...(authors === undefined ? {} : { authors }) } })
      assert.strictEqual(r.status, 400, JSON.stringify(authors))
      assert.strictEqual(r.body.reason, 'authors_required')
    }
    const { r: notDepositor } = await submit({ over: { claimedRole: 'author', authors: ['Someone'] } })
    assert.strictEqual(notDepositor.body.reason, 'unexpected_field')
    assert.strictEqual(count('select count(*) from submission_acceptances'), before, 'nothing recorded')

    const { r, bytes } = await submit({ over: { claimedRole: 'authorized_depositor', fullName: 'Library Volunteer', email: 'library@example.invalid', authors: [' Real Author A ', 'Real Author B'] } })
    assert.strictEqual(r.status, 201, JSON.stringify(r.body))
    assert.deepStrictEqual(acceptanceOf(r.body.intentId).declared_authors, ['Real Author A', 'Real Author B'])
    // Immutable once recorded.
    assert.ok(psql(`select record_declared_authors(${lit(r.body.intentId)}, '["Changed"]'::jsonb)`).error)
    await upload(r, bytes)
    const f = await finalize(r)
    assert.strictEqual(f.status, 200)
    const p = paperOf(r.body.intentId)
    assert.strictEqual(json(`select to_jsonb(x) from researchers x where id = ${lit(p.submitted_by)}`).email, 'library@example.invalid', 'depositor kept as submitter')
    assert.strictEqual(acceptanceOf(r.body.intentId).claimed_role, 'authorized_depositor', 'acceptance evidence kept')
    assert.deepStrictEqual(researchersOf(r.body.intentId).map((x) => [x.name, x.order, x.email]), [['Real Author A', 1, null], ['Real Author B', 2, null]])
    const view = json(`select get_paper_for_confirmation(${lit(f.body.confirmationToken)})`)
    assert.strictEqual(view.submitter_role, 'authorized_depositor')
    assert.ok(view.researchers.every((x) => x.is_submitter === false && x.linkedin_public === false))
    // Confirmation can reorder and correct; the depositor is never reinserted.
    const [a, b] = view.researchers
    json(`select confirm_researcher_metadata(${lit(f.body.confirmationToken)}, ${lit([{ researcher_id: b.researcher_id, full_name: 'Real Author B' }, { researcher_id: a.researcher_id, full_name: 'Real Author A' }])}, null)`)
    assert.deepStrictEqual(researchersOf(r.body.intentId).map((x) => [x.name, x.order]), [['Real Author B', 1], ['Real Author A', 2]])
    assert.ok(!researchersOf(r.body.intentId).some((x) => x.email === 'library@example.invalid'), 'depositor not reinserted')
  })

  await check('depositor: an author is linked first (unverified); a coauthor is linked with no position until confirmed', async () => {
    const { r: a, bytes } = await submit({ over: { claimedRole: 'author', fullName: 'Sole Author', email: 'author@example.invalid' } })
    await upload(a, bytes)
    await finalize(a)
    assert.deepStrictEqual(researchersOf(a.body.intentId).map((x) => [x.email, x.order]), [['author@example.invalid', 1]])
    assert.strictEqual(acceptanceOf(a.body.intentId).identity_verified, false)

    const { r: c, bytes: cb } = await submit({ over: { claimedRole: 'coauthor', fullName: 'Second Author', email: 'coauthor@example.invalid' } })
    await upload(c, cb)
    const fc = await finalize(c)
    const linked = researchersOf(c.body.intentId)
    assert.deepStrictEqual(linked.map((x) => [x.email, x.order]), [['coauthor@example.invalid', null]])
    // Accurate ordering at confirmation: the coauthor is second.
    const view = json(`select get_paper_for_confirmation(${lit(fc.body.confirmationToken)})`)
    const self = view.researchers.find((x) => x.full_name === 'Second Author')
    json(`select confirm_researcher_metadata(${lit(fc.body.confirmationToken)}, ${lit([{ full_name: 'First Author' }, { researcher_id: self.researcher_id, full_name: 'Second Author' }])}, null)`)
    assert.deepStrictEqual(researchersOf(c.body.intentId).map((x) => [x.name, x.order, x.email]), [['First Author', 1, null], ['Second Author', 2, 'coauthor@example.invalid']])
  })

  // ------------------------------------------------------------ processing offer
  await check('offer: a policy change to automatic after /terms showed manual is refused before any record or authorization', async () => {
    setPolicy('manual')
    const shown = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    assert.strictEqual(shown.body.offer.decision, 'manual')
    setPolicy('automatic')
    const before = count('select count(*) from submission_acceptances')
    const { r } = await submit({ offerToken: shown.body.offer.token })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.reason, 'offer_stale')
    assert.strictEqual(r.body.staleBecause, 'processing_broadened')
    assert.ok(!r.body.upload, 'no upload authorization')
    assert.strictEqual(count('select count(*) from submission_acceptances'), before, 'nothing recorded')
    // Refreshing and accepting the new offer works, and records automatic.
    const { r: again } = await submit()
    assert.strictEqual(again.status, 201)
    assert.strictEqual(again.body.processing.decision, 'automatic')
    assert.strictEqual(again.body.processing.changedFromOffer, false)
  })

  await check('offer: an application-mode change to automatic after /terms showed manual is refused', async () => {
    setPolicy('automatic')
    const { r } = await submit({ termsMode: 'manual', mode: 'automatic' })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.staleBecause, 'processing_broadened')
  })

  await check('offer: a narrower decision is allowed and explained', async () => {
    setPolicy('automatic')
    const shown = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    assert.strictEqual(shown.body.offer.decision, 'automatic')
    setPolicy('manual')
    const { r } = await submit({ offerToken: shown.body.offer.token })
    assert.strictEqual(r.status, 201)
    assert.deepStrictEqual(r.body.processing, { decision: 'manual', offered: 'automatic', choice: 'automatic', changedFromOffer: true })
    const a = acceptanceOf(r.body.intentId)
    assert.strictEqual(a.processing_decision, 'manual')
    assert.strictEqual(a.processing_offer_decision, 'automatic')
    const { r: r2 } = await submit({ termsMode: 'automatic', mode: 'manual', offerToken: shown.body.offer.token })
    assert.strictEqual(r2.body.processing.decision, 'manual', 'app mode narrowed')
    setPolicy('automatic')
  })

  await check('offer: an agreement deactivated or added after /terms needs reacceptance', async () => {
    const shown = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    sqlOk(`update agreement_versions set active = false where id = ${lit(V2)}`)
    const { r } = await submit({ offerToken: shown.body.offer.token })
    assert.strictEqual(r.status, 409)
    assert.strictEqual(r.body.staleBecause, 'agreement_changed')
    const onlyAr = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    activate(true)
    // An offer that never showed the English text cannot accept it.
    const { r: r2 } = await submit({ offerToken: onlyAr.body.offer.token })
    assert.strictEqual(r2.body.staleBecause, 'agreement_changed')
  })

  await check('offer: tampered, foreign-secret and expired offers are refused', async () => {
    setPolicy('manual')
    const shown = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    setPolicy('automatic')
    const [b64, mac] = shown.body.offer.token.split('.')
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString())
    const widened = `${Buffer.from(JSON.stringify({ ...payload, d: 'automatic' })).toString('base64url')}.${mac}`
    const agreements = [{ id: V2, sha256: '468c51eb1e8edb493de94a969415c8fce28344523503bc43f409a2a45f459367' }]
    const foreign = signOffer('z'.repeat(40), { decision: 'automatic', agreements }).token
    const expired = signOffer(SECRET, { decision: 'automatic', agreements, now: Date.now() - 31 * 60_000 }).token
    const before = count('select count(*) from submission_acceptances')
    for (const [tok, status, reason] of [[widened, 400, 'offer_invalid'], [foreign, 400, 'offer_invalid'], [expired, 409, 'offer_stale']]) {
      const { r } = await submit({ offerToken: tok })
      assert.strictEqual(r.status, status, reason)
      assert.strictEqual(r.body.reason, reason)
    }
    assert.strictEqual(count('select count(*) from submission_acceptances'), before)
  })

  await check('offer: the database never records processing broader than the offer', async () => {
    setPolicy('automatic')
    const res = json(`select create_submission_intent('${'a'.repeat(64)}',${lit(V2)},'en','468c51eb1e8edb493de94a969415c8fce28344523503bc43f409a2a45f459367',
      'author','record_abstract','automatic','Direct','d@example.invalid',null,'pdf',10,60,'manual',now(),'automatic','gemini_api_paid')`)
    assert.strictEqual(res.processing_decision, 'manual')
    assert.ok(psql(`update submission_acceptances set processing_decision = 'automatic' where id = ${lit(res.id)}`).error, 'check constraint')
    sqlOk(`update submission_acceptances set status = 'expired', object_removed_at = now(), upload_authorization_expires_at = now() - interval '1 day' where id = ${lit(res.id)}`)
  })

  // ------------------------------------------------------------ M3: Facebook and LinkedIn
  const researcherRow = (id) => json(`select to_jsonb(r) from researchers r where id = ${lit(id)}`)

  await check('M3: legacy contact values are kept unchanged and private; Facebook is no longer returned', async () => {
    const legacy = researcherRow('00000000-0000-0000-0000-000000000001')
    assert.strictEqual(legacy.linkedin_url, 'https://www.linkedin.com/in/legacy')
    assert.strictEqual(legacy.facebook_url, 'https://facebook.com/legacy')
    assert.strictEqual(legacy.linkedin_public, false, 'no display permission inferred')
    assert.strictEqual(count('select count(*) from researchers where linkedin_public'), 0)
    const view = json(`select get_paper_for_confirmation('legacy-token')`)
    assert.ok(view && !JSON.stringify(view).includes('facebook'), 'no facebook key or value')
  })

  await check('M3: LinkedIn saves whatever the publication permission; Facebook sent by a crafted request is ignored', async () => {
    setPolicy('manual')
    const old = json(`set role anon; select submit_paper('Old Scope', 'oldscope@example.invalid', 'uuid-scope.pdf', true, array['abstract_and_citation'], null)`)
    const oldView = json(`select get_paper_for_confirmation(${lit(old.confirmation_token)})`)
    const me = oldView.researchers[0]
    assert.strictEqual(me.is_submitter, true)
    json(`set role anon; select confirm_researcher_metadata(${lit(old.confirmation_token)}, ${lit([{ researcher_id: me.researcher_id, full_name: 'Old Scope', linkedin_url: 'https://www.linkedin.com/in/old-scope', facebook_url: 'https://facebook.com/x' }, { full_name: 'New Coauthor', linkedin_url: 'https://linkedin.com/in/co', facebook_url: 'https://facebook.com/y', linkedin_public: true }])}, null)`)
    const mine = researcherRow(me.researcher_id)
    assert.strictEqual(mine.linkedin_url, 'https://www.linkedin.com/in/old-scope', 'stored without metadata_and_article')
    assert.strictEqual(mine.facebook_url, null)
    assert.strictEqual(mine.linkedin_public, false, 'private unless chosen')
    const co = json(`select to_jsonb(r) from researchers r join paper_researchers pr on pr.researcher_id = r.id where pr.paper_id = ${lit(old.paper_id)} and r.full_name = 'New Coauthor'`)
    assert.strictEqual(co.facebook_url, null)
    assert.strictEqual(co.linkedin_url, 'https://linkedin.com/in/co')
    assert.strictEqual(co.linkedin_public, false, 'nobody can make another person public')
    setPolicy('automatic')
  })

  await check('M3: only the submitter can make their own LinkedIn public; clearing it clears the choice; invalid links refused', async () => {
    const { r, bytes } = await submit({ over: { claimedRole: 'author', fullName: 'Public Author', email: 'pa@example.invalid', publicationSetting: 'record_abstract' } })
    await upload(r, bytes)
    const f = await finalize(r)
    const tok = f.body.confirmationToken
    const me = json(`select get_paper_for_confirmation(${lit(tok)})`).researchers[0]
    json(`select confirm_researcher_metadata(${lit(tok)}, ${lit([{ researcher_id: me.researcher_id, full_name: 'Public Author', linkedin_url: 'https://www.linkedin.com/in/public-author/', linkedin_public: true }])}, null)`)
    assert.strictEqual(researcherRow(me.researcher_id).linkedin_public, true, 'independent of record_abstract')
    const view = json(`select get_paper_for_confirmation(${lit(tok)})`)
    assert.strictEqual(view.researchers[0].linkedin_public, true)
    assert.strictEqual(view.publication_setting, 'record_abstract')
    json(`select confirm_researcher_metadata(${lit(tok)}, ${lit([{ researcher_id: me.researcher_id, full_name: 'Public Author', linkedin_url: '', linkedin_public: true }])}, null)`)
    const cleared = researcherRow(me.researcher_id)
    assert.strictEqual(cleared.linkedin_url, null)
    assert.strictEqual(cleared.linkedin_public, false)
    for (const bad of ['linkedin.com/in/x', 'http://www.linkedin.com/in/x', 'https://evil.example/in/x', 'https://www.linkedin.com/company/x', 'https://www.linkedin.com/pub/name/1/2', 'https://www.linkedin.com.evil.example/in/x', 'javascript:alert(1)', 'https://www.linkedin.com/in/x?y=1']) {
      const res = psql(`select confirm_researcher_metadata(${lit(tok)}, ${lit([{ researcher_id: me.researcher_id, full_name: 'Public Author', linkedin_url: bad }])}, null)`)
      assert.ok(res.error && /LinkedIn profile address/.test(res.error.message), bad)
    }
    for (const good of ['https://linkedin.com/in/a-b', 'https://uk.linkedin.com/in/%D8%B3%D8%A7%D8%B1%D8%A9']) {
      const res = psql(`select confirm_researcher_metadata(${lit(tok)}, ${lit([{ researcher_id: me.researcher_id, full_name: 'Public Author', linkedin_url: good }])}, null)`)
      assert.ok(!res.error, good)
    }
  })

  await check('shared researcher: one paper\'s link cannot rename or re-profile a person shared with another paper; exclusive rows still edit', async () => {
    const { r, bytes } = await submit({ over: { claimedRole: 'author', fullName: 'Shared Person', email: 'shared@example.invalid' } })
    await upload(r, bytes)
    const f = await finalize(r)
    const me = json(`select get_paper_for_confirmation(${lit(f.body.confirmationToken)})`).researchers[0]
    // Still exclusive: normal editing works, including the name.
    json(`select confirm_researcher_metadata(${lit(f.body.confirmationToken)}, ${lit([{ researcher_id: me.researcher_id, full_name: 'Shared Person', linkedin_url: 'https://www.linkedin.com/in/shared', linkedin_public: true }])}, null)`)
    // The same person is then also linked on a second paper (as a future
    // merge would do).
    const { r: d, bytes: db } = await submit({ over: { claimedRole: 'authorized_depositor', fullName: 'Depositor', email: 'dep@example.invalid', authors: ['Placeholder'] } })
    await upload(d, db)
    const fd = await finalize(d)
    const paperB = paperOf(d.body.intentId).id
    sqlOk(`insert into paper_researchers (paper_id, researcher_id, author_order) values (${lit(paperB)}, ${lit(me.researcher_id)}, 2)`)
    const before = researcherRow(me.researcher_id)
    const confirmedB = () => json(`select to_jsonb(p) from papers p where id = ${lit(paperB)}`).metadata_confirmed_at
    for (const [label, entry] of [
      ['rename', { researcher_id: me.researcher_id, full_name: 'Renamed Through B' }],
      ['relink', { researcher_id: me.researcher_id, full_name: 'Shared Person', linkedin_url: 'https://www.linkedin.com/in/someone-else' }],
      ['unlink', { researcher_id: me.researcher_id, full_name: 'Shared Person', linkedin_url: '' }],
    ]) {
      const res = psql(`set role anon; select confirm_researcher_metadata(${lit(fd.body.confirmationToken)}, ${lit([{ full_name: 'Placeholder' }, entry])}, null)`)
      assert.ok(res.error && /also listed on another submission/.test(res.error.message), `${label}: ${JSON.stringify(res.error)}`)
      assert.deepStrictEqual(researcherRow(me.researcher_id), before, `${label}: shared row unchanged`)
      assert.strictEqual(confirmedB(), null, `${label}: nothing on paper B was saved either`)
    }
    // Paper A still shows the person as they were.
    assert.strictEqual(json(`select get_paper_for_confirmation(${lit(f.body.confirmationToken)})`).researchers[0].full_name, 'Shared Person')
    // Sending the shared row unchanged is fine, and other rows still edit.
    json(`set role anon; select confirm_researcher_metadata(${lit(fd.body.confirmationToken)}, ${lit([{ full_name: 'Placeholder Corrected' }, { researcher_id: me.researcher_id, full_name: 'Shared Person', linkedin_url: 'https://www.linkedin.com/in/shared' }])}, null)`)
    assert.deepStrictEqual(researcherRow(me.researcher_id), before)
    assert.ok(confirmedB())
    // Through paper A, which it also belongs to, the rule is the same: shared.
    const viaA = psql(`set role anon; select confirm_researcher_metadata(${lit(f.body.confirmationToken)}, ${lit([{ researcher_id: me.researcher_id, full_name: 'Renamed Through A' }])}, null)`)
    assert.ok(viaA.error && /also listed on another submission/.test(viaA.error.message))
    assert.strictEqual(json(`select get_paper_for_confirmation(${lit(fd.body.confirmationToken)})`).researchers.find((x) => x.researcher_id === me.researcher_id).full_name, 'Shared Person', 'paper B identity unchanged')
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
      `select create_submission_intent('h','submission-terms-2026-10-04-en','en','x','author','record_abstract','automatic','n','e',null,'pdf',10,60,'automatic',now(),'automatic','gemini_api_paid')`,
      `select external_ai_permission('${happy.p.id}')`,
      `select record_upload_authorization('${happy.r.body.intentId}', now() - interval '1 day')`,
      `select mark_submission_object_removed('${happy.r.body.intentId}')`,
      `select finalize_submission_intent('${happy.r.body.intentId}', 'x', 1, 'x', 'x')`,
      `select record_declared_authors('${happy.r.body.intentId}', '["x"]'::jsonb)`,
      'select expire_submission_intents(10, 0)',
    ]) {
      assert.ok(psql(`set role anon; ${sql}`).error, `anon could run: ${sql}`)
      assert.ok(psql(`set role authenticated; ${sql}`).error, `authenticated could run: ${sql}`)
    }
  })

  // ------------------------------------------------------------ 0018: agreement gate and researcher choice
  await check('0018: choosing manual entry records it with the paper, atomically; nothing is ever read', async () => {
    setPolicy('automatic')
    const { r, bytes } = await submit({ over: { processingChoice: 'manual' } })
    assert.strictEqual(r.status, 201, JSON.stringify(r.body))
    assert.deepStrictEqual(r.body.processing, { decision: 'manual', offered: 'automatic', choice: 'manual', changedFromOffer: false },
      'a researcher\'s own choice is not reported as a change')
    const a = acceptanceOf(r.body.intentId)
    assert.strictEqual(a.processing_choice, 'manual')
    assert.strictEqual(a.processing_decision, 'manual')
    assert.strictEqual(a.ai_processing_terms, null)
    await upload(r, bytes)
    const f = await finalize(r)
    assert.strictEqual(f.body.extraction.mayStart, false)
    assert.strictEqual(f.body.processing.choice, 'manual')
    const p = paperOf(r.body.intentId)
    assert.strictEqual(p.manual_entry_source, 'researcher', 'recorded as the paper was created')
    assert.ok(p.manual_entry_at)
    assert.strictEqual(p.submission_extraction_policy, 'manual')
    assert.deepStrictEqual(json(`select external_ai_permission(${lit(p.id)})`), { permitted: false, reason: 'manual_entry_recorded' })
    const view = json(`select get_paper_for_confirmation(${lit(f.body.confirmationToken)})`)
    assert.strictEqual(view.automatic_processing, false)
    assert.strictEqual(view.manual_entry_source, 'researcher')
    storage.objects.set(r.body.upload.path, bytes)
    mockProvider.sent = []
    const res = await extract(f.body.confirmationToken, 'automatic')
    assert.strictEqual(res.body.alreadyHandled, true)
    assert.deepStrictEqual(mockProvider.sent, [], 'no provider call for a manual choice')
    // Repeated finalization returns the same answer and changes nothing.
    const again = await finalize(r)
    assert.strictEqual(again.body.alreadyFinalized, true)
    assert.strictEqual(again.body.extraction.mayStart, false)
  })

  await check('0018: when automatic reading was not offered, manual is the server\'s decision, not labelled as the researcher\'s', async () => {
    setPolicy('manual')
    const { r, bytes } = await submit()
    assert.strictEqual(r.body.processing.offered, 'manual')
    assert.strictEqual(r.body.processing.changedFromOffer, false)
    await upload(r, bytes)
    const f = await finalize(r)
    const p = paperOf(r.body.intentId)
    assert.strictEqual(p.manual_entry_source, null, 'not recorded as a researcher choice')
    assert.strictEqual(p.submission_extraction_policy, 'manual')
    assert.strictEqual(json(`select external_ai_permission(${lit(p.id)})`).reason, 'manual_decision')
    const res = await extract(f.body.confirmationToken, 'automatic')
    assert.strictEqual(res.body.restricted, 'submission_policy')
    assert.strictEqual(paperOf(r.body.intentId).manual_entry_source, 'mode', 'recorded as the server\'s decision')
    setPolicy('automatic')
  })

  await check('0018: version 1 (no AI disclosure) never leads to reading, even with everything else automatic', async () => {
    setPolicy('automatic')
    activate(true, [V1, 'submission-terms-2026-09-25-ar'])
    const shown = await handleTerms({ env: ENV('automatic'), supabase, clientKey: nextIp() })
    assert.strictEqual(shown.body.offer.decision, 'manual')
    assert.deepStrictEqual(shown.body.processing.choices, ['manual'])
    const { r, bytes } = await submit({ offerToken: shown.body.offer.token, over: { agreementId: V1 } })
    assert.strictEqual(r.status, 201, JSON.stringify(r.body))
    assert.strictEqual(r.body.processing.decision, 'manual')
    // An automatic choice against that offer is refused, not reinterpreted.
    const forced = await submit({ offerToken: shown.body.offer.token, over: { agreementId: V1, processingChoice: 'automatic' } })
    assert.strictEqual(forced.r.status, 400)
    assert.strictEqual(forced.r.body.reason, 'processing_choice_invalid')
    // Even a direct database call cannot get automatic from version 1.
    const direct = json(`select create_submission_intent('${'b'.repeat(64)}',${lit(V1)},'en','77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da',
      'author','record_abstract','automatic','Direct','d@example.invalid',null,'pdf',10,60,'automatic',now(),'automatic','gemini_api_paid')`)
    assert.strictEqual(direct.processing_decision, 'manual')
    sqlOk(`update submission_acceptances set status = 'expired', object_removed_at = now(), upload_authorization_expires_at = now() - interval '1 day' where id = ${lit(direct.id)}`)
    await upload(r, bytes)
    await finalize(r)
    activate(true)
  })

  await check('0018: without attested paid terms, nothing is offered or recorded as automatic, and nothing is read', async () => {
    setPolicy('automatic')
    for (const terms of [undefined, 'unpaid', 'free']) {
      const env = { ...ENV('automatic') }
      if (terms === undefined) delete env.GEMINI_DATA_TERMS
      else env.GEMINI_DATA_TERMS = terms
      const shown = await handleTerms({ env, supabase, clientKey: nextIp() })
      assert.strictEqual(shown.body.offer.decision, 'manual', String(terms))
      const direct = json(`select create_submission_intent('${crypto.randomBytes(32).toString('hex')}',${lit(V2)},'en','468c51eb1e8edb493de94a969415c8fce28344523503bc43f409a2a45f459367',
        'author','record_abstract','automatic','Direct','d@example.invalid',null,'pdf',10,60,'automatic',now(),'automatic',${terms ? lit(terms) : 'null'})`)
      // 'unpaid'/'free' are not valid arrangements at all; the decision stays manual.
      assert.strictEqual(direct.processing_decision, 'manual', String(terms))
      sqlOk(`update submission_acceptances set status = 'expired', object_removed_at = now(), upload_authorization_expires_at = now() - interval '1 day' where id = ${lit(direct.id)}`)
    }
    // Attestation withdrawn between finalization and the extraction request.
    const { r, bytes } = await submit()
    await upload(r, bytes)
    const f = await finalize(r)
    assert.strictEqual(f.body.extraction.mayStart, true)
    storage.objects.set(r.body.upload.path, bytes)
    mockProvider.sent = []
    const res = await handleExtract({ token: f.body.confirmationToken, env: { EXTRACTION_MODE: 'automatic', AI_PROVIDER: 'mock' }, getSupabaseAdmin: () => supabase, getProvider: () => mockProvider, runExtraction, log: logCapture() })
    assert.strictEqual(res.body.restricted, 'provider_terms_unattested')
    assert.deepStrictEqual(mockProvider.sent, [])
    assert.strictEqual(paperOf(r.body.intentId).manual_entry_source, 'mode')
  })

  await check('0018: the permission follows the accepted text - a changed agreement row stops reading', async () => {
    setPolicy('automatic')
    const { r, bytes } = await submit()
    await upload(r, bytes)
    const f = await finalize(r)
    const p = paperOf(r.body.intentId)
    assert.strictEqual(json(`select external_ai_permission(${lit(p.id)})`).permitted, true)
    sqlOk(`update agreement_versions set external_ai_processing = null where id = ${lit(V2)}`)
    assert.strictEqual(json(`select external_ai_permission(${lit(p.id)})`).reason, 'agreement_not_applicable')
    assert.strictEqual(json(`select get_paper_for_confirmation(${lit(f.body.confirmationToken)})`).automatic_processing, false)
    sqlOk(`update agreement_versions set external_ai_processing = 'gemini_api_paid' where id = ${lit(V2)}`)
    assert.strictEqual(json(`select external_ai_permission(${lit(p.id)})`).permitted, true)
  })

  await check('0018: nothing new is reachable by browser roles; the old 15-argument function is gone', async () => {
    for (const sql of [`select external_ai_permission('${happy.p.id}')`]) {
      assert.ok(psql(`set role anon; ${sql}`).error, sql)
      assert.ok(psql(`set role authenticated; ${sql}`).error, sql)
    }
    assert.strictEqual(count(`select count(*) from pg_proc where proname = 'create_submission_intent'`), 1)
    assert.strictEqual(count(`select count(*) from pg_proc p where proname = 'create_submission_intent' and pronargs = 17`), 1)
    for (const fn of ['external_ai_permission', 'create_submission_intent', 'finalize_submission_intent', 'get_paper_for_confirmation', 'stamp_submission_extraction_policy']) {
      assert.ok(sqlOk(`select array_to_string(proconfig, ',') from pg_proc where proname = ${lit(fn)} limit 1`).includes('search_path='), `${fn} pins search_path`)
    }
    // The two version-1 rows are unchanged; version 2 is seeded inactive.
    const rows = JSON.parse(sqlOk(`select json_agg(json_build_object('id', id, 'ai', external_ai_processing) order by id) from agreement_versions`))
    assert.deepStrictEqual(rows, [
      { id: 'submission-terms-2026-09-25-ar', ai: null },
      { id: 'submission-terms-2026-09-25-en', ai: null },
      { id: 'submission-terms-2026-10-04-ar', ai: 'gemini_api_paid' },
      { id: 'submission-terms-2026-10-04-en', ai: 'gemini_api_paid' },
      { id: 'submission-terms-2026-10-04-v3-ar', ai: 'gemini_api_unpaid' },
      { id: 'submission-terms-2026-10-04-v3-en', ai: 'gemini_api_unpaid' },
    ])
  })

  // ------------------------------------------------------------ 0019: free tier, minimized excerpt only
  async function freeSubmission(fileName = 'thesis-en.pdf', fullName = 'Amna Osman Elhassan') {
    const bytes = FIXTURE(fileName)
    const shown = await handleTerms({ env: FREE('automatic'), supabase, clientKey: nextIp() })
    const type = fileName.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    const r = await handleCreateIntent({
      body: body({ offerToken: shown.body.offer.token, agreementId: V3, processingChoice: 'automatic', fullName, file: { name: fileName, size: bytes.length, type } }),
      env: FREE('automatic'), supabase, storage, clientKey: nextIp(),
    })
    assert.strictEqual(r.status, 201, JSON.stringify(r.body))
    await upload(r, bytes)
    const f = await finalize(r, FREE('automatic'))
    storage.objects.set(r.body.upload.path, bytes)
    return { shown, r, f, bytes }
  }
  function recorder() {
    const p = { documents: [] }
    p.extractMetadata = async ({ document }) => {
      p.documents.push(document)
      return { provider: 'fake', model: 'fake', result: { document_type: 'thesis', title: { status: 'found', value: 'From the excerpt' }, year: { status: 'found', value: '2021' }, supervisor_name: { status: 'found', value: 'Dr. Volunteered' } } }
    }
    return p
  }
  const extractUnder = (token, terms, provider) =>
    handleExtract({ token, env: { EXTRACTION_MODE: 'automatic', GEMINI_DATA_TERMS: terms, AI_PROVIDER: 'mock' }, getSupabaseAdmin: () => supabase, getProvider: () => provider, runExtraction, log: logCapture() })

  await check('0019: version 3 under unpaid terms - offered, recorded with its arrangement, and only an excerpt without people is sent', async () => {
    setPolicy('automatic')
    activate(true, [V3, V3_AR])
    const { shown, r, f } = await freeSubmission()
    assert.strictEqual(shown.body.offer.decision, 'automatic')
    assert.strictEqual(shown.body.processing.terms, 'gemini_api_unpaid')
    assert.strictEqual(r.body.processing.decision, 'automatic')
    assert.strictEqual(f.body.extraction.mayStart, true)
    const a = acceptanceOf(r.body.intentId)
    assert.strictEqual(a.agreement_version_id, V3)
    assert.strictEqual(a.ai_processing_terms, 'gemini_api_unpaid')
    const p = paperOf(r.body.intentId)
    assert.deepStrictEqual(json(`select external_ai_permission(${lit(p.id)})`),
      { permitted: true, terms: 'gemini_api_unpaid', agreement_version_id: V3, known_names: ['Amna Osman Elhassan'] })
    const provider = recorder()
    const res = await extractUnder(f.body.confirmationToken, 'unpaid', provider)
    assert.strictEqual(res.status, 200, JSON.stringify(res.body))
    assert.strictEqual(provider.documents.length, 1, 'one request')
    const doc = provider.documents[0]
    assert.strictEqual(doc.type, 'text')
    assert.strictEqual(doc.scope, 'excerpt')
    for (const re of PERSONAL) assert.ok(!re.test(doc.content), `${re} would have been sent`)
    const after = paperOf(r.body.intentId)
    assert.strictEqual(after.title, 'From the excerpt')
    assert.strictEqual(after.supervisor_name, null, 'a volunteered supervisor is never kept')
    const view = json(`select get_paper_for_confirmation(${lit(f.body.confirmationToken)})`)
    assert.strictEqual(view.extraction_detail._scope, 'excerpt')
    assert.ok(!('_diagnostics' in view.extraction_detail), 'the excerpt record is not served to the browser')
    const pass1 = json(`select result_data from ai_generations where paper_id = ${lit(p.id)} and notes = 'Pass 1'`)
    assert.strictEqual(pass1._diagnostics.excerpt.text, doc.content, 'what left the server is on record')
  })

  await check('0019: a scan is never sent; the paper goes to hand entry with its own reason', async () => {
    const { r, f } = await freeSubmission('scanned-cover.pdf')
    const provider = recorder()
    const res = await extractUnder(f.body.confirmationToken, 'unpaid', provider)
    assert.strictEqual(res.status, 200)
    assert.strictEqual(res.body.reason, 'excerpt_unavailable')
    assert.deepStrictEqual(provider.documents, [])
    assert.strictEqual(paperOf(r.body.intentId).failure_code, 'excerpt_unavailable')
    const gen = json(`select to_jsonb(g) from ai_generations g where paper_id = ${lit(paperOf(r.body.intentId).id)} order by created_at desc limit 1`)
    assert.strictEqual(gen.provider, 'none')
    assert.strictEqual(gen.result_data._diagnostics.reason, 'no_text_layer')
  })

  await check('0019: the arrangement must match - version 3 is never read under paid terms, version 2 never under unpaid', async () => {
    const v3 = await freeSubmission()
    const provider = recorder()
    const asPaid = await extractUnder(v3.f.body.confirmationToken, 'paid', provider)
    assert.strictEqual(asPaid.body.restricted, 'agreement_not_applicable')
    assert.strictEqual(paperOf(v3.r.body.intentId).manual_entry_source, 'mode')
    activate(true)
    const { r, bytes } = await submit()
    await upload(r, bytes)
    const f = await finalize(r)
    storage.objects.set(r.body.upload.path, bytes)
    assert.strictEqual(acceptanceOf(r.body.intentId).ai_processing_terms, 'gemini_api_paid')
    const asFree = await extractUnder(f.body.confirmationToken, 'unpaid', provider)
    assert.strictEqual(asFree.body.restricted, 'agreement_not_applicable')
    assert.deepStrictEqual(provider.documents, [], 'nothing sent either way')
    // Offers follow the same rule: version 2 is never offered automatic reading on a free-tier server.
    assert.strictEqual((await handleTerms({ env: FREE('automatic'), supabase, clientKey: nextIp() })).body.offer.decision, 'manual')
  })

  await check('0019: an unaccepted draft version 3 row converges to the reviewed text; an accepted one is never changed', async () => {
    const reviewed = sqlOk(`select content_sha256 from agreement_versions where id = ${lit(V3)}`)
    const db2 = `${DB}_draft`
    execFileSync('dropdb', ['--if-exists', db2])
    execFileSync('createdb', [db2])
    const run2 = (f) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', db2, '-f', f], { stdio: ['ignore', 'ignore', 'pipe'] })
    const q2 = (sql) => execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', db2, '-c', sql], { encoding: 'utf8' }).trim()
    try {
      run2(path.join(__dirname, 'supabase-stubs.sql'))
      run2(path.join(ROOT, 'supabase/schema.sql'))
      // A draft row nobody accepted (as on the test project): takes the reviewed text, keeps its active flag.
      q2(`update agreement_versions set content_sha256 = repeat('0', 64), active = true where id = ${lit(V3)}`)
      run2(path.join(ROOT, 'supabase/migrations/0019_gemini_free_tier_agreement.sql'))
      assert.strictEqual(q2(`select content_sha256 || ':' || active from agreement_versions where id = ${lit(V3)}`), `${reviewed}:true`)
      // Once accepted, a row is evidence: re-running leaves it exactly as accepted.
      q2(`update agreement_versions set content_sha256 = repeat('1', 64) where id = ${lit(V3)}`)
      q2(`insert into submission_acceptances (intent_token_hash, expires_at, agreement_version_id, agreement_language, agreement_sha256, claimed_role, publication_setting,
            processing_decision, processing_mode_at_acceptance, processing_policy_at_acceptance, processing_offer_decision, offer_issued_at, full_name, email, object_path, file_extension, declared_size)
          values (repeat('c', 64), now() + interval '1 hour', ${lit(V3)}, 'en', repeat('1', 64), 'author', 'record_abstract',
            'manual', 'manual', 'manual', 'manual', now(), 'Synthetic', 'synthetic@example.invalid', 'intents/00000000-0000-4000-8000-000000000019/' || repeat('a', 24) || '.pdf', 'pdf', 10)`)
      run2(path.join(ROOT, 'supabase/migrations/0019_gemini_free_tier_agreement.sql'))
      assert.strictEqual(q2(`select content_sha256 from agreement_versions where id = ${lit(V3)}`), '1'.repeat(64), 'an accepted version is never rewritten')
    } finally {
      execFileSync('dropdb', ['--if-exists', db2])
    }
  })

  await check('0019: re-running changes nothing; earlier acceptances keep their arrangement; values are constrained; browser roles have no access', async () => {
    const snapshot = () => sqlOk(`select md5(string_agg(t, '|' order by t)) from (
      select to_jsonb(a)::text t from agreement_versions a union all select to_jsonb(s)::text from submission_acceptances s
      union all select (to_jsonb(p) - 'updated_at')::text from papers p) x`)
    const before = snapshot()
    execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', path.join(ROOT, 'supabase/migrations/0019_gemini_free_tier_agreement.sql')], { stdio: ['ignore', 'ignore', 'pipe'] })
    assert.strictEqual(snapshot(), before)
    assert.strictEqual(count(`select count(*) from submission_acceptances where ai_processing_terms = 'gemini_api_unpaid' and agreement_version_id not like 'submission-terms-2026-10-04-v3-%'`), 0)
    assert.ok(psql(`update submission_acceptances set ai_processing_terms = 'gemini_api_other' where id = (select id from submission_acceptances limit 1)`).error, 'unknown arrangement refused')
    assert.ok(psql(`update agreement_versions set external_ai_processing = 'gemini_free' where id = ${lit(V1)}`).error)
    for (const role of ['anon', 'authenticated']) {
      assert.ok(psql(`set role ${role}; select external_ai_permission('${paperOf(happy.r.body.intentId).id}')`).error, role)
    }
    activate(true)
  })

  await check('compatibility: the old submission path still works, is stamped manual whatever the policy, and is never read; legacy rows untouched', async () => {
    setPolicy('automatic')
    const old = json(`set role anon; select submit_paper('Old Path', 'old@example.invalid', 'uuid-old.pdf', true, array['abstract_and_citation'], null)`)
    const p = json(`select to_jsonb(p) from papers p where id = ${lit(old.paper_id)}`)
    assert.strictEqual(p.submission_decision_source, 'database_policy')
    // 0018: no server acceptance, so no acceptance of an agreement that
    // allows external AI reading. Manual even under an automatic policy.
    assert.strictEqual(p.submission_extraction_policy, 'manual')
    assert.strictEqual(p.submission_acceptance_id, null)
    assert.deepStrictEqual(json(`select external_ai_permission(${lit(p.id)})`), { permitted: false, reason: 'no_applicable_acceptance' })
    assert.strictEqual(json(`select get_paper_for_confirmation(${lit(old.confirmation_token)})`).automatic_processing, false)
    mockProvider.sent = []
    const res = await extract(old.confirmation_token, 'automatic')
    assert.strictEqual(res.body.restricted, 'submission_policy')
    assert.deepStrictEqual(mockProvider.sent, [], 'a legacy-form submission is never sent to the provider')
    // The pre-existing legacy paper: no permission either (it predates any acceptance).
    assert.strictEqual(json(`select external_ai_permission('00000000-0000-0000-0000-0000000000aa')`).permitted, false)
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
