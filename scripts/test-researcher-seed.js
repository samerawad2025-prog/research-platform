#!/usr/bin/env node
//
// Regression test for researcher seeding (BUG_HISTORY.md #33).
//
// Run: node scripts/test-researcher-seed.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// The failure this guards against, measured in production: all three
// confirmed papers had their submitter detached from their own paper
// and were left linked only to email-less duplicate researcher rows.
// 18 researcher rows existed for 10 papers; exactly 8 had no email,
// which is 1 + 1 + 6 - precisely the three confirmations.
//
// The mechanism was a dropped id: seeding from extraction discarded
// every researcher_id, so confirm_researcher_metadata could not take
// its "update the existing row" branch and inserted instead, after
// which its reconciliation delete removed the submitter's link.

const assert = require('node:assert')
const { seedResearchers, normalizeName } = require('../lib/fields/researcherSeed')

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

const submitter = {
  researcher_id: 'c2107aff-0000-0000-0000-000000000001',
  full_name: 'Samer Habib',
  author_order: 1,
  linkedin_url: 'https://linkedin.com/in/samer',
  facebook_url: '',
}

// --- THE REGRESSION --------------------------------------------------------
check('THE REGRESSION: the submitter keeps their id when extraction names them', () => {
  const seeded = seedResearchers({
    extracted: { status: 'found', value: [{ name: 'Samer Habib', author_order: 1 }] },
    existing: [submitter],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded.length, 1)
  assert.strictEqual(
    seeded[0].researcher_id,
    submitter.researcher_id,
    'without the id the RPC inserts a duplicate and deletes the submitter link'
  )
})

check('an id carried across also carries that person’s social links', () => {
  const seeded = seedResearchers({
    extracted: { status: 'found', value: [{ name: 'Samer Habib', author_order: 1 }] },
    existing: [submitter],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded[0].linkedin_url, submitter.linkedin_url, 'an existing link must not be silently dropped')
})

check('a genuinely new co-author gets NO id, so the RPC inserts them', () => {
  const seeded = seedResearchers({
    extracted: {
      status: 'found',
      value: [
        { name: 'Samer Habib', author_order: 1 },
        { name: 'Fatima Ahmed', author_order: 2 },
      ],
    },
    existing: [submitter],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded[0].researcher_id, submitter.researcher_id)
  assert.ok(!('researcher_id' in seeded[1]), 'an unknown author must be inserted, not matched to somebody else')
  assert.strictEqual(seeded[1].full_name, 'Fatima Ahmed')
})

// --- name matching ---------------------------------------------------------
check('matching tolerates case and extra whitespace', () => {
  for (const written of ['samer habib', 'SAMER HABIB', '  Samer   Habib  ']) {
    const seeded = seedResearchers({
      extracted: { status: 'found', value: [{ name: written, author_order: 1 }] },
      existing: [submitter],
      alreadyConfirmed: false,
    })
    assert.strictEqual(seeded[0].researcher_id, submitter.researcher_id, `failed to match ${JSON.stringify(written)}`)
  }
})

check('Arabic names match', () => {
  const arabic = { researcher_id: 'ar-1', full_name: 'سامر حبيب', author_order: 1 }
  const seeded = seedResearchers({
    extracted: { status: 'found', value: [{ name: ' سامر حبيب ', author_order: 1 }] },
    existing: [arabic],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded[0].researcher_id, 'ar-1')
})

check('a different person is NOT matched', () => {
  const seeded = seedResearchers({
    extracted: { status: 'found', value: [{ name: 'Someone Else', author_order: 1 }] },
    existing: [submitter],
    alreadyConfirmed: false,
  })
  assert.ok(
    !('researcher_id' in seeded[0]),
    'a wrong match would attach one person’s contact details to another person’s name'
  )
})

check('two authors sharing a name cannot collapse onto one row', () => {
  const a = { researcher_id: 'id-a', full_name: 'Mohamed Ali', author_order: 1 }
  const b = { researcher_id: 'id-b', full_name: 'Mohamed Ali', author_order: 2 }
  const seeded = seedResearchers({
    extracted: {
      status: 'found',
      value: [
        { name: 'Mohamed Ali', author_order: 1 },
        { name: 'Mohamed Ali', author_order: 2 },
      ],
    },
    existing: [a, b],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded[0].researcher_id, 'id-a')
  assert.strictEqual(seeded[1].researcher_id, 'id-b')
})

check('one existing row cannot be claimed twice', () => {
  const seeded = seedResearchers({
    extracted: {
      status: 'found',
      value: [
        { name: 'Samer Habib', author_order: 1 },
        { name: 'Samer Habib', author_order: 2 },
      ],
    },
    existing: [submitter],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded[0].researcher_id, submitter.researcher_id)
  assert.ok(!('researcher_id' in seeded[1]), 'the second must not reuse the first’s id')
})

// --- fallbacks -------------------------------------------------------------
check('a confirmed paper is never reshaped by a later extraction', () => {
  const seeded = seedResearchers({
    extracted: { status: 'found', value: [{ name: 'Someone Else', author_order: 1 }] },
    existing: [submitter],
    alreadyConfirmed: true,
  })
  assert.strictEqual(seeded.length, 1)
  assert.strictEqual(seeded[0].full_name, 'Samer Habib', 'the stored list is authoritative once a human confirmed it')
  assert.strictEqual(seeded[0].researcher_id, submitter.researcher_id)
})

check('extraction finding nothing falls back to who is already on the paper', () => {
  const seeded = seedResearchers({ extracted: { status: 'not_found' }, existing: [submitter], alreadyConfirmed: false })
  assert.strictEqual(seeded[0].researcher_id, submitter.researcher_id)
})

check('an empty extracted list falls back rather than blanking the form', () => {
  const seeded = seedResearchers({ extracted: { status: 'found', value: [] }, existing: [submitter], alreadyConfirmed: false })
  assert.strictEqual(seeded[0].researcher_id, submitter.researcher_id)
})

check('nothing anywhere still yields one editable row', () => {
  const seeded = seedResearchers({ extracted: null, existing: [], alreadyConfirmed: false })
  assert.strictEqual(seeded.length, 1)
  assert.strictEqual(seeded[0].full_name, '')
  assert.strictEqual(seeded[0].author_order, 1)
})

check('missing and malformed inputs do not throw', () => {
  assert.doesNotThrow(() => seedResearchers({}))
  assert.doesNotThrow(() => seedResearchers({ extracted: undefined, existing: undefined }))
  assert.doesNotThrow(() => seedResearchers({ extracted: { status: 'found', value: 'nope' }, existing: null }))
})

check('author_order falls back to position when extraction omits it', () => {
  const seeded = seedResearchers({
    extracted: { status: 'found', value: [{ name: 'A' }, { name: 'B' }] },
    existing: [],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded[0].author_order, 1)
  assert.strictEqual(seeded[1].author_order, 2)
})

check('an existing row with no id cannot be matched against', () => {
  // Such a row cannot be updated by the RPC anyway; matching it would
  // produce a seed entry with researcher_id: undefined.
  const seeded = seedResearchers({
    extracted: { status: 'found', value: [{ name: 'Samer Habib', author_order: 1 }] },
    existing: [{ full_name: 'Samer Habib', author_order: 1 }],
    alreadyConfirmed: false,
  })
  assert.ok(!('researcher_id' in seeded[0]))
})

check('normalizeName handles null and undefined', () => {
  assert.strictEqual(normalizeName(null), '')
  assert.strictEqual(normalizeName(undefined), '')
})

// --- the production scenario, end to end -----------------------------------
check('the real c71a48b9 shape: 6 extracted authors, submitter among them', () => {
  const names = ['Samer Habib', 'Fatima Ahmed', 'Omar Salih', 'Huda Ali', 'Yasir Mo', 'Nada Idris']
  const seeded = seedResearchers({
    extracted: { status: 'found', value: names.map((name, i) => ({ name, author_order: i + 1 })) },
    existing: [submitter],
    alreadyConfirmed: false,
  })
  assert.strictEqual(seeded.length, 6)
  const withIds = seeded.filter((r) => r.researcher_id)
  assert.strictEqual(withIds.length, 1, 'exactly the one already known')
  assert.strictEqual(withIds[0].researcher_id, submitter.researcher_id)
  assert.ok(
    seeded.some((r) => r.researcher_id === submitter.researcher_id),
    'the submitter must survive the confirmation reconciliation'
  )
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
