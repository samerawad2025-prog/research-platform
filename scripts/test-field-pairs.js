#!/usr/bin/env node
//
// Regression test for the confirmation screen's language-pair display
// rules (BUG_HISTORY.md #20, #24).
//
// Run: node scripts/test-field-pairs.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// The rule that matters: a submitter must never be shown an empty box
// for a language their document is not written in. That is what led a
// real submitter to type "No title appeared for this research" into an
// English title field on an Arabic-only thesis.

const assert = require('node:assert')
const { looksArabic, isFieldVisible, needsLanguageLabel, routeByScript } = require('../lib/fields/languagePairs')

// The same shape the confirmation screen uses.
const FIELDS = [
  { key: 'title', pair: 'title_ar', primary: true },
  { key: 'title_ar', pair: 'title' },
  { key: 'supervisor_name' },
  { key: 'abstract', pair: 'abstract_ar', primary: true },
  { key: 'abstract_ar', pair: 'abstract' },
]

const byKey = (k) => FIELDS.find((f) => f.key === k)
const visible = (values) => FIELDS.filter((f) => isFieldVisible(f, values)).map((f) => f.key)

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

const ARABIC_TITLE = 'دور التمويل الزراعي في التنمية الاقتصادية في السودان'

// --- the real case ---------------------------------------------------------
check('an Arabic-only paper shows ONE title box, the Arabic one', () => {
  const values = { title: '', title_ar: ARABIC_TITLE, abstract: '', abstract_ar: 'ملخص' }
  assert.deepStrictEqual(visible(values), ['title_ar', 'supervisor_name', 'abstract_ar'])
})

check('an English-only paper shows ONE title box, the English one', () => {
  const values = { title: 'The Role of Agricultural Finance', title_ar: '', abstract: 'Abstract', abstract_ar: '' }
  assert.deepStrictEqual(visible(values), ['title', 'supervisor_name', 'abstract'])
})

check('a genuinely bilingual paper shows BOTH - real data is never hidden', () => {
  const values = { title: 'English title', title_ar: ARABIC_TITLE, abstract: 'En', abstract_ar: 'ملخص' }
  assert.deepStrictEqual(visible(values), ['title', 'title_ar', 'supervisor_name', 'abstract', 'abstract_ar'])
})

check('a pair with nothing on either side shows exactly one box, never two', () => {
  const values = { title: '', title_ar: '', abstract: '', abstract_ar: '' }
  assert.deepStrictEqual(visible(values), ['title', 'supervisor_name', 'abstract'])
})

check('whitespace is not content', () => {
  const values = { title: '   ', title_ar: ARABIC_TITLE }
  assert.strictEqual(isFieldVisible(byKey('title'), values), false)
  assert.strictEqual(isFieldVisible(byKey('title_ar'), values), true)
})

check('an unpaired field is always visible', () => {
  assert.strictEqual(isFieldVisible(byKey('supervisor_name'), {}), true)
})

check('missing keys behave like empty ones rather than throwing', () => {
  assert.deepStrictEqual(visible({}), ['title', 'supervisor_name', 'abstract'])
})

// --- labelling -------------------------------------------------------------
check('a lone box is NOT labelled by language', () => {
  const values = { title: '', title_ar: ARABIC_TITLE }
  assert.strictEqual(needsLanguageLabel(byKey('title_ar'), values), false)
})

check('both boxes on screen ARE labelled by language', () => {
  const values = { title: 'English title', title_ar: ARABIC_TITLE }
  assert.strictEqual(needsLanguageLabel(byKey('title'), values), true)
  assert.strictEqual(needsLanguageLabel(byKey('title_ar'), values), true)
})

// --- script detection ------------------------------------------------------
check('Arabic text is detected, Latin text is not', () => {
  assert.strictEqual(looksArabic(ARABIC_TITLE), true)
  assert.strictEqual(looksArabic('جامعة النيلين'), true)
  assert.strictEqual(looksArabic('The Role of Agricultural Finance'), false)
  assert.strictEqual(looksArabic('2019'), false)
  assert.strictEqual(looksArabic(''), false)
  assert.strictEqual(looksArabic(null), false)
  assert.strictEqual(looksArabic(undefined), false)
})

check('Arabic-Indic digits count as Arabic script', () => {
  assert.strictEqual(looksArabic('٢٠١٩'), true)
})

// --- routing typed text to the right column --------------------------------
check('Arabic typed into the lone fallback box lands in the Arabic column', () => {
  const out = routeByScript({ title: ARABIC_TITLE, title_ar: '' }, FIELDS)
  assert.strictEqual(out.title_ar, ARABIC_TITLE)
  assert.strictEqual(out.title, '')
})

check('English typed into the lone fallback box stays where it is', () => {
  const out = routeByScript({ title: 'An English Title', title_ar: '' }, FIELDS)
  assert.strictEqual(out.title, 'An English Title')
  assert.strictEqual(out.title_ar, '')
})

check('routing never overwrites a partner that already has content', () => {
  // Both boxes were on screen, so the submitter's own choice of box
  // is authoritative and must not be second-guessed by script.
  const out = routeByScript({ title: ARABIC_TITLE, title_ar: 'existing' }, FIELDS)
  assert.strictEqual(out.title, ARABIC_TITLE)
  assert.strictEqual(out.title_ar, 'existing')
})

check('routing applies to abstract as well as title', () => {
  const out = routeByScript({ abstract: 'ملخص الدراسة', abstract_ar: '' }, FIELDS)
  assert.strictEqual(out.abstract_ar, 'ملخص الدراسة')
  assert.strictEqual(out.abstract, '')
})

check('routing leaves unpaired fields untouched', () => {
  const out = routeByScript({ supervisor_name: 'د. محمد', title: '', title_ar: '' }, FIELDS)
  assert.strictEqual(out.supervisor_name, 'د. محمد')
})

check('routing does not mutate the object it was given', () => {
  const input = { title: ARABIC_TITLE, title_ar: '' }
  const out = routeByScript(input, FIELDS)
  assert.strictEqual(input.title, ARABIC_TITLE, 'input must be unchanged')
  assert.strictEqual(input.title_ar, '')
  assert.notStrictEqual(out, input)
})

check('an empty correction set routes to an empty correction set', () => {
  const out = routeByScript({ title: '', title_ar: '' }, FIELDS)
  assert.strictEqual(out.title, '')
  assert.strictEqual(out.title_ar, '')
})

// --- the end-to-end shape of the original failure --------------------------
check('the original failure cannot recur: no empty English box on an Arabic paper', () => {
  const values = { title: '', title_ar: ARABIC_TITLE }
  const shown = FIELDS.filter((f) => isFieldVisible(f, values)).map((f) => f.key)
  assert.ok(!shown.includes('title'), 'an empty English title box must not be rendered')
  assert.ok(shown.includes('title_ar'), 'the Arabic title the paper actually has must be shown')
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
