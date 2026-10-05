#!/usr/bin/env node
//
// Phase 3 M2B/M3 checks that need no database or browser (CI): the
// browser flow's decisions (lib/submission/clientFlow.js), the agreement
// renderer's parser, and LinkedIn validation. The full browser-to-database
// flow is exercised against the local Supabase stack
// (supabase/tests/browser-e2e.test.js).
//
// Run: node scripts/test-submission-client.js

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

const flow = require('../lib/submission/clientFlow')
const { parseAgreement, acceptanceSentence } = require('../lib/submission/agreementMarkdown')
const { validateLinkedIn, publicLinkedIn, LINKEDIN_PROFILE } = require('../lib/validation/linkedin')
const { AGREEMENTS } = require('../lib/submission/agreements')
const { agreementText } = require('../lib/submission/agreementText')
const { validateIntentBody } = require('../lib/submission/acceptanceHandlers')

let failed = 0
function check(name, fn) {
  try {
    fn()
    console.log(`ok     ${name}`)
  } catch (err) {
    console.error(`FAIL   ${name} — ${err.message}`)
    failed++
  }
}

const ROOT = path.join(__dirname, '..')
const base = {
  offerToken: 'offer-1',
  agreementId: 'submission-terms-2026-09-25-en',
  accepted: true,
  publicationSetting: 'record_abstract',
  claimedRole: 'author',
  fullName: ' Sara ',
  email: 'sara@example.invalid ',
  whatsappE164: '+249912345678',
  authors: [''],
  file: { name: 'a.pdf', size: 10, type: 'application/pdf' },
}

check('intent body: exactly the server contract, trimmed; authors only for a depositor', () => {
  const b = flow.intentBody(base)
  assert.deepStrictEqual(Object.keys(b).sort(), ['accepted', 'agreementId', 'claimedRole', 'email', 'file', 'fullName', 'offerToken', 'processingChoice', 'publicationSetting', 'whatsapp'].sort())
  assert.strictEqual(b.processingChoice, 'manual', 'no explicit automatic choice is sent as manual')
  for (const c of [undefined, null, 'Automatic', true]) assert.strictEqual(flow.intentBody({ ...base, processingChoice: c }).processingChoice, 'manual', String(c))
  assert.strictEqual(flow.intentBody({ ...base, processingChoice: 'automatic' }).processingChoice, 'automatic')
  assert.strictEqual(b.fullName, 'Sara')
  assert.strictEqual(validateIntentBody(b).error, undefined, JSON.stringify(validateIntentBody(b)))
  const d = flow.intentBody({ ...base, claimedRole: 'authorized_depositor', authors: [' A ', '', 'B'], whatsappE164: null })
  assert.deepStrictEqual(d.authors, ['A', 'B'])
  assert.ok(!('whatsapp' in d))
  assert.strictEqual(validateIntentBody(d).value.authors.length, 2)
  assert.strictEqual(flow.intentBody({ ...base, accepted: 'yes' }).accepted, false)
})

check('snapshot: any change to what was accepted, or a new file selection, is a new intent; an unchanged retry reuses it', () => {
  const b = flow.intentBody(base)
  const key = flow.snapshotKey(b, 1)
  const intent = { key, expiresAt: new Date(Date.now() + 10 * 60_000).toISOString() }
  assert.strictEqual(flow.reusableIntent(intent, flow.snapshotKey(flow.intentBody(base), 1)), intent)
  for (const changed of [
    flow.snapshotKey(flow.intentBody({ ...base, publicationSetting: 'record_abstract_fulltext' }), 1),
    flow.snapshotKey(flow.intentBody({ ...base, agreementId: 'submission-terms-2026-09-25-ar' }), 1),
    flow.snapshotKey(flow.intentBody({ ...base, offerToken: 'offer-2' }), 1),
    flow.snapshotKey(flow.intentBody({ ...base, claimedRole: 'coauthor' }), 1),
    flow.snapshotKey(flow.intentBody({ ...base, processingChoice: 'automatic' }), 1),
    flow.snapshotKey(flow.intentBody({ ...base, email: 'x@example.invalid' }), 1),
    flow.snapshotKey(flow.intentBody({ ...base, file: { ...base.file, size: 11 } }), 1),
    flow.snapshotKey(b, 2), // same file attributes, chosen again
  ]) assert.strictEqual(flow.reusableIntent(intent, changed), null)
  assert.strictEqual(flow.reusableIntent({ ...intent, expiresAt: new Date(Date.now() + 30_000).toISOString() }, key), null, 'about to expire')
  assert.strictEqual(flow.reusableIntent(null, key), null)
})

check('intent responses: stale and invalid offers refresh; unavailable is never a fallback', () => {
  assert.deepStrictEqual(flow.classifyIntent(201, { intentId: 'i', upload: { token: 't' } }), { kind: 'ok' })
  assert.deepStrictEqual(flow.classifyIntent(409, { reason: 'offer_stale', staleBecause: 'processing_broadened' }), { kind: 'stale', why: 'processing_broadened' })
  assert.deepStrictEqual(flow.classifyIntent(409, { reason: 'offer_stale', staleBecause: 'agreement_changed' }), { kind: 'stale', why: 'agreement_changed' })
  assert.deepStrictEqual(flow.classifyIntent(400, { reason: 'offer_invalid' }), { kind: 'stale', why: 'offer_invalid' })
  assert.strictEqual(flow.classifyIntent(404, { reason: 'not_available' }).error, 'unavailable')
  assert.strictEqual(flow.classifyIntent(503, { reason: 'database_not_ready' }).error, 'unavailable')
  assert.strictEqual(flow.classifyIntent(429, {}).error, 'rateLimited')
  assert.strictEqual(flow.classifyIntent(400, { reason: 'authors_required' }).error, 'invalid')
  assert.strictEqual(flow.classifyIntent(201, {}).kind, 'error', 'a 201 without an authorization is not success')
})

check('upload results: an existing object is uploaded; link expiry is distinct from other failures', () => {
  assert.strictEqual(flow.classifyUpload(null), 'uploaded')
  assert.strictEqual(flow.classifyUpload({ statusCode: '409', message: 'The resource already exists' }), 'uploaded')
  assert.strictEqual(flow.classifyUpload({ statusCode: '400', message: 'jwt expired' }), 'linkExpired')
  assert.strictEqual(flow.classifyUpload({ statusCode: '403', message: 'invalid signature' }), 'linkExpired')
  assert.strictEqual(flow.classifyUpload({ message: 'The object exceeded the maximum allowed size' }), 'tooLarge')
  assert.strictEqual(flow.classifyUpload({ message: 'Failed to fetch' }), 'failed')
})

check('finalize results: retry is safe, expiry and bad objects discard the intent', () => {
  assert.strictEqual(flow.classifyFinalize(200, { confirmationToken: 'c' }).kind, 'done')
  assert.strictEqual(flow.classifyFinalize(409, { reason: 'upload_missing' }).kind, 'reupload')
  assert.strictEqual(flow.classifyFinalize(410, { reason: 'intent_expired' }).kind, 'expired')
  assert.deepStrictEqual(flow.classifyFinalize(422, { reason: 'object_size_mismatch' }), { kind: 'error', error: 'objectMismatch', discard: true })
  assert.strictEqual(flow.classifyFinalize(422, { reason: 'object_type_invalid' }).error, 'objectType')
  assert.strictEqual(flow.classifyFinalize(503, {}).kind, 'retry')
  assert.strictEqual(flow.classifyFinalize(502, null).kind, 'retry')
  assert.strictEqual(flow.classifyFinalize(429, {}).error, 'rateLimited')
})

check('pending/receipt storage: no file and no confirmation token kept; expiry is known', () => {
  const mem = new Map()
  global.window = { sessionStorage: { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) } }
  flow.savePending({ intentId: 'i', intentToken: 't', expiresAt: new Date(Date.now() + 60_000).toISOString(), uploaded: true, upload: { token: 'secret-upload' }, confirmationToken: 'never' })
  const raw = [...mem.values()].join('')
  assert.ok(!raw.includes('secret-upload') && !raw.includes('never'))
  assert.strictEqual(flow.readPending().expired, false)
  assert.strictEqual(flow.readPending(Date.now() + 120_000).expired, true)
  flow.clearPending()
  assert.strictEqual(flow.readPending(), null)
  flow.markReceived()
  assert.strictEqual(flow.takeReceived(), true)
  assert.strictEqual(flow.takeReceived(), false, 'one time only')
  delete global.window
  assert.strictEqual(flow.readPending(), null, 'no storage is not an error')
})

check('agreement text: served only when its hash matches; both languages parse with their exact acceptance sentence', () => {
  for (const a of AGREEMENTS) {
    const text = agreementText(a, ROOT)
    assert.ok(text, a.id)
    const blocks = parseAgreement(text)
    assert.ok(blocks.filter((b) => b.type === 'h').length >= 10, 'headings')
    assert.ok(blocks.some((b) => b.type === 'ul'), 'bullets')
    const sentence = acceptanceSentence(blocks)
    const raw = fs.readFileSync(path.join(ROOT, a.file), 'utf8').trim().split('\n').pop()
    assert.strictEqual(`**${sentence}**`, raw.trim(), 'the last line of the file, verbatim')
  }
  assert.strictEqual(agreementText({ ...AGREEMENTS[0], id: 'tampered', sha256: '0'.repeat(64) }, ROOT), null)
  assert.strictEqual(agreementText({ ...AGREEMENTS[0], id: 'missing', file: 'docs/legal/none.md' }, ROOT), null)
})

check('agreement parser: bold, bullets, line breaks; nothing becomes markup', () => {
  const blocks = parseAgreement('# T\n\n**Version:** 1  \n**Date:** x\n\n* **A:** one\n* two\n\n<script>alert(1)</script> **x')
  assert.deepStrictEqual(blocks[0], { type: 'h', level: 1, text: 'T' })
  assert.strictEqual(blocks[1].lines.length, 2)
  assert.deepStrictEqual(blocks[1].lines[0][0], { text: 'Version:', bold: true })
  assert.strictEqual(blocks[2].items.length, 2)
  assert.deepStrictEqual(blocks[3].lines[0], [{ text: '<script>alert(1)</script> **x' }], 'kept as text')
})

check('LinkedIn: one rule shared with the database; tidied input; public only when chosen', () => {
  assert.deepStrictEqual(validateLinkedIn('linkedin.com/in/sara'), { state: 'valid', url: 'https://linkedin.com/in/sara' })
  assert.strictEqual(validateLinkedIn('http://www.linkedin.com/in/sara/').url, 'https://www.linkedin.com/in/sara/')
  assert.strictEqual(validateLinkedIn('  ').state, 'empty')
  for (const bad of ['https://facebook.com/sara', 'javascript:alert(1)', 'https://www.linkedin.com/company/x', 'https://www.linkedin.com.evil.example/in/x', 'ftp://linkedin.com/in/x']) {
    assert.strictEqual(validateLinkedIn(bad).state, 'invalid', bad)
  }
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0013_linkedin_visibility_declared_authors.sql'), 'utf8')
  assert.ok(sql.includes("'^https://([a-z]{2,3}\\.)?(www\\.)?linkedin\\.com/in/[^/?#[:space:]]{1,100}/?$'"), 'the SQL rule')
  assert.ok(LINKEDIN_PROFILE.source.includes('linkedin\\.com\\/in\\/'), 'the JS rule')
  assert.strictEqual(publicLinkedIn({ linkedin_url: 'https://linkedin.com/in/a', linkedin_public: true }), 'https://linkedin.com/in/a')
  assert.strictEqual(publicLinkedIn({ linkedin_url: 'https://linkedin.com/in/a', linkedin_public: false }), null)
  assert.strictEqual(publicLinkedIn({ linkedin_url: 'https://linkedin.com/in/a' }), null, 'unspecified is private')
  assert.strictEqual(publicLinkedIn({ linkedin_url: 'https://evil.example', linkedin_public: true }), null)
})

check('Facebook: no interface text or component collects it any more', () => {
  for (const f of ['components/ConfirmationScreen.jsx', 'components/AcceptanceSubmissionForm.jsx', 'lib/i18n.jsx', 'lib/fields/researcherSeed.js']) {
    assert.ok(!/facebook/i.test(fs.readFileSync(path.join(ROOT, f), 'utf8')), f)
  }
})

check('migration 0014: closes every overload, verifies effective privileges, and is not applied by 0013', () => {
  const sql = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0014_close_legacy_submission_path.sql'), 'utf8').replace(/--[^\n]*/g, '')
  assert.ok(/drop policy if exists "anon can upload research files" on storage\.objects/.test(sql))
  assert.ok(/proname = 'submit_paper'/.test(sql) && /revoke all on function %s from public, anon, authenticated/.test(sql))
  assert.ok(/has_function_privilege\(role, p\.oid, 'execute'\)/.test(sql))
  assert.ok(/pg_policies/.test(sql))
  const m13 = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0013_linkedin_visibility_declared_authors.sql'), 'utf8').replace(/--[^\n]*/g, '')
  assert.ok(!/drop policy|revoke[^;]*submit_paper/i.test(m13), '0013 leaves the old path to 0014')
  assert.ok(!/\bgrant\s+[^;]*\bto\s+[^;]*\banon\b/i.test(m13), 'no new grant to anon')
})

if (failed) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
