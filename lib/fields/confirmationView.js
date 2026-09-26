// lib/fields/confirmationView.js
//
// Which screen the confirmation page shows, decided in one pure function
// so the rules can be tested directly (scripts/test-confirmation-view.js)
// instead of only read inside a component.
//
// Inputs are what the page knows: the paper as get_paper_for_confirmation
// returns it, whether the server is in manual mode (EXTRACTION_MODE, passed
// down by the page as a plain boolean), and whether the researcher chose
// to enter the details themselves on this visit.
//
// Output:
//   view    'extracting' | 'form' | 'notResearch' | 'encrypted' | 'transient' | 'failed'
//   manual  the form is for entering details by hand, not reviewing a result
//   reason  why it is manual: 'mode' (nothing was ever going to be read, so
//           the page says nothing about automatic reading) or 'fallback'
//           (reading was tried and did not work, or the researcher opted out)

const WORKING = ['pending', 'processing']
const TRANSIENT_FAILURES = ['api_error', 'timeout', 'empty_response', 'malformed_json', 'internal']

function deriveView({ paper, manualMode = false, manualChoice = false }) {
  if (!paper) return { view: 'extracting', manual: false, reason: null }

  const status = paper.extraction_status
  const working = WORKING.includes(status)
  const failed = status === 'failed'
  const confirmed = Boolean(paper.metadata_confirmed_at)

  // A confirmed record is the researcher's own, and always opens as the
  // editable record they confirmed - never as a waiting screen or a
  // failure notice, whatever happened to extraction around it.
  if (confirmed) {
    const manual = status === 'manual' || working || failed
    return { view: 'form', manual, reason: manual ? (status === 'manual' || (manualMode && working) ? 'mode' : 'fallback') : null }
  }

  // paper.document_type, the top-level papers column, not the plain
  // string inside extraction_detail (see lib/ai/schema.js): the route
  // writes the column directly, whichever generation ends up applied.
  //
  // The model's classification of the document. Deliberately not turned
  // into a manual form: the file itself is the problem, and the notice
  // already says what to do.
  if (failed && paper.document_type === 'not_research') {
    return { view: 'notResearch', manual: false, reason: null }
  }

  if (status === 'manual' || (manualMode && working)) {
    return { view: 'form', manual: true, reason: 'mode' }
  }

  // In manual mode a retry would be refused, so offering one would be a
  // dead end; the details go straight to hand entry instead.
  if (manualChoice || (manualMode && failed)) {
    return { view: 'form', manual: true, reason: 'fallback' }
  }

  if (failed && paper.failure_code === 'encrypted_document') return { view: 'encrypted', manual: false, reason: null }
  if (failed && TRANSIENT_FAILURES.includes(paper.failure_code)) return { view: 'transient', manual: false, reason: null }
  if (failed) return { view: 'failed', manual: false, reason: null }
  if (working) return { view: 'extracting', manual: false, reason: null }

  return { view: 'form', manual: false, reason: null }
}

module.exports = { deriveView, TRANSIENT_FAILURES }
