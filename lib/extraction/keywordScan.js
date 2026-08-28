// lib/extraction/keywordScan.js
//
// Cheap, non-AI text search used only when pass 1 is missing something.
// This never calls a model; it just narrows down where a second pass
// should look, so pass 2 can be small and targeted instead of "send
// everything and hope."

const MARKERS = {
  abstract: ['abstract', 'ملخص', 'الملخص'],
  abstract_ar: ['ملخص', 'الملخص'],
  supervisor_name: ['supervisor', 'advisor', 'المشرف', 'الأستاذ المشرف'],
  methodology: ['methodology', 'method', 'منهجية', 'المنهجية'],
  keywords: ['keywords', 'key words', 'الكلمات المفتاحية'],
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
        const start = Math.max(0, idx - 100);
        const end = Math.min(text.length, idx + 400);
        excerpts.push({ field, marker, offset: idx, excerpt: text.slice(start, end) });
        break; // one hit per field is enough to know roughly where to look
      }
    }
  }

  return { found: excerpts.length > 0, excerpts };
}

module.exports = { findCandidateSections, MARKERS };
