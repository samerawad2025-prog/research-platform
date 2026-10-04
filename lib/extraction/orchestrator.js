// lib/extraction/orchestrator.js
//
// Where the "extract cheaply first, go back only if needed" policy
// lives. Knows nothing about Gemini or the mock provider specifically,
// only the extractMetadata(...) interface both implement. Hard ceiling:
// at most two provider calls per run, ever.

const crypto = require('crypto');
const { extractDocxText, extractDocxParts } = require('./docx');
const { slicePages } = require('./pdf');
const { findCandidateSections } = require('./keywordScan');
const { extractPdfLines, normalizeLine } = require('./pdfText');
const { buildExcerpt } = require('./excerpt');
const { ExtractionError } = require('./errors');

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

// Fields that exist once per language. A paper written only in Arabic
// genuinely has no English title, so chasing `title` on it spends a
// second provider call to re-confirm an absence pass 1 already
// established correctly - which is exactly what happened on a real
// Arabic thesis (notes: "Pass 2, targeted at: title", returning
// not_found again). Both passes cost money on a near-zero budget, so
// a field is only "missing" when NEITHER language has it.
const LANGUAGE_PAIRS = { title: 'title_ar', title_ar: 'title', abstract: 'abstract_ar', abstract_ar: 'abstract' };

function isMissingConsideringLanguage(result, field) {
  if (!isMissing(result[field])) return false;
  const partner = LANGUAGE_PAIRS[field];
  if (!partner) return true;
  return isMissing(result[partner]);
}

// How much a run actually got. Production evidence made this worth
// recording: paper bdc6d112 was classified 'research_report' and then
// returned not_found for EVERY field, across two passes, and was
// stored as extraction_status 'completed' - indistinguishable in the
// status column from a run that found everything. Paper 6e0d9728's
// pass 1 returned parseable JSON containing none of the expected keys
// at all, and the pipeline carried on silently.
//
// This does not change any outcome. It makes a zero-yield run
// countable, so "how often does extraction return nothing useful" stops
// being unanswerable.
function extractionYield(result) {
  const found = ALL_FIELDS.filter((f) => result?.[f]?.status === 'found');
  return {
    foundCount: found.length,
    totalFields: ALL_FIELDS.length,
    foundFields: found,
    // A research document that yielded nothing is the case worth
    // noticing; a not_research classification yielding nothing is
    // correct and expected.
    zeroYield: found.length === 0,
  };
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

  return critical.filter((field) => isMissingConsideringLanguage(result, field));
}

// Once pass 2 is happening anyway, ask about everything still missing,
// not only what triggered it. Costs nothing extra in the same call.
function getAllMissingFields(result) {
  return ALL_FIELDS.filter((f) => isMissingConsideringLanguage(result, f));
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

// ---------------------------------------------------------------------
// The excerpt path: Google's UNPAID (free-tier) Gemini terms
// (agreement version 3, lib/extraction/excerpt.js).
//
// The document never leaves this server. It is read here, reduced to a
// short excerpt with people and contact details removed, and only that
// text is sent - once. The model is asked only about the document itself
// (title, abstract, year, institution, degree, type), never about people:
// authors and the supervisor are always entered by the researcher.
//
// One call, not two: a second pass exists to look further into the
// document, and here the looking is done locally before anything is
// sent, so a second call would carry the same excerpt again.
// ---------------------------------------------------------------------

const EXCERPT_FIELDS = ['title', 'title_ar', 'abstract', 'abstract_ar', 'year', 'university', 'faculty', 'degree_type'];
// Never requested on this path, and never taken from an answer.
const PEOPLE_FIELDS = ['researchers', 'supervisor_name'];

const EXCERPT_REFUSALS = {
  no_text_layer: 'This file has no readable text (it may be a scan), so a safe excerpt could not be prepared. Nothing was sent.',
  text_unreadable: 'The text in this file could not be read reliably, so a safe excerpt could not be prepared. Nothing was sent.',
  no_safe_excerpt: 'Too little of this document could be kept once names and contact details were removed. Nothing was sent.',
  personal_data_remaining: 'Personal details could not be removed reliably from this document. Nothing was sent.',
  names_unavailable: 'The names held for this submission could not be read, so the excerpt could not be checked. Nothing was sent.',
  unreadable_file: 'This file could not be opened to prepare an excerpt. Nothing was sent.',
};

function splitLines(text) {
  return String(text || '').split(/\n+/).map(normalizeLine).filter(Boolean);
}

async function prepareExcerpt(fileBuffer, fileType, knownNames) {
  let source;
  try {
    if (fileType === 'pdf') {
      const { pages } = await extractPdfLines(fileBuffer);
      source = { pages };
    } else if (fileType === 'docx') {
      const { headerText, bodyText } = await extractDocxParts(fileBuffer);
      // A Word file has no pages to read; its cover page is its first lines.
      source = { pages: [splitLines(bodyText)], headerLines: splitLines(headerText), maxCoverLines: 30 };
    } else {
      throw new Error(`Unsupported file type for extraction: ${fileType}`);
    }
  } catch (err) {
    // An encrypted Word file keeps its own, specific outcome.
    if (err instanceof ExtractionError) throw err;
    throw new ExtractionError('excerpt_unavailable', EXCERPT_REFUSALS.unreadable_file, { stage: 'excerpt', reason: 'unreadable_file', detail: String(err.message).slice(0, 200) });
  }

  const excerpt = buildExcerpt({ ...source, knownNames });
  if (!excerpt.eligible) {
    throw new ExtractionError('excerpt_unavailable', EXCERPT_REFUSALS[excerpt.reason] || EXCERPT_REFUSALS.no_safe_excerpt, {
      stage: 'excerpt', reason: excerpt.reason, stats: excerpt.stats,
    });
  }
  return excerpt;
}

// Only the fields this path asks about survive; people are recorded as not
// looked for, whatever the answer volunteered.
function restrictToExcerptFields(result) {
  const out = { document_type: result?.document_type ?? null };
  for (const field of EXCERPT_FIELDS) out[field] = result?.[field] || { status: 'not_found' };
  for (const field of PEOPLE_FIELDS) out[field] = { status: 'not_found' };
  out._scope = 'excerpt';
  return out;
}

async function runExcerptExtraction({ fileBuffer, fileType, provider, beforeDispatch, knownNames }) {
  const excerpt = await prepareExcerpt(fileBuffer, fileType, knownNames);
  const sent = {
    sha256: crypto.createHash('sha256').update(excerpt.text).digest('hex'),
    chars: excerpt.text.length,
    stats: excerpt.stats,
    // Kept with the generation record (never shown in the browser) so an
    // operator can see exactly what left the server.
    text: excerpt.text,
  };

  if (beforeDispatch) await beforeDispatch({ pass: 1, attempt: 1 });
  const pass1 = await provider.extractMetadata({
    pass: 1,
    document: { type: 'text', scope: 'excerpt', content: excerpt.text },
    beforeDispatch,
  });
  const result = restrictToExcerptFields(pass1.result);
  const docType = getDocumentType(result);

  return {
    finalResult: result,
    extractionYield: extractionYield(result),
    documentType: docType,
    passesRun: 1,
    extractionStatus: 'completed',
    provider: pass1.provider,
    model: pass1.model,
    scope: 'excerpt',
    excerpt: { sha256: sent.sha256, chars: sent.chars },
    generations: [{ pass: 1, provider: pass1.provider, model: pass1.model, result: pass1.result, diagnostics: { ...(pass1.diagnostics || {}), excerpt: sent } }],
  };
}

// beforeDispatch (optional): awaited immediately before each provider
// pass is sent. It throws to stop the run before that pass leaves the
// server - the extraction route uses it to honour a manual-entry choice
// or a confirmation recorded while this run was already under way. It
// cannot recall a pass that was already sent; it only prevents the next.
//
// scope: 'document' (Google's paid terms: the front pages themselves, as
// before) or 'excerpt' (unpaid terms: the minimized excerpt only). The
// extraction route decides it from the paper's accepted agreement; there
// is no default that sends more than the agreement allows.
async function runExtraction({ fileBuffer, fileType, provider, beforeDispatch, scope, knownNames = [] }) {
  if (scope === 'excerpt') return runExcerptExtraction({ fileBuffer, fileType, provider, beforeDispatch, knownNames });
  if (scope !== 'document') throw new ExtractionError('config', `No processing scope for this paper (got ${scope}).`, { stage: 'scope' });
  const { pass1Doc, fullText } = await prepareDocument(fileBuffer, fileType);

  // Pass 1 is NOT wrapped in try/catch: if it fails, there is nothing
  // yet to preserve, so this propagates as a normal hard failure,
  // unchanged from before.
  if (beforeDispatch) await beforeDispatch({ pass: 1, attempt: 1 });
  const pass1 = await provider.extractMetadata({ pass: 1, document: pass1Doc, beforeDispatch });
  const docType = getDocumentType(pass1.result);

  const triggerFields = getMissingCriticalFields(pass1.result);

  if (triggerFields.length === 0) {
    return {
      finalResult: pass1.result,
      extractionYield: extractionYield(pass1.result),
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
    // Inside the try on purpose: a stop here keeps pass 1's result, like
    // any other pass 2 failure, and is recorded as the reason for 'partial'.
    if (beforeDispatch) await beforeDispatch({ pass: 2, attempt: 1 });
    pass2 = await provider.extractMetadata({ pass: 2, document: pass2Doc, missingFields: missing, beforeDispatch });
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
      extractionYield: extractionYield(pass1.result),
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
    extractionYield: extractionYield(finalResult),
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
  mergeResults, getDocumentType, isMissingConsideringLanguage, extractionYield,
  prepareExcerpt, restrictToExcerptFields, EXCERPT_FIELDS, EXCERPT_REFUSALS,
};
