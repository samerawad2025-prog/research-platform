// lib/extraction/keywordScan.js
//
// Cheap, non-AI text search used only when pass 1 is missing something.
// This never calls a model; it just narrows down where a second pass
// should look, so pass 2 can be small and targeted instead of "send
// everything and hope."

const MARKERS = {
  abstract: ['abstract', 'ملخص', 'الملخص'],
  abstract_ar: ['ملخص', 'الملخص'],
  supervisor_name: [
    'supervised by', 'supervisor', 'under the supervision', 'supervising professor',
    'academic supervisor', 'thesis supervisor', 'advisor',
    'إشراف', 'المشرف', 'الأستاذ المشرف', 'بإشراف',
  ],
  university: ['university', 'جامعة'],
  faculty: ['faculty', 'school of', 'college of', 'department of', 'كلية', 'قسم'],
  degree_type: ['degree of', 'bachelor', 'master', 'doctor of', 'in partial fulfilment', 'in partial fulfillment'],
  researchers: ['author', 'authors', 'researcher', 'researchers', 'الباحث', 'الباحثون'],
  title_ar: ['العنوان'],
  year: [],
};

// text: the full text layer of the document (empty string if none, e.g.
// a pure scan with no extractable text).
// missingFields: which fields pass 1 didn't confidently find.
// Returns an array of short surrounding excerpts, each with the
// approximate character offset it was found at, for the caller to turn
// into a page reference or a small window of surrounding text.
function findCandidateSections(text, missingFields) {
  if (!text || text.trim().length === 0) {
    return { found: false, excerpts: [] };
  }

  const lowerText = text.toLowerCase();
  const excerpts = [];

  for (const field of missingFields) {
    const markers = MARKERS[field] || [];
    for (const marker of markers) {
      const idx = lowerText.indexOf(marker.toLowerCase());
      if (idx !== -1) {
        // Widened from (-100, +400). Confirmed by real production data
        // (paper d69a5786...): the old window, anchored on "Supervised
        // by" at offset 325, produced [225, 725] - starting AFTER the
        // researcher list (offsets 140-320) begins, so only its tail
        // was ever visible to pass 2. This is independent of the
        // merge-filtering fix above: even for fields pass 2 IS
        // correctly asked about, a marker sitting just past a block of
        // relevant content (a cover page's researcher list, in this
        // case) would still get an incomplete excerpt.
        const start = Math.max(0, idx - 300);
        const end = Math.min(text.length, idx + 500);
        excerpts.push({ field, marker, offset: idx, excerpt: text.slice(start, end) });
        break; // one hit per field is enough to know roughly where to look
      }
    }
  }

  return { found: excerpts.length > 0, excerpts };
}

module.exports = { findCandidateSections, MARKERS };
