// lib/validation/phone.js
//
// One place that decides what a usable WhatsApp number is, shared by
// the submission form's live validation and by anything later that
// needs to read a stored number back.
//
// Why a library at all: phone validity is not a regex problem. Sudan
// alone renumbered its mobile prefixes, and "how many digits is a
// valid mobile number" differs per country and per carrier block.
// libphonenumber-js carries Google's own metadata for that, and the
// `/min` entry point is the smallest of its three builds - enough for
// "is this valid" and "format as E.164", which is all this file needs.
// It is a pure-data dependency with no UI, no CSS and no runtime
// services, which is what makes it acceptable on this project's
// budget (see CLAUDE.md) where a heavier picker component was not.
//
// STORAGE CONTRACT: numbers are stored in E.164 ("+249912345678").
// This is deliberately compatible with the EXISTING database check in
// submit_paper - `^[+0-9][0-9+\-\s()]{5,24}$` - which an E.164 string
// always satisfies: it starts with "+" and its remaining 7-15 digits
// sit inside the 5-24 length window. So no migration is required and
// numbers stored before this change keep validating. Do not tighten
// the SQL pattern to require E.164 without first migrating the rows
// already stored in the looser format.

const {
  parsePhoneNumberFromString,
  getCountries,
  getCountryCallingCode,
  AsYouType,
} = require('libphonenumber-js/min')

const DEFAULT_COUNTRY = 'SD' // this platform's own users

// Intl.DisplayNames is built into Node 18+ and every browser this app
// targets, so country names cost no extra dependency. If it is ever
// unavailable the ISO code itself is a usable fallback rather than a
// crash.
function makeNamer(locale) {
  try {
    return new Intl.DisplayNames([locale], { type: 'region' })
  } catch {
    return null
  }
}

let cachedCountries = null

// [{ code: 'SD', callingCode: '249', name_en: 'Sudan', name_ar: 'السودان' }, ...]
// Sorted by English name. Built once — this is ~245 entries and never
// changes during a session.
function listCountries() {
  if (cachedCountries) return cachedCountries

  const en = makeNamer('en')
  const ar = makeNamer('ar')

  cachedCountries = getCountries()
    .map((code) => ({
      code,
      callingCode: getCountryCallingCode(code),
      name_en: en?.of(code) || code,
      name_ar: ar?.of(code) || code,
    }))
    .sort((a, b) => a.name_en.localeCompare(b.name_en))

  return cachedCountries
}

// Formats digits as the person types, in the chosen country's own
// national convention. Returns the input unchanged if it cannot be
// formatted, so typing never fights the cursor.
function formatAsYouType(input, country) {
  if (!input) return ''
  try {
    return new AsYouType(country || DEFAULT_COUNTRY).input(input)
  } catch {
    return input
  }
}

// The single validation entry point.
//
// Returns { state, e164, error } where state is one of:
//   'empty'   - nothing typed. The field is OPTIONAL, so this is valid.
//   'valid'   - a real, dialable number for that country.
//   'invalid' - something was typed but it is not a usable number.
//
// `error` is user-facing text, or null. It is deliberately specific:
// "too short" and "not a number we recognise" send someone to
// different fixes, and collapsing them into one message is the exact
// mistake BUG_HISTORY.md #7 records.
function validateWhatsApp(raw, country = DEFAULT_COUNTRY) {
  const input = String(raw ?? '').trim()

  if (input === '') {
    return { state: 'empty', e164: null, error: null }
  }

  // A number typed with its own "+" prefix is already international,
  // so the selected country must not override it.
  const parsed = input.startsWith('+')
    ? safeParse(input, undefined)
    : safeParse(input, country)

  if (!parsed) {
    return {
      state: 'invalid',
      e164: null,
      error: 'That doesn’t look like a phone number. Please check it, or leave it empty.',
    }
  }

  if (!parsed.isValid()) {
    const digits = input.replace(/\D/g, '')
    const error =
      digits.length < 6
        ? 'That number looks too short. Please enter the full number.'
        : 'That number isn’t valid for the country selected. Please check it.'
    return { state: 'invalid', e164: null, error }
  }

  return { state: 'valid', e164: parsed.number, error: null }
}

function safeParse(input, country) {
  try {
    return parsePhoneNumberFromString(input, country) || null
  } catch {
    return null
  }
}

// Given an already-stored number, work out which country to preselect
// so an existing value round-trips through the picker unchanged.
function countryOf(e164, fallback = DEFAULT_COUNTRY) {
  const parsed = safeParse(String(e164 ?? '').trim(), undefined)
  return parsed?.country || fallback
}

module.exports = {
  DEFAULT_COUNTRY,
  listCountries,
  formatAsYouType,
  validateWhatsApp,
  countryOf,
}
