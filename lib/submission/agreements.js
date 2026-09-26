// lib/submission/agreements.js
//
// The agreement versions the server is willing to accept, and their exact
// content hashes. A browser never supplies legal text or a hash: it names
// one of these ids, and the server checks that id against this list AND
// against the agreement_versions table (which also carries the active
// flag). scripts/test-submission-acceptance.js checks that each hash here
// is the SHA-256 of the file in docs/legal/, and that migration 0012 seeds
// the same values.
//
// A new wording is a new entry (and a new row), never an edit.

const AGREEMENTS = [
  {
    id: 'submission-terms-2026-09-25-en',
    key: 'submission-terms',
    language: 'en',
    versionLabel: 'Initial Version',
    versionDate: '2026-09-25',
    file: 'docs/legal/submission-terms.en.md',
    sha256: '77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da',
  },
  {
    id: 'submission-terms-2026-09-25-ar',
    key: 'submission-terms',
    language: 'ar',
    versionLabel: 'Initial Version',
    versionDate: '2026-09-25',
    file: 'docs/legal/submission-terms.ar.md',
    sha256: '54a78f8441426b5c2dd190235fb57cfaa0ae9e1a956d6aefb64ff0a13208795b',
  },
]

function findAgreement(id) {
  return AGREEMENTS.find((a) => a.id === id) || null
}

module.exports = { AGREEMENTS, findAgreement }
