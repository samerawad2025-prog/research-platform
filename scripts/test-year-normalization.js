#!/usr/bin/env node
//
// Regression test for year normalization (BUG_HISTORY.md #18).
//
// Run: node scripts/test-year-normalization.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// The case that matters most is the real one: a Sudanese thesis whose
// cover page reads "٢٠١٩م". papers.year is an integer column, so before
// this fix that value was handed straight to Postgres, the whole UPDATE
// was rejected, and the paper was stranded in 'processing'.

const assert = require('node:assert')
const { normalizeYear, buildPapersUpdate } = require('../lib/extraction/applyResult')

const cases = [
  // [input, expected, why]
  ['٢٠١٩م', 2019, 'the real production value that stranded a paper'],
  ['٢٠١٩', 2019, 'Arabic-Indic digits, no suffix'],
  ['۲۰۱۹', 2019, 'Eastern Arabic-Indic / Persian digits'],
  ['2019', 2019, 'plain ASCII string'],
  [2019, 2019, 'already an integer'],
  ['2019م', 2019, 'ASCII digits with Arabic era suffix'],
  [' 2019 ', 2019, 'surrounding whitespace'],
  ['Submitted 2019', 2019, 'year embedded in a sentence'],

  // Omitted: storing a wrong year is worse than storing none. The value
  // still reaches the confirmation screen for the submitter to correct.
  ['١٤٤٥', null, 'Hijri year - a valid integer but the WRONG Gregorian year'],
  ['1445', null, 'Hijri in ASCII - same reasoning'],
  ['1445 AH', null, 'explicitly Hijri'],
  ['١٩٩٥ – ٢٠١٧م', null, 'a span the work covers, not its own year'],
  ['1995-2017', null, 'ASCII span'],
  ['n.d.', null, 'no date'],
  ['', null, 'empty string'],
  ['العام غير محدد', null, 'Arabic text with no digits at all'],
  ['19', null, 'two digits - not a year'],
  ['20194', 2019, 'five digits: first 4-digit run is in range'],
  [null, null, 'null'],
  [undefined, null, 'undefined'],
  [{ value: 2019 }, null, 'unexpected object shape'],
  [2019.5, null, 'non-integer number'],
  [1899, null, 'below the accepted range'],
  [2101, null, 'above the accepted range'],
]

let failed = 0
for (const [input, expected, why] of cases) {
  let actual
  try {
    actual = normalizeYear(input)
  } catch (err) {
    console.error(`THREW  ${JSON.stringify(input)} — ${err.message}  (${why})`)
    failed++
    continue
  }
  if (actual === expected) {
    console.log(`ok     ${JSON.stringify(input)} -> ${actual}  (${why})`)
  } else {
    console.error(`FAIL   ${JSON.stringify(input)} -> ${actual}, expected ${expected}  (${why})`)
    failed++
  }
}

// The whole point of the fix: one unusable year must not take the other
// eight fields down with it. This mirrors the real stranded paper,
// whose Arabic title and abstract were extracted perfectly.
const realArabicThesis = {
  title: { status: 'not_found' },
  title_ar: { status: 'found', value: 'دور التمويل الزراعي في التنمية الاقتصادية في السودان' },
  abstract_ar: { status: 'found', value: 'ملخص الدراسة' },
  university: { status: 'found', value: 'جامعة النيلين' },
  degree_type: { status: 'found', value: 'الماجستير في الاقتصاد' },
  year: { status: 'found', value: '٢٠١٩م' },
  supervisor_name: { status: 'ambiguous', candidates: ['a', 'b'] },
}

const update = buildPapersUpdate(realArabicThesis)

try {
  assert.strictEqual(update.year, 2019, 'year should be coerced to an integer')
  assert.strictEqual(update.title_ar, realArabicThesis.title_ar.value, 'Arabic title must survive')
  assert.strictEqual(update.university, 'جامعة النيلين', 'university must survive')
  assert.strictEqual(update.degree_type, 'الماجستير في الاقتصاد', 'degree must survive')
  assert.ok(!('title' in update), 'not_found fields stay out of the update')
  assert.ok(!('supervisor_name' in update), 'ambiguous fields stay out of the update')
  console.log('ok     buildPapersUpdate preserves every other field alongside a coerced year')
} catch (err) {
  console.error(`FAIL   ${err.message}`)
  failed++
}

// An unusable year is omitted, never written as null or a guess.
const unusableYear = buildPapersUpdate({ year: { status: 'found', value: '١٤٤٥' } })
try {
  assert.deepStrictEqual(unusableYear, {}, 'an unusable year yields no year key at all')
  console.log('ok     an unusable year is omitted rather than guessed or nulled')
} catch (err) {
  console.error(`FAIL   ${err.message}`)
  failed++
}

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log(`\nAll ${cases.length + 2} checks passed.`)
