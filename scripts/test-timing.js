#!/usr/bin/env node
//
// Regression test for stage timing (BUG_HISTORY.md #28) and for the
// abandoned-extraction reclaim rule (#27).
//
// Run: node scripts/test-timing.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// The rule that matters most for the reclaim: STALE_CLAIM_MS must stay
// strictly greater than maxDuration. If it ever drops below, two live
// extractions of the same paper become possible, which doubles the
// provider calls and breaks the two-call ceiling.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')

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

// --- the reclaim invariant, read from the source itself --------------------
const routeSrc = fs.readFileSync(path.join(__dirname, '../app/api/extract/route.js'), 'utf8')

function readNumber(pattern) {
  const m = routeSrc.match(pattern)
  if (!m) throw new Error(`could not find ${pattern} in the extract route`)
  return Number(m[1].replace(/_/g, ''))
}

check('STALE_CLAIM_MS is strictly greater than maxDuration', () => {
  const maxDurationSeconds = readNumber(/export const maxDuration = (\d+)/)
  const staleMs = readNumber(/const STALE_CLAIM_MS = ([\d_]+)/)
  assert.ok(
    staleMs > maxDurationSeconds * 1000,
    `STALE_CLAIM_MS (${staleMs}ms) must exceed maxDuration (${maxDurationSeconds}s = ${maxDurationSeconds * 1000}ms), ` +
      'otherwise a paper can be reclaimed while its original extraction is still running'
  )
})

check('the reclaim is an exact compare-and-swap, not a blind update', () => {
  // If this ever becomes a bare status update, two concurrent retries
  // could both claim the same abandoned paper.
  assert.ok(routeSrc.includes("claimQuery.eq('extraction_status', 'processing')"), 'reclaim must still match on the prior status')
  assert.ok(
    routeSrc.includes("claimQuery.eq('extraction_started_at', paper.extraction_started_at)"),
    'reclaim must match on the exact claim timestamp it read'
  )
})

check('every claim records when it happened', () => {
  assert.ok(
    routeSrc.includes('extraction_started_at: new Date().toISOString()'),
    'a claim that does not record its own time cannot be judged stale later'
  )
})

// --- the timing module -----------------------------------------------------
// sessionStorage does not exist in Node. The module is written to
// degrade to in-memory marks rather than throw, which is the same path
// a private-mode browser takes, so this exercises that path directly.
const timing = require('../lib/timing')

check('marks survive with no storage available (private-mode path)', () => {
  timing.clear('tok12345')
  timing.mark(null, 'submit_clicked')
  timing.mark(null, 'upload_complete', { file_bytes: 1024 })
  const summary = timing.summarize('tok12345')
  assert.ok(summary, 'a summary should still be produced without storage')
  assert.ok(summary.reached.includes('submit_clicked'))
  assert.ok(summary.reached.includes('upload_complete'))
})

check('the token is truncated before it can reach a log', () => {
  const summary = timing.summarize('abcdefghijklmnop')
  assert.strictEqual(summary.token_prefix.length, 8, 'a confirmation token must never be logged whole')
  assert.strictEqual(summary.token_prefix, 'abcdefgh')
})

check('durations are between consecutive reached stages', () => {
  const summary = timing.summarize('tok12345')
  const keys = Object.keys(summary.stages)
  assert.ok(keys.includes('submit_clicked__to__upload_complete'), `expected a submit->upload stage, got ${keys}`)
  for (const ms of Object.values(summary.stages)) {
    assert.ok(Number.isFinite(ms) && ms >= 0, 'a stage duration must be a non-negative number')
  }
})

check('unreached stages are reported as missing, never as zero', () => {
  const summary = timing.summarize('tok12345')
  assert.ok(summary.missing.includes('extraction_observed'), 'a stage never reached must appear in `missing`')
  assert.ok(
    !Object.keys(summary.stages).some((k) => k.includes('extraction_observed')),
    'a stage never reached must not appear as a zero-length duration'
  )
})

check('file size rides along with the upload mark', () => {
  const summary = timing.summarize('tok12345')
  assert.strictEqual(summary.meta.file_bytes, 1024, 'upload duration is meaningless without the byte count')
})

check('fewer than two marks yields no summary - there is no interval yet', () => {
  // Needs a clean process: the module holds pre-token marks in memory,
  // so asking the already-exercised instance would see this file's
  // earlier marks.
  const { execFileSync } = require('node:child_process')
  const out = execFileSync(process.execPath, [
    '-e',
    `const t = require(${JSON.stringify(path.join(__dirname, '../lib/timing.js'))});
     const none = t.summarize('fresh-token');
     t.mark(null, 'submit_clicked');
     const one = t.summarize('fresh-token');
     console.log(JSON.stringify({ none, one }));`,
  ]).toString()

  const { none, one } = JSON.parse(out)
  assert.strictEqual(none, null, 'no marks at all must summarize to null')
  assert.strictEqual(one, null, 'a single mark describes no interval, so it must summarize to null')
})

check('the stage list is ordered from click to visible fields', () => {
  assert.strictEqual(timing.STAGES[0], 'submit_clicked')
  assert.strictEqual(timing.STAGES[timing.STAGES.length - 1], 'fields_visible')
  assert.ok(
    timing.STAGES.indexOf('upload_complete') < timing.STAGES.indexOf('paper_created'),
    'the upload must be measured before the paper row - that ordering is the whole point'
  )
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
