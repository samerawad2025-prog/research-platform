// lib/extraction/applyResult.js
//
// Decides what an extraction result should write to the papers table,
// deliberately separated from the code that actually talks to Supabase
// so this rule can be tested directly, not just trusted by reading it.
//
// The one rule that matters most: if a human has already confirmed
// this paper's metadata, a new extraction is still recorded in full,
// but it must never touch papers or paper_researchers automatically.

const APPLIABLE_FIELDS = ['title', 'title_ar', 'abstract', 'abstract_ar', 'supervisor_name', 'year', 'university', 'faculty', 'degree_type'];

// `year` is the only non-text column in APPLIABLE_FIELDS (papers.year is
// integer); every other field is text and takes whatever the model
// reports verbatim. That makes it the one field where an extracted
// value can be *syntactically* rejected by Postgres, taking the whole
// UPDATE down with it - which is exactly what stranded a real Arabic
// thesis reporting "٢٠١٩م" (BUG_HISTORY.md #18).
const YEAR_MIN = 1900;
const YEAR_MAX = 2100;

// Arabic-Indic (٠-٩) and Eastern Arabic-Indic / Persian (۰-۹) digits.
// Both appear in Sudanese theses; mapping them to ASCII is lossless.
const ARABIC_INDIC_DIGITS = /[٠-٩۰-۹]/g;

function toAsciiDigits(text) {
  return text.replace(ARABIC_INDIC_DIGITS, (d) => {
    const code = d.charCodeAt(0);
    const base = code >= 0x06f0 ? 0x06f0 : 0x0660;
    return String(code - base);
  });
}

// Returns an integer year, or null when no confident one can be read.
//
// Deliberately conservative: it would be worse to store a plausible but
// wrong year than to store nothing. A Hijri year ("١٤٤٥") converts to a
// perfectly valid integer 1445, which is why the range check is not
// optional - without it we would silently record a Gregorian 1445.
// When this returns null the field is simply omitted, so extraction
// still shows the raw value on the confirmation screen for the
// submitter to correct by hand.
function normalizeYear(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= YEAR_MIN && value <= YEAR_MAX ? value : null;
  }
  if (typeof value !== 'string') return null;

  const ascii = toAsciiDigits(value);
  const matches = ascii.match(/\d{4}/g);
  if (!matches) return null;

  // A range like "1995 - 2017" is a span the document covers, not its
  // own year, so there is no single correct answer - omit rather than
  // guess which end was meant.
  const inRange = [...new Set(matches.map(Number))].filter((n) => n >= YEAR_MIN && n <= YEAR_MAX);
  return inRange.length === 1 ? inRange[0] : null;
}

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
      if (field === 'year') {
        const year = normalizeYear(entry.value)
        if (year !== null) update.year = year
        continue
      }
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

module.exports = { decideApplication, buildPapersUpdate, normalizeYear, APPLIABLE_FIELDS };
