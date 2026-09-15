// lib/extraction/orchestrator.js
//
// Where the "extract cheaply first, go back only if needed" policy
// lives. Knows nothing about Gemini or the mock provider specifically,
// only the extractMetadata(...) interface both implement. Hard ceiling:
// at most two provider calls per run, ever.

const { extractDocxText } = require('./docx');
const { slicePages } = require('./pdf');
const { findCandidateSections } = require('./keywordScan');

// Always worth a second call when missing: for a real research
// document, not_found on any of these is almost always a genuine
// extraction gap rather than a true absence.
const ALWAYS_CRITICAL = ['title', 'researchers', 'year'];

// Document types where a missing supervisor IS a genuine gap worth a
// second call. A thesis essentially always names one; a journal
// article usually doesn't, so chasing it there would burn a call to
// confirm an absence we already expect.
const SUPERVISED_DOC_TYPES = ['thesis'];

const ALL_FIELDS = [
  'title', 'title_ar', 'abstract', 'abstract_ar',
  'supervisor_name', 'year', 'university', 'faculty', 'degree_type', 'researchers',
];

function isMissing(field) {
  if (!field) return true;
  return field.status === 'not_found' || field.status === 'ambiguous';
  // Deliberately not 'conflicting': a conflict means we found something
  // concrete on both sides. That's for the human to resolve, not a
  // reason to spend a call chasing a third answer.
}

function getDocumentType(result) {
  const raw = result?.document_type;
  return typeof raw === 'string' ? raw : (raw?.value || null);
}

// Decides WHETHER pass 2 runs at all.
function getMissingCriticalFields(result) {
  const docType = getDocumentType(result);

  // Nothing to chase in a document that isn't research at all.
  if (docType === 'not_research') return [];

  const critical = [...ALWAYS_CRITICAL];
  if (SUPERVISED_DOC_TYPES.includes(docType)) {
    critical.push('supervisor_name');
  }

  return critical.filter((field) => isMissing(result[field]));
}

// Once pass 2 is happening anyway, ask about everything still missing,
// not only what triggered it. Costs nothing extra in the same call.
function getAllMissingFields(result) {
  return ALL_FIELDS.filter((f) => isMissing(result[f]));
}

async function prepareDocument(fileBuffer, fileType, maxPages = 10) {
  if (fileType === 'docx') {
    const { text } = await extractDocxText(fileBuffer);
    return {
      pass1Doc: { type: 'text', content: text.slice(0, 6000) },
      fullText: text,
    };
  }

  if (fileType === 'pdf') {
    const sliced = await slicePages(fileBuffer, maxPages, 0);
    return {
      pass1Doc: { type: 'pdf', base64: Buffer.from(sliced.bytes).toString('base64') },
      // Gemini reads PDFs natively, which is why it was chosen. No text
      // layer is extracted here at all; fullText stays null so
      // buildPass2Document knows there's nothing to keyword-scan.
      fullText: null,
      totalPages: sliced.totalPages,
    };
  }

  throw new Error(`Unsupported file type for extraction: ${fileType}`);
}

async function buildPass2Document(fileBuffer, fileType, fullText, missingFields) {
  if (fileType === 'pdf') {
    // A broader slice sent straight to Gemini. Everything we ask about
    // lives at the front of a document, never buried mid-chapter, so a
    // wider window than this buys nothing.
    const broader = await slicePages(fileBuffer, 25, 0);
    return { type: 'pdf', base64: Buffer.from(broader.bytes).toString('base64') };
  }

  const scan = findCandidateSections(fullText, missingFields);

  if (scan.found) {
    const excerptText = scan.excerpts.map((e) => `[possibly relevant to: ${e.field}]\n${e.excerpt}`).join('\n\n---\n\n');
    return { type: 'text', content: excerptText };
  }

  return { type: 'text', content: fullText.slice(0, 12000) };
}

// Merging must never let pass 2 downgrade a field pass 1 already had
// information for. "not_found" on a retry means "I couldn't confirm it
// this time", not "the earlier answer was wrong."
const INFO_RANK = { not_found: 0, ambiguous: 1, conflicting: 1, found: 2 };

function mergeResults(pass1Result, pass2Result, requestedFields) {
  const merged = { ...pass1Result };

  // Confirmed root cause (real production data, paper
  // d69a5786-db0e-4b31-ba38-d7a264e27537): pass 2 was targeted at
  // title_ar, abstract_ar, supervisor_name, university, faculty,
  // degree_type - researchers was never in that list. Pass 2's
  // excerpt window still happened to include the tail of the
  // researcher list, Gemini answered anyway with 3 of 6 names, and
  // because the merge accepted ANY key pass 2 returned, that
  // truncated answer overwrote pass 1's complete, correct list of 6.
  // requestedFields is the same missingFields list actually sent to
  // the model; anything outside it is discarded here, regardless of
  // what pass 2 volunteered.
  const allowed = requestedFields ? new Set(requestedFields) : null;

  for (const [field, pass2Value] of Object.entries(pass2Result || {})) {
    if (field === 'document_type') continue; // classification is pass 1's job
    if (allowed && !allowed.has(field)) continue; // not asked about - ignore whatever pass 2 volunteered

    const pass1Value = pass1Result[field];
    const pass1Rank = pass1Value ? INFO_RANK[pass1Value.status] ?? 0 : -1;
    const pass2Rank = INFO_RANK[pass2Value.status] ?? 0;

    if (pass2Rank >= pass1Rank) {
      merged[field] = pass2Value;
    }
  }

  return merged;
}

async function runExtraction({ fileBuffer, fileType, provider }) {
  const { pass1Doc, fullText } = await prepareDocument(fileBuffer, fileType);

  // Pass 1 is NOT wrapped in try/catch: if it fails, there is nothing
  // yet to preserve, so this propagates as a normal hard failure,
  // unchanged from before.
  const pass1 = await provider.extractMetadata({ pass: 1, document: pass1Doc });
  const docType = getDocumentType(pass1.result);

  const triggerFields = getMissingCriticalFields(pass1.result);

  if (triggerFields.length === 0) {
    return {
      finalResult: pass1.result,
      documentType: docType,
      passesRun: 1,
      extractionStatus: 'completed',
      provider: pass1.provider,
      model: pass1.model,
      generations: [{ pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result, diagnostics: pass1.diagnostics || null }],
    };
  }

  const missing = getAllMissingFields(pass1.result);
  const pass2Doc = await buildPass2Document(fileBuffer, fileType, fullText, missing);

  // Pass 1 succeeded and its result is already sitting in memory. From
  // here on, nothing is allowed to lose it - a pass 2 failure (a 503
  // that survives its own internal retry, a timeout, malformed JSON)
  // degrades the outcome to 'partial', it does not discard pass 1.
  let pass2;
  let pass2Failure = null;
  try {
    pass2 = await provider.extractMetadata({ pass: 2, document: pass2Doc, missingFields: missing });
  } catch (err) {
    pass2Failure = {
      code: err.code || 'unknown',
      message: String(err.message),
      diagnostics: err.diagnostics || null,
    };
  }

  if (pass2Failure) {
    return {
      finalResult: pass1.result, // unchanged, unmerged, fully intact
      documentType: docType,
      passesRun: 2, // two calls were attempted, for cost accounting
      extractionStatus: 'partial',
      provider: pass1.provider,
      model: pass1.model,
      generations: [{ pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result, diagnostics: pass1.diagnostics || null }],
      pass2Failure,
    };
  }

  const finalResult = mergeResults(pass1.result, pass2.result, missing);

  return {
    finalResult,
    documentType: docType,
    passesRun: 2,
    extractionStatus: 'completed',
    provider: pass1.provider,
    model: pass1.model,
    generations: [
      { pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result, diagnostics: pass1.diagnostics || null },
      { pass: 2, provider: pass2.provider, model: pass2.model, result: pass2.result, missingFieldsRequested: missing, diagnostics: pass2.diagnostics || null },
    ],
  };
}

module.exports = {
  runExtraction, getMissingCriticalFields, getAllMissingFields,
  mergeResults, getDocumentType,
};
