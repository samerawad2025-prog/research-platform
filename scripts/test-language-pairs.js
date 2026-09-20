#!/usr/bin/env node
//
// Regression test for the language-pair rules (BUG_HISTORY.md #20, #21).
//
// Run: node scripts/test-language-pairs.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// The case that matters is the real one: a Sudanese thesis written
// only in Arabic. `title` is legitimately not_found and `title_ar` is
// found. Before this fix that absence:
//   - triggered a second Gemini call to re-confirm it (real cost), and
//   - was presented to the submitter as a field they had to fill in,
//     which a real submitter did, by typing a sentence that became the
//     paper's permanent title.

const assert = require('node:assert')
const {
  getMissingCriticalFields,
  getAllMissingFields,
  isMissingConsideringLanguage,
} = require('../lib/extraction/orchestrator')

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

const found = (value) => ({ status: 'found', value })
const notFound = () => ({ status: 'not_found' })

// The actual pass-1 payload recorded for paper d5c7b51e: an Arabic
// thesis where everything was extracted correctly and `title` was
// correctly reported absent.
const realArabicThesis = {
  document_type: 'thesis',
  title: notFound(),
  title_ar: found('دور التمويل الزراعي في التنمية الاقتصادية في السودان'),
  abstract: found('The issue of agricultural finance...'),
  abstract_ar: found('تعتبر قضية التمويل الزراعي'),
  supervisor_name: found('د. محمد'),
  year: found('٢٠١٩م'),
  university: found('جامعة النيلين'),
  faculty: found('كلية الاقتصاد'),
  degree_type: found('الماجستير في الاقتصاد'),
  researchers: found([{ name: 'سامر', author_order: 1 }]),
}

check('an Arabic-only title does not trigger a second provider call', () => {
  assert.deepStrictEqual(getMissingCriticalFields(realArabicThesis), [])
})

check('an Arabic-only title is not reported as a missing field', () => {
  assert.deepStrictEqual(getAllMissingFields(realArabicThesis), [])
})

check('the mirror case holds: an English-only paper does not chase title_ar', () => {
  const englishOnly = {
    ...realArabicThesis,
    title: found('The Role of Agricultural Finance'),
    title_ar: notFound(),
    abstract_ar: notFound(),
  }
  assert.deepStrictEqual(getMissingCriticalFields(englishOnly), [])
  assert.deepStrictEqual(getAllMissingFields(englishOnly), [])
})

check('a title missing in BOTH languages is still chased', () => {
  const noTitleAtAll = { ...realArabicThesis, title: notFound(), title_ar: notFound() }
  assert.deepStrictEqual(getMissingCriticalFields(noTitleAtAll), ['title'])
  assert.ok(getAllMissingFields(noTitleAtAll).includes('title'))
  assert.ok(getAllMissingFields(noTitleAtAll).includes('title_ar'))
})

check('a genuinely missing non-paired field is unaffected', () => {
  const noSupervisor = { ...realArabicThesis, supervisor_name: notFound() }
  assert.deepStrictEqual(getMissingCriticalFields(noSupervisor), ['supervisor_name'])
})

check('year is still chased when absent - it has no language partner', () => {
  const noYear = { ...realArabicThesis, year: notFound() }
  assert.deepStrictEqual(getMissingCriticalFields(noYear), ['year'])
})

check('researchers missing still triggers pass 2', () => {
  const noResearchers = { ...realArabicThesis, researchers: notFound() }
  assert.deepStrictEqual(getMissingCriticalFields(noResearchers), ['researchers'])
})

// An 'ambiguous' partner is NOT a confident answer, so it must not
// suppress the chase. This is the boundary the UI relies on too.
check('an ambiguous partner does not satisfy a missing field', () => {
  const ambiguousPartner = {
    ...realArabicThesis,
    title: notFound(),
    title_ar: { status: 'ambiguous', candidates: ['a', 'b'] },
  }
  assert.deepStrictEqual(getMissingCriticalFields(ambiguousPartner), ['title'])
})

check('a conflicting partner DOES satisfy it - both sides found something real', () => {
  const conflictingPartner = {
    ...realArabicThesis,
    title: notFound(),
    title_ar: { status: 'conflicting', candidates: [{ value: 'a' }, { value: 'b' }] },
  }
  assert.strictEqual(isMissingConsideringLanguage(conflictingPartner, 'title'), false)
})

check('not_research still short-circuits before any language logic', () => {
  const cv = { document_type: 'not_research', title: notFound(), title_ar: notFound(), researchers: notFound(), year: notFound() }
  assert.deepStrictEqual(getMissingCriticalFields(cv), [])
})

check('abstract pairs the same way as title', () => {
  const arabicAbstractOnly = { ...realArabicThesis, abstract: notFound() }
  assert.ok(!getAllMissingFields(arabicAbstractOnly).includes('abstract'))
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
