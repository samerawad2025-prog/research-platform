// lib/extraction/orchestrator.js
//
// Where the "extract cheaply first, go back only if needed" policy
// lives. Knows nothing about Gemini or the mock provider specifically,
// only the extractMetadata(...) interface both implement. Hard ceiling:
// at most two provider calls, ever, per run.

const { extractDocxText } = require('./docx');
const { slicePages } = require('./pdf');
const { findCandidateSections } = require('./keywordScan');
const { THESIS_LIKE_TYPES } = require('../ai/schema');

// Always worth a second call if missing: for a real research document,
// not_found on any of these is almost certainly an extraction gap.
const BASE_CRITICAL_FIELDS = ['title', 'researchers', 'year'];

const ALL_FIELDS = ['title', 'title_ar', 'abstract', 'abstract_ar', 'supervisor_name', 'year', 'researchers'];

function isMissing(field) {
  if (!field) return true;
  return field.status === 'not_found' || field.status === 'ambiguous';
  // Deliberately not 'conflicting': a conflict means we found something
  // concrete on both sides, that's a case for the human to resolve, not
  // a reason to spend a second AI call chasing a third answer.
}

function getDocumentType(result) {
  const entry = result?.document_type;
  if (!entry) return null;
  if (entry.status === 'found') return entry.value;
  return null;
}

function isNotResearch(result) {
  return getDocumentType(result) === 'not_research';
}

// Supervisor is conditionally critical: a thesis that names no
// supervisor is almost always a miss worth one more look, while a
// journal article with no supervisor is simply correct. This is the
// specific gap that caused a plainly-labelled supervisor on page 1 to
// be reported as not_found with no second chance.
function getCriticalFields(result) {
  const docType = getDocumentType(result);
  if (docType && THESIS_LIKE_TYPES.includes(docType)) {
    return [...BASE_CRITICAL_FIELDS, 'supervisor_name'];
  }
  return BASE_CRITICAL_FIELDS;
}

// Decides WHETHER pass 2 runs at all.
function getMissingCriticalFields(result) {
  return getCriticalFields(result).filter((field) => isMissing(result[field]));
}

// Once pass 2 is happening anyway, ask about every field still missing,
// not only the one that triggered it, since asking costs nothing extra
// in the same call.
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
      // No text layer is extracted for PDFs - Gemini reads the document
      // natively, which was always the reason Gemini was chosen.
      fullText: null,
      totalPages: sliced.totalPages,
    };
  }

  throw new Error(`Unsupported file type for extraction: ${fileType}`);
}

async function buildPass2Document(fileBuffer, fileType, fullText, missingFields) {
  if (fileType === 'pdf') {
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

// Rough ordering of how much real information a status represents.
// Merging must never let pass 2 downgrade a field pass 1 already had
// information for - "not_found" on a retry means "I couldn't confirm it
// this time," not "the earlier answer was wrong."
const INFO_RANK = { not_found: 0, ambiguous: 1, conflicting: 1, found: 2 };

function mergeResults(pass1Result, pass2Result) {
  const merged = { ...pass1Result };

  for (const [field, pass2Value] of Object.entries(pass2Result || {})) {
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

  const pass1 = await provider.extractMetadata({ pass: 1, document: pass1Doc });

  const baseReturn = {
    provider: pass1.provider,
    model: pass1.model,
  };

  // A CV or an invoice has no research metadata to find. Stop here
  // rather than spending a second call trying to extract fields that
  // cannot exist, and let the caller show a specific message.
  if (isNotResearch(pass1.result)) {
    return {
      ...baseReturn,
      finalResult: pass1.result,
      passesRun: 1,
      documentType: 'not_research',
      generations: [{ pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result }],
    };
  }

  const triggerFields = getMissingCriticalFields(pass1.result);

  if (triggerFields.length === 0) {
    return {
      ...baseReturn,
      finalResult: pass1.result,
      passesRun: 1,
      documentType: getDocumentType(pass1.result),
      generations: [{ pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result }],
    };
  }

  const missing = getAllMissingFields(pass1.result);
  const pass2Doc = await buildPass2Document(fileBuffer, fileType, fullText, missing);
  const pass2 = await provider.extractMetadata({ pass: 2, document: pass2Doc, missingFields: missing });

  const finalResult = mergeResults(pass1.result, pass2.result);

  return {
    ...baseReturn,
    finalResult,
    passesRun: 2,
    documentType: getDocumentType(finalResult),
    generations: [
      { pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result },
      { pass: 2, provider: pass2.provider, model: pass2.model, result: pass2.result, missingFieldsRequested: missing },
    ],
  };
}

module.exports = {
  runExtraction,
  getMissingCriticalFields,
  getAllMissingFields,
  getCriticalFields,
  getDocumentType,
  isNotResearch,
  mergeResults,
};
