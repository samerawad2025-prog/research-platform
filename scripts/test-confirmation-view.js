#!/usr/bin/env node
//
// Tests for which screen the confirmation page shows (Phase 3 M1), and
// for the English/Arabic hand-entry wording.
//
// Run: node scripts/test-confirmation-view.js
// Exits non-zero on failure, so it is usable as a CI step.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { deriveView } = require('../lib/fields/confirmationView')

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

const paper = (extraction_status, extra = {}) => ({ extraction_status, metadata_confirmed_at: null, ...extra })
const view = (p, o = {}) => deriveView({ paper: p, ...o })

check('manual mode: a new submission opens straight into hand entry, never a waiting screen', () => {
  for (const s of ['pending', 'processing']) {
    assert.deepStrictEqual(view(paper(s), { manualMode: true }), { view: 'form', manual: true, reason: 'mode' }, s)
  }
})

check('a stored manual decision survives a refresh, in either mode, whatever extraction did', () => {
  // A reload knows nothing of the earlier visit's React state; only the
  // stored decision (get_paper_for_confirmation) carries it.
  for (const status of ['pending', 'processing', 'failed', 'completed', 'partial']) {
    for (const manualMode of [false, true]) {
      const m = view(paper(status, { manual_entry_source: 'mode', failure_code: 'timeout' }), { manualMode })
      assert.deepStrictEqual(m, { view: 'form', manual: true, reason: 'mode' }, `${status}/${manualMode}`)
      const r = view(paper(status, { manual_entry_source: 'researcher', failure_code: 'timeout' }), { manualMode })
      // Chosen before any reading (still pending) is not a fallback.
      const expected = status === 'pending' ? 'chosen' : 'fallback'
      assert.deepStrictEqual(r, { view: 'form', manual: true, reason: expected }, `${status}/${manualMode}`)
    }
  }
})

check('a stored choice outranks a late not-research result', () => {
  const p = paper('failed', { document_type: 'not_research', manual_entry_source: 'researcher' })
  assert.deepStrictEqual(view(p), { view: 'form', manual: true, reason: 'fallback' })
})

check('without a stored decision, a reload in automatic mode waits again (the choice must be stored to persist)', () => {
  assert.strictEqual(view(paper('processing')).view, 'extracting')
})

check('automatic mode: pending and processing still wait for the result', () => {
  assert.strictEqual(view(paper('pending')).view, 'extracting')
  assert.strictEqual(view(paper('processing')).view, 'extracting')
  assert.strictEqual(view(null).view, 'extracting')
})

check('automatic mode: choosing hand entry ends the wait immediately', () => {
  assert.deepStrictEqual(view(paper('processing'), { manualChoice: true }), { view: 'form', manual: true, reason: 'fallback' })
  assert.deepStrictEqual(view(paper('failed', { failure_code: 'timeout' }), { manualChoice: true }), { view: 'form', manual: true, reason: 'fallback' })
})

check('failures keep their distinct screens (BUG_HISTORY #7), each now offering hand entry', () => {
  assert.strictEqual(view(paper('failed', { failure_code: 'timeout' })).view, 'transient')
  assert.strictEqual(view(paper('failed', { failure_code: 'api_error' })).view, 'transient')
  assert.strictEqual(view(paper('failed', { failure_code: 'encrypted_document' })).view, 'encrypted')
  assert.strictEqual(view(paper('failed', { failure_code: 'max_tokens' })).view, 'failed')
  assert.strictEqual(view(paper('failed', { failure_code: null })).view, 'failed')
})

check('manual mode: a failure goes straight to hand entry rather than a retry that would be refused', () => {
  assert.deepStrictEqual(view(paper('failed', { failure_code: 'timeout' }), { manualMode: true }), { view: 'form', manual: true, reason: 'fallback' })
})

check('not-research stays its own notice, in either mode', () => {
  const p = paper('failed', { document_type: 'not_research' })
  assert.strictEqual(view(p).view, 'notResearch')
  assert.strictEqual(view(p, { manualMode: true }).view, 'notResearch')
})

check('a confirmed record always opens as the editable record, never a failure or a wait', () => {
  const at = '2026-09-20T10:00:00Z'
  assert.deepStrictEqual(view(paper('completed', { metadata_confirmed_at: at })), { view: 'form', manual: false, reason: null })
  assert.deepStrictEqual(view(paper('partial', { metadata_confirmed_at: at })), { view: 'form', manual: false, reason: null })
  for (const s of ['pending', 'processing', 'failed']) {
    const v = view(paper(s, { metadata_confirmed_at: at, failure_code: 'timeout', document_type: 'not_research' }))
    assert.strictEqual(v.view, 'form', s)
    assert.strictEqual(v.manual, true, s)
  }
})

check('completed and partial results are reviewed, not hand-entered', () => {
  assert.deepStrictEqual(view(paper('completed')), { view: 'form', manual: false, reason: null })
  assert.deepStrictEqual(view(paper('partial')), { view: 'form', manual: false, reason: null })
  assert.deepStrictEqual(view(paper('completed'), { manualMode: true }), { view: 'form', manual: false, reason: null })
})

// --- wording ------------------------------------------------------------------
// lib/i18n.jsx is JSX and cannot be required here, so the two `manual`
// blocks are read from the source. Crude, but it checks what matters:
// both languages carry every key, and neither leaks configuration.
const screenSrc = fs.readFileSync(path.join(__dirname, '../components/ConfirmationScreen.jsx'), 'utf8')
const i18n = fs.readFileSync(path.join(__dirname, '../lib/i18n.jsx'), 'utf8')
function manualBlocks() {
  const blocks = []
  const re = /\n      manual: \{\n([\s\S]*?)\n      \},\n/g
  let m
  while ((m = re.exec(i18n))) blocks.push(m[1])
  return blocks
}
const keysOf = (block) => [...block.matchAll(/^\s{8}(\w+):/gm)].map((m) => m[1]).sort()

check('hand-entry wording exists in English and Arabic with the same keys', () => {
  const blocks = manualBlocks()
  assert.strictEqual(blocks.length, 2, 'one manual block per language')
  assert.deepStrictEqual(keysOf(blocks[0]), keysOf(blocks[1]))
  assert.deepStrictEqual(keysOf(blocks[0]), ['chosenNote', 'emptyHint', 'enterYourself', 'fallbackNote', 'heading', 'orEnter', 'protectedNote', 'subtitle', 'switching', 'unavailable'])
  assert.strictEqual((i18n.match(/manualChoice:/g) || []).length, 2, 'the choice-not-recorded message in both languages')
  assert.ok(/[؀-ۿ]/.test(blocks[1]), 'the second block is Arabic')
  // The hand-off line between a stored submission and the next page: one in
  // the legacy form's block and one in the acceptance form's, per language.
  const opening = i18n.split('\n').filter((l) => /^\s*opening: '/.test(l))
  assert.strictEqual(opening.length, 4, 'the hand-off line in both forms and both languages')
  // Progress, never a completion message: nothing is finished until the
  // details are confirmed (the premature thank-you, 2026-10-04).
  for (const l of opening) assert.ok(!/thank|شكر/i.test(l), l)
})

check('hand-entry wording never exposes configuration or provider names', () => {
  const text = manualBlocks().join('\n') + i18n.split('\n').filter((l) => /^\s*opening:|manualChoice/.test(l)).join('\n')
  for (const word of ['EXTRACTION_MODE', 'Gemini', 'Google', 'mode', 'config', 'AI', 'provider', 'preview']) {
    assert.ok(!new RegExp(`\\b${word}\\b`).test(text), `"${word}" appears in user-facing wording`)
  }
})

check('free tier: no safe excerpt could be made - hand entry with its own note, never a retry, and the wording names nobody', () => {
  assert.deepStrictEqual(view(paper('failed', { failure_code: 'excerpt_unavailable' })), { view: 'form', manual: true, reason: 'protected' })
  // A decision recorded later still wins, and a confirmed record is the researcher's own.
  assert.strictEqual(view(paper('failed', { failure_code: 'excerpt_unavailable', manual_entry_source: 'researcher' })).reason, 'fallback')
  assert.strictEqual(view(paper('failed', { failure_code: 'excerpt_unavailable', metadata_confirmed_at: '2026-10-04T00:00:00Z' })).view, 'form')
  assert.strictEqual((i18n.match(/protectedNote:/g) || []).length, 2, 'English and Arabic')
  assert.strictEqual((i18n.match(/excerptNote:/g) || []).length, 2, 'English and Arabic')
  assert.ok(/showProtectedNote/.test(screenSrc) && /showExcerptNote/.test(screenSrc), 'the screen shows both notes')
})

check('a paper that can never be read (automatic_processing false) never waits, and is not offered a refused retry', () => {
  // Legacy form, pre-0018, or no applicable agreement (migration 0018).
  for (const s of ['pending', 'processing']) {
    assert.deepStrictEqual(view(paper(s, { automatic_processing: false })), { view: 'form', manual: true, reason: 'mode' }, s)
  }
  for (const code of ['api_error', 'timeout', 'internal', 'max_tokens', 'encrypted_document']) {
    assert.deepStrictEqual(view(paper('failed', { failure_code: code, automatic_processing: false })), { view: 'form', manual: true, reason: 'fallback' }, code)
  }
  // Results and reviews are unaffected; a not-research notice stays a notice.
  assert.deepStrictEqual(view(paper('completed', { automatic_processing: false })), { view: 'form', manual: false, reason: null })
  assert.strictEqual(view(paper('failed', { document_type: 'not_research', automatic_processing: false })).view, 'notResearch')
  // An older database (no key) behaves as before.
  assert.strictEqual(view(paper('pending')).view, 'extracting')
  assert.strictEqual(view(paper('failed', { failure_code: 'api_error' })).view, 'transient')
})

check('manual entry chosen before submitting is its own case, never the failure note', () => {
  const p = paper('pending', { manual_entry_source: 'researcher', automatic_processing: false })
  assert.deepStrictEqual(view(p), { view: 'form', manual: true, reason: 'chosen' })
  // Switching after a failure is still the fallback.
  assert.deepStrictEqual(view(paper('failed', { manual_entry_source: 'researcher', failure_code: 'timeout' })).reason, 'fallback')
})

if (failed) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
