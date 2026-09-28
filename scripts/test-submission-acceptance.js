#!/usr/bin/env node
//
// Phase 3 M2A checks that need no database (CI). The database-backed
// behaviour - acceptance records, finalization, concurrency, expiry,
// cleanup, request limits - is tested against a real Postgres in
// supabase/tests/submission-postgres.test.js (run-0012.sh).
//
// Run: node scripts/test-submission-acceptance.js

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { AGREEMENTS } = require('../lib/submission/agreements')
const { validateIntentBody, handleCreateIntent, handleFinalize, handleTerms, confirmationTokenFor, signOffer, verifyOffer, authorizationExpiry } = require('../lib/submission/acceptanceHandlers')
const { clientKeyOf } = require('../lib/submission/routeHelpers')

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok     ${name}`)
  } catch (err) {
    console.error(`FAIL   ${name} — ${err.message}`)
    failed++
  }
}

const ROOT = path.join(__dirname, '..')
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0012_submission_acceptance.sql'), 'utf8')

// A database stand-in that fails the test if it is touched at all.
const untouchable = new Proxy({}, { get: () => { throw new Error('the database was reached') } })
const SECRET = 'x'.repeat(40)
const ENV = { SUBMISSION_ACCEPTANCE_FLOW: 'enabled', SUBMISSION_TOKEN_SECRET: SECRET, EXTRACTION_MODE: 'automatic' }

const good = () => ({
  offerToken: 'checked-by-the-handler',
  agreementId: 'submission-terms-2026-09-25-ar',
  accepted: true,
  publicationSetting: 'record_abstract_fulltext',
  claimedRole: 'authorized_depositor',
  authors: ['مؤلف أول', 'Second Author'],
  fullName: 'سارة أحمد',
  email: 'sara@example.invalid',
  whatsapp: '0912345678',
  whatsappCountry: 'SD',
  file: { name: 'بحث.docx', size: 12345, type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
})

async function main() {
  await check('registry: each agreement hash is the SHA-256 of its file in docs/legal/', () => {
    for (const a of AGREEMENTS) {
      const actual = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, a.file))).digest('hex')
      assert.strictEqual(actual, a.sha256, a.file)
    }
  })

  await check('registry: migration 0012 seeds the same ids, languages and hashes, all inactive', () => {
    for (const a of AGREEMENTS) {
      const re = new RegExp(`\\('${a.id}', '${a.key}', '${a.language}', '${a.versionLabel}', '${a.versionDate}',\\s*'${a.sha256}', false\\)`)
      assert.ok(re.test(migration), a.id)
    }
    assert.ok(!/,\s*true\)\s*(,|on conflict)/.test(migration), 'no agreement is seeded active')
  })

  await check('validation: a complete Arabic request with a DOCX is accepted as data', () => {
    const r = validateIntentBody(good())
    assert.ok(r.value, JSON.stringify(r))
    assert.strictEqual(r.value.whatsapp, '+249912345678', 'stored in E.164')
    assert.strictEqual(r.value.fileExtension, 'docx')
    assert.strictEqual(r.value.agreement.language, 'ar')
  })

  await check('validation: acceptance must be exactly true; unknown or forged agreements are refused', () => {
    for (const accepted of [undefined, false, 'true', 1, 'yes', null]) {
      assert.strictEqual(validateIntentBody({ ...good(), accepted }).error, 'acceptance_required', String(accepted))
    }
    for (const agreementId of ['submission-terms-2026-09-26-en', '', null, 42, { id: 'x' }]) {
      assert.strictEqual(validateIntentBody({ ...good(), agreementId }).error, 'agreement_unknown', String(agreementId))
    }
  })

  await check('validation: the browser cannot supply processing, paths, hashes, text or timestamps', () => {
    for (const field of ['processingDecision', 'processing', 'extractionMode', 'automatic', 'objectPath', 'filePath', 'agreementSha256', 'agreementText', 'acceptedAt', 'identityVerified', 'language']) {
      const r = validateIntentBody({ ...good(), [field]: 'automatic' })
      assert.strictEqual(r.error, 'unexpected_field', field)
      assert.strictEqual(r.field, field)
    }
    assert.strictEqual(validateIntentBody({ ...good(), file: { ...good().file, sha256: 'a' } }).field, 'file.sha256')
  })

  await check('validation: settings, roles, contact and file checks', () => {
    const cases = [
      [{ publicationSetting: 'full_paper' }, 'publication_setting_invalid'],
      [{ publicationSetting: 'record_abstract ' }, 'publication_setting_invalid'],
      [{ claimedRole: 'supervisor' }, 'claimed_role_invalid'],
      [{ authors: undefined }, 'authors_required'],
      [{ authors: [] }, 'authors_required'],
      [{ authors: ['  '] }, 'authors_required'],
      [{ authors: ['x'.repeat(201)] }, 'authors_required'],
      [{ authors: Array(51).fill('A') }, 'authors_required'],
      [{ authors: 'A, B' }, 'authors_required'],
      [{ claimedRole: 'author' }, 'unexpected_field'],
      [{ fullName: '   ' }, 'name_required'],
      [{ fullName: 'x'.repeat(201) }, 'name_required'],
      [{ email: 'a@b' }, 'email_invalid'],
      [{ whatsapp: '123' }, 'whatsapp_invalid'],
      [{ file: undefined }, 'file_required'],
      [{ file: { name: 'a.exe', size: 1, type: 'application/pdf' } }, 'file_type_invalid'],
      [{ file: { name: 'a.pdf', size: 1, type: 'application/octet-stream' } }, 'file_type_invalid'],
      [{ file: { name: '.pdf', size: 1, type: 'application/pdf' } }, 'file_type_invalid'],
      [{ file: { name: 'a.pdf', size: -1, type: 'application/pdf' } }, 'file_size_invalid'],
      [{ file: { name: 'a.pdf', size: '100', type: 'application/pdf' } }, 'file_size_invalid'],
      [{ file: { name: 'a.pdf', size: 20971521, type: 'application/pdf' } }, 'file_size_invalid'],
    ]
    for (const [over, reason] of cases) assert.strictEqual(validateIntentBody({ ...good(), ...over }).error, reason, JSON.stringify(over))
    assert.strictEqual(validateIntentBody(null).error, 'invalid_body')
    assert.strictEqual(validateIntentBody([]).error, 'invalid_body')
  })

  await check('handlers: an invalid request is refused before the database is reached', async () => {
    const r = await handleCreateIntent({ body: { ...good(), accepted: false }, env: ENV, supabase: untouchable, storage: untouchable, clientKey: 'k' })
    assert.strictEqual(r.status, 400)
    const f = await handleFinalize({ body: { intentId: 'not-a-uuid', intentToken: 'x' }, env: ENV, supabase: untouchable, storage: untouchable, clientKey: 'k' })
    assert.strictEqual(f.status, 400)
  })

  await check('handlers: off unless enabled, and unusable without a strong secret', async () => {
    for (const env of [{}, { SUBMISSION_ACCEPTANCE_FLOW: 'yes' }, { SUBMISSION_ACCEPTANCE_FLOW: 'disabled', SUBMISSION_TOKEN_SECRET: SECRET }]) {
      assert.strictEqual((await handleCreateIntent({ body: good(), env, supabase: untouchable, storage: untouchable })).status, 404)
      assert.strictEqual((await handleTerms({ env, supabase: untouchable })).status, 404)
    }
    const weak = await handleFinalize({ body: {}, env: { SUBMISSION_ACCEPTANCE_FLOW: 'enabled', SUBMISSION_TOKEN_SECRET: 'short' }, supabase: untouchable, storage: untouchable })
    assert.strictEqual(weak.status, 503)
  })

  await check('tokens: the confirmation token is stable per intent token, distinct across them, and secret-bound', () => {
    const a = confirmationTokenFor(SECRET, 'intent-a')
    assert.match(a, /^[0-9a-f]{64}$/)
    assert.strictEqual(confirmationTokenFor(SECRET, 'intent-a'), a)
    assert.notStrictEqual(confirmationTokenFor(SECRET, 'intent-b'), a)
    assert.notStrictEqual(confirmationTokenFor('y'.repeat(40), 'intent-a'), a)
  })

  await check('offer: signed, bound to its secret, tamper-evident and time-limited', () => {
    const agreements = [{ id: 'a', sha256: 'b'.repeat(64) }]
    const { token } = signOffer(SECRET, { decision: 'manual', agreements })
    assert.strictEqual(verifyOffer(SECRET, token).offer.d, 'manual')
    const [body, mac] = token.split('.')
    const p = JSON.parse(Buffer.from(body, 'base64url').toString())
    const widened = `${Buffer.from(JSON.stringify({ ...p, d: 'automatic' })).toString('base64url')}.${mac}`
    assert.strictEqual(verifyOffer(SECRET, widened).error, 'offer_invalid')
    assert.strictEqual(verifyOffer('y'.repeat(40), token).error, 'offer_invalid')
    for (const t of [undefined, '', 'x', 'a.b.c', `${body}.`]) assert.strictEqual(verifyOffer(SECRET, t).error, 'offer_invalid', String(t))
    const old = signOffer(SECRET, { decision: 'automatic', agreements, now: Date.now() - 31 * 60_000 }).token
    assert.deepStrictEqual(verifyOffer(SECRET, old), { error: 'offer_stale', staleBecause: 'offer_expired' })
  })

  await check('upload authorization: its own expiry is read from the token; unreadable means unknown', () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
    assert.strictEqual(authorizationExpiry(`${b64({ alg: 'HS256' })}.${b64({ exp: 2000000000 })}.sig`), new Date(2000000000 * 1000).toISOString())
    for (const t of [undefined, '', 'x', `a.${b64({})}.c`, `a.${b64({ exp: 'soon' })}.c`]) assert.strictEqual(authorizationExpiry(t), null)
  })

  await check('routes: the request-limit key is the first forwarded address', () => {
    const req = (h) => ({ headers: { get: (k) => h[k] ?? null } })
    assert.strictEqual(clientKeyOf(req({ 'x-forwarded-for': '203.0.113.1, 10.0.0.1' })), '203.0.113.1')
    assert.strictEqual(clientKeyOf(req({ 'x-real-ip': '203.0.113.2' })), '203.0.113.2')
    assert.strictEqual(clientKeyOf(req({})), 'unknown')
  })

  await check('migration 0012: nothing granted to anon; every function pins search_path; old path left open', () => {
    const code = migration.replace(/--[^\n]*/g, '')
    assert.ok(!/\bgrant\s+[^;]*\bto\s+[^;]*\banon\b/i.test(code), 'no grant to anon')
    const fns = migration.match(/create or replace function [^(]+\(/g) || []
    const bodies = migration.split(/create or replace function /).slice(1)
    assert.strictEqual(fns.length, bodies.length)
    for (const b of bodies) assert.ok(/security definer\s+set search_path = /.test(b), b.slice(0, 60))
    assert.ok(!/drop policy|revoke[^;]*submit_paper/i.test(migration), 'the old path is closed later, not here')
    // Every function is revoked from public/anon/authenticated and granted
    // to service_role with its exact current signature.
    const sigs = [...code.matchAll(/create or replace function (\w+)\(([^)]*)\)/g)].map(([, name, params]) => {
      const types = params.split(',').map((x) => x.trim().split(/\s+/)[1]).filter(Boolean).join(', ')
      return `${name}(${types})`
    }).filter((sig) => !sig.startsWith('stamp_submission_extraction_policy'))
    assert.ok(sigs.length >= 7, sigs.join(' '))
    for (const sig of sigs) {
      const esc = sig.replace(/[()]/g, '\\$&')
      assert.ok(new RegExp(`revoke all on function ${esc} from public, anon, authenticated;`).test(code), `revoke ${sig}`)
      assert.ok(new RegExp(`grant execute on function ${esc} to service_role;`).test(code), `grant ${sig}`)
    }
  })

  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

main()
