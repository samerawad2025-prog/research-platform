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
//
// externalAi: which external AI arrangement the version DESCRIBES to the
// researcher (migration 0018, agreement_versions.external_ai_processing).
// null = the version does not authorize sending the document to an
// external AI service; a submission accepted under it is never read
// automatically. Must equal the database row, or the version is not
// offered at all.

const AGREEMENTS = [
  {
    id: 'submission-terms-2026-09-25-en',
    key: 'submission-terms',
    language: 'en',
    versionLabel: 'Initial Version',
    versionDate: '2026-09-25',
    file: 'docs/legal/submission-terms.en.md',
    sha256: '77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da',
    externalAi: null,
  },
  {
    id: 'submission-terms-2026-09-25-ar',
    key: 'submission-terms',
    language: 'ar',
    versionLabel: 'Initial Version',
    versionDate: '2026-09-25',
    file: 'docs/legal/submission-terms.ar.md',
    sha256: '54a78f8441426b5c2dd190235fb57cfaa0ae9e1a956d6aefb64ff0a13208795b',
    externalAi: null,
  },
  // Version 2 (2026-10-04): Gemini reading by default, under Google's
  // paid-service terms, with manual entry as the researcher's alternative.
  {
    id: 'submission-terms-2026-10-04-en',
    key: 'submission-terms',
    language: 'en',
    versionLabel: 'Version 2',
    versionDate: '2026-10-04',
    file: 'docs/legal/submission-terms.v2.en.md',
    sha256: '468c51eb1e8edb493de94a969415c8fce28344523503bc43f409a2a45f459367',
    externalAi: 'gemini_api_paid',
  },
  {
    id: 'submission-terms-2026-10-04-ar',
    key: 'submission-terms',
    language: 'ar',
    versionLabel: 'Version 2',
    versionDate: '2026-10-04',
    file: 'docs/legal/submission-terms.v2.ar.md',
    sha256: '3bcfe8c27a1046835423b38dc59e7f17d5b4deae94a28cf8273208ea5a71faf0',
    externalAi: 'gemini_api_paid',
  },
  // Version 3 (2026-10-04): the Gemini API project is confirmed free tier.
  // Under Google's unpaid terms only a minimized excerpt is sent (names and
  // contact details removed, never the document), and nobody's name is
  // requested. Supersedes version 2 for launch; version 2 stays, inactive.
  {
    id: 'submission-terms-2026-10-04-v3-en',
    key: 'submission-terms',
    language: 'en',
    versionLabel: 'Version 3',
    versionDate: '2026-10-04',
    file: 'docs/legal/submission-terms.v3.en.md',
    sha256: '503bcdc52968ed8712fd29446bdfbbe2003365cb4449588296df772e983abb99',
    externalAi: 'gemini_api_unpaid',
  },
  {
    id: 'submission-terms-2026-10-04-v3-ar',
    key: 'submission-terms',
    language: 'ar',
    versionLabel: 'Version 3',
    versionDate: '2026-10-04',
    file: 'docs/legal/submission-terms.v3.ar.md',
    sha256: 'aef0ced4846f195615b8970d3537e7494045f467921d0950e9d3b9fa0069efdc',
    externalAi: 'gemini_api_unpaid',
  },
]

function findAgreement(id) {
  return AGREEMENTS.find((a) => a.id === id) || null
}

module.exports = { AGREEMENTS, findAgreement }
