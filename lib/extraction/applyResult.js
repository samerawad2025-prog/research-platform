// lib/extraction/applyResult.js
//
// Decides what an extraction result should write to the papers table,
// deliberately separated from the code that actually talks to Supabase
// so this rule can be tested directly, not just trusted by reading it.
//
// The one rule that matters most: if a human has already confirmed
// this paper's metadata, a new extraction is still recorded in full,
// but it must never touch papers or paper_researchers automatically.

const APPLIABLE_FIELDS = ['title', 'title_ar', 'abstract', 'abstract_ar', 'methodology', 'supervisor_name', 'year', 'keywords'];

function buildPapersUpdate(extractionResult) {
  const update = {};
  for (const field of APPLIABLE_FIELDS) {
    const entry = extractionResult[field];
    // Only ever apply a field we're actually confident about. Ambiguous
    // and conflicting fields are real, useful information, but they
    // belong on the confirmation screen (read from ai_generations),
    // not silently written into a column that has no way to express
    // "found, but with two candidates."
    if (entry && entry.status === 'found') {
      update[field] = entry.value;
    }
  }
  return update;
}

function decideApplication({ alreadyConfirmed, extractionResult }) {
  if (alreadyConfirmed) {
    return { shouldApplyToPapers: false, papersUpdate: null };
  }
  return { shouldApplyToPapers: true, papersUpdate: buildPapersUpdate(extractionResult) };
}

module.exports = { decideApplication, buildPapersUpdate, APPLIABLE_FIELDS };
