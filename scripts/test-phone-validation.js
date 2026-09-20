#!/usr/bin/env node
//
// Regression test for WhatsApp validation and E.164 storage.
//
// Run: node scripts/test-phone-validation.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// The load-bearing assertion is the last group: every number this
// accepts must still satisfy the EXISTING submit_paper SQL check,
// because that constraint is live in production and this change ships
// without a migration.

const assert = require('node:assert')
const { validateWhatsApp, listCountries, countryOf, formatAsYouType, DEFAULT_COUNTRY } = require('../lib/validation/phone')

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

// --- the field is optional -------------------------------------------------
for (const empty of ['', '   ', null, undefined]) {
  check(`empty input (${JSON.stringify(empty)}) is valid and stores null`, () => {
    const r = validateWhatsApp(empty)
    assert.strictEqual(r.state, 'empty')
    assert.strictEqual(r.e164, null)
    assert.strictEqual(r.error, null)
  })
}

// --- accepted, and normalized to E.164 -------------------------------------
const accepted = [
  ['0912345678', 'SD', '+249912345678', 'Sudanese mobile with national leading zero'],
  ['912345678', 'SD', '+249912345678', 'same number without the leading zero'],
  ['09 123 456 78', 'SD', '+249912345678', 'spaces as typed by a human'],
  ['+249912345678', 'SD', '+249912345678', 'already E.164'],
  ['+20 100 123 4567', 'SD', '+201001234567', 'an Egyptian number overrides the selected country'],
  ['+44 7400 123456', 'SD', '+447400123456', 'a UK mobile, country taken from the + prefix'],
]

for (const [input, country, expected, why] of accepted) {
  check(`accepts ${JSON.stringify(input)} -> ${expected}  (${why})`, () => {
    const r = validateWhatsApp(input, country)
    assert.strictEqual(r.state, 'valid', `expected valid, got ${r.state} (${r.error})`)
    assert.strictEqual(r.e164, expected)
    assert.strictEqual(r.error, null)
  })
}

// --- rejected, each with a message that points somewhere useful ------------
const rejected = [
  ['123', 'SD', 'far too short'],
  ['abcdefgh', 'SD', 'letters only'],
  ['+', 'SD', 'a lone plus'],
  ['00000000000', 'SD', 'right length, not a real number'],
  ['+249000', 'SD', 'valid prefix, impossible subscriber number'],
]

for (const [input, country, why] of rejected) {
  check(`rejects ${JSON.stringify(input)}  (${why})`, () => {
    const r = validateWhatsApp(input, country)
    assert.strictEqual(r.state, 'invalid', `expected invalid, got ${r.state}`)
    assert.strictEqual(r.e164, null)
    assert.ok(r.error && r.error.length > 0, 'an invalid number must carry a message')
  })
}

check('a too-short number gets a different message than an unrecognised one', () => {
  const short = validateWhatsApp('123', 'SD').error
  const bogus = validateWhatsApp('00000000000', 'SD').error
  assert.notStrictEqual(short, bogus)
})

// --- DATABASE COMPATIBILITY ------------------------------------------------
// submit_paper rejects anything not matching this, and it is live in
// production. Every value this module is willing to store must pass it,
// or a number the form accepts would be refused by the RPC.
const SQL_CHECK = /^[+0-9][0-9+\-\s()]{5,24}$/

check('every accepted number still satisfies the live submit_paper SQL check', () => {
  for (const [input, country, expected] of accepted) {
    const r = validateWhatsApp(input, country)
    assert.ok(SQL_CHECK.test(r.e164), `${expected} (from ${input}) would be rejected by the database`)
  }
})

check('the longest possible E.164 number still fits the SQL length window', () => {
  // E.164 caps at 15 digits; with the "+" that is 16 characters, well
  // inside the check's 1 + 5..24 window.
  const longest = '+' + '9'.repeat(15)
  assert.ok(SQL_CHECK.test(longest))
})

// --- country list ----------------------------------------------------------
check('the country list is populated and carries calling codes', () => {
  const countries = listCountries()
  assert.ok(countries.length > 200, `expected a full country list, got ${countries.length}`)
  const sudan = countries.find((c) => c.code === 'SD')
  assert.ok(sudan, 'Sudan must be present')
  assert.strictEqual(sudan.callingCode, '249')
  assert.ok(sudan.name_en.length > 0 && sudan.name_ar.length > 0, 'both names must resolve')
})

check('the list is sorted and free of duplicates', () => {
  const countries = listCountries()
  const codes = countries.map((c) => c.code)
  assert.strictEqual(new Set(codes).size, codes.length, 'duplicate country codes')
  const names = countries.map((c) => c.name_en)
  assert.deepStrictEqual(names, [...names].sort((a, b) => a.localeCompare(b)))
})

check('Sudan is the default country for this platform', () => {
  assert.strictEqual(DEFAULT_COUNTRY, 'SD')
})

// --- round-tripping a stored value ----------------------------------------
check('a stored E.164 number resolves back to its own country', () => {
  assert.strictEqual(countryOf('+249912345678'), 'SD')
  assert.strictEqual(countryOf('+201001234567'), 'EG')
})

check('an unparseable stored value falls back rather than throwing', () => {
  assert.strictEqual(countryOf('nonsense'), 'SD')
  assert.strictEqual(countryOf(null), 'SD')
})

check('as-you-type formatting never throws and never loses digits', () => {
  for (const input of ['0', '09', '0912', '0912345678', '+249', 'abc', '']) {
    const out = formatAsYouType(input, 'SD')
    assert.strictEqual(typeof out, 'string')
    const inDigits = String(input).replace(/\D/g, '')
    const outDigits = out.replace(/\D/g, '')
    assert.strictEqual(outDigits, inDigits, `digits changed for ${JSON.stringify(input)}`)
  }
})

if (failed > 0) {
  console.error(`\n${failed} check(s) failed.`)
  process.exit(1)
}
console.log('\nAll checks passed.')
