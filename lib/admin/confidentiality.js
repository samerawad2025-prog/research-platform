// lib/admin/confidentiality.js
//
// The volunteer confidentiality text (docs/legal/volunteer-confidentiality.*.md,
// currently a DRAFT for the founder to review). The application serves a
// text only if its SHA-256 is the one recorded here AND in the database
// (confidentiality_versions), and a volunteer's acknowledgement is recorded
// with the hash of the text the SERVER served, never one the browser
// claims. scripts/test-admin-handlers.js checks these hashes against the
// files and against migration 0015's seed.
//
// A new wording is a new entry and a new database row, never an edit.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const VERSIONS = [
  {
    id: 'volunteer-confidentiality-2026-09-29',
    versionLabel: 'Draft 1',
    versionDate: '2026-09-29',
    files: { en: 'docs/legal/volunteer-confidentiality.en.md', ar: 'docs/legal/volunteer-confidentiality.ar.md' },
    sha256: {
      en: '32a2b2348fb2fcd7988acb959a3b1bcf194b1ba96c0b262edd18908da0731f8f',
      ar: '02c7d379e6e49483799882a0fd60c302bba95dac7a255fb686e96fd662b89f33',
    },
  },
]

function findVersion(id) {
  return VERSIONS.find((v) => v.id === id) || null
}

// { id, versionLabel, versionDate, texts: { en: { text, sha256 }, ar: {...} } }
// or null when the version is unknown or any file no longer matches.
function loadConfidentiality(id, root = process.cwd()) {
  const v = findVersion(id)
  if (!v) return null
  const texts = {}
  for (const lang of ['en', 'ar']) {
    try {
      const bytes = fs.readFileSync(path.join(root, v.files[lang]))
      const sha = crypto.createHash('sha256').update(bytes).digest('hex')
      if (sha !== v.sha256[lang]) return null
      texts[lang] = { text: bytes.toString('utf8'), sha256: sha }
    } catch {
      return null
    }
  }
  return { id: v.id, versionLabel: v.versionLabel, versionDate: v.versionDate, texts }
}

module.exports = { VERSIONS, findVersion, loadConfidentiality }
