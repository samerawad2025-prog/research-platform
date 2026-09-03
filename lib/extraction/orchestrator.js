// lib/extraction/orchestrator.js
//
// This is where the "extract first, cheaply; go back only if needed"
// policy actually lives. It knows nothing about Gemini or the mock
// provider specifically, only the extractMetadata(...) interface both
// implement. Hard ceiling: at most two calls to the provider, ever,
// per run. If something is still missing after that, it's reported
// honestly as not_found, not chased further.

const { extractDocxText } = require('./docx');
const { slicePages } = require('./pdf');
const { findCandidateSections } = require('./keywordScan');

const CRITICAL_FIELDS = ['title', 'researchers'];
const AT_LEAST_ONE_OF = ['abstract', 'methodology'];
const ALL_FIELDS = ['title', 'title_ar', 'abstract', 'abstract_ar', 'methodology', 'supervisor_name', 'year', 'keywords', 'researchers'];

function isMissing(field) {
  if (!field) return true;
  return field.status === 'not_found' || field.status === 'ambiguous';
  // Deliberately not 'conflicting': a conflict means we found something
  // concrete on both sides, that's a case for the human to resolve, not
  // a reason to spend a second AI call chasing a third answer.
}

// Decides WHETHER pass 2 runs at all: only these fields are worth a
// second paid call on their own.
function getMissingCriticalFields(result) {
  const missing = [];

  for (const field of CRITICAL_FIELDS) {
    if (isMissing(result[field])) missing.push(field);
  }

  const hasOneOf = AT_LEAST_ONE_OF.some((f) => result[f] && result[f].status === 'found');
  if (!hasOneOf) missing.push(...AT_LEAST_ONE_OF.filter((f) => isMissing(result[f])));

  return missing;
}

// Once pass 2 is happening anyway, it should opportunistically ask
// about every field still missing, not only the one that triggered it,
// since asking costs nothing extra in the same call.
function getAllMissingFields(result) {
  return ALL_FIELDS.filter((f) => isMissing(result[f]));
}

async function prepareDocument(fileBuffer, fileType, maxPages = 15) {
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
      // No text layer is extracted for PDFs at all now - Gemini reads
      // the document natively, which was always the actual reason
      // Gemini was chosen. fullText stays null so buildPass2Document
      // knows there's nothing for a keyword scan to search here.
      fullText: null,
      totalPages: sliced.totalPages,
    };
  }

  throw new Error(`Unsupported file type for extraction: ${fileType}`);
}

async function buildPass2Document(fileBuffer, fileType, fullText, missingFields) {
  if (fileType === 'pdf') {
    // No text layer to scan (pdf-parse is gone, deliberately - see
    // pdf.js for why). Gemini's own native document understanding
    // replaces that step: a broader slice, sent directly, asked
    // specifically about what's still missing. This is not a fallback
    // for a missing capability, it's the architecture Gemini was
    // chosen for in the first place.
    const broader = await slicePages(fileBuffer, 40, 0);
    return { type: 'pdf', base64: Buffer.from(broader.bytes).toString('base64') };
  }

  // DOCX: unchanged. Real extracted text, real keyword scan.
  const scan = findCandidateSections(fullText, missingFields);

  if (scan.found) {
    const excerptText = scan.excerpts.map((e) => `[possibly relevant to: ${e.field}]\n${e.excerpt}`).join('\n\n---\n\n');
    return { type: 'text', content: excerptText };
  }

  return { type: 'text', content: fullText.slice(0, 20000) };
}

// Rough ordering of how much real information a status represents.
// Merging must never let pass 2 downgrade a field pass 1 already had
// partial or full information for - "not_found" on a retry means "I
// couldn't confirm it this time," not "the earlier answer was wrong."
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
    // Otherwise pass 1's value survives untouched - pass 2 had less to
    // say about this field than pass 1 already did.
  }

  return merged;
}

// provider: the object returned by getProvider(), already selected.
async function runExtraction({ fileBuffer, fileType, provider }) {
  const { pass1Doc, fullText } = await prepareDocument(fileBuffer, fileType);

  const pass1 = await provider.extractMetadata({ pass: 1, document: pass1Doc });

  const triggerFields = getMissingCriticalFields(pass1.result);

  if (triggerFields.length === 0) {
    return {
      finalResult: pass1.result,
      passesRun: 1,
      provider: pass1.provider,
      model: pass1.model,
      generations: [{ pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result }],
    };
  }

  const missing = getAllMissingFields(pass1.result);
  const pass2Doc = await buildPass2Document(fileBuffer, fileType, fullText, missing);
  const pass2 = await provider.extractMetadata({ pass: 2, document: pass2Doc, missingFields: missing });

  const finalResult = mergeResults(pass1.result, pass2.result);

  return {
    finalResult,
    passesRun: 2,
    provider: pass1.provider,
    model: pass1.model,
    generations: [
      { pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result },
      { pass: 2, provider: pass2.provider, model: pass2.model, result: pass2.result, missingFieldsRequested: missing },
    ],
  };
}

module.exports = { runExtraction, getMissingCriticalFields, getAllMissingFields, mergeResults };
