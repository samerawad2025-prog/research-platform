// lib/extraction/pdf.js
//
// PDF text extraction (pdf-parse) has been removed entirely. It's
// built on pdf.js, which references browser-only globals (DOMMatrix)
// at module-load time for its rendering path, a well-documented,
// structural incompatibility with Node/serverless runtimes, not
// something a bundler flag can fix. Marking it external got past
// Next.js's build step but not Vercel's actual runtime, which is
// exactly the failure this file now avoids by not needing it at all.
//
// The replacement isn't a workaround, it's the architecture we
// already chose Gemini for: it understands PDF layout natively, so
// PDFs no longer need a separate text-extraction step. Only page
// slicing remains, which is pure PDF structure manipulation (pdf-lib),
// not rendering, and has no such dependency.

const { PDFDocument } = require('pdf-lib');

async function getPageCount(buffer) {
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
}

// startPage is 0-indexed. Used for both the front-matter slice (pass 1)
// and, if needed, a broader slice (pass 2) starting from page 1 again
// with a larger page count, sent straight to Gemini either way.
async function slicePages(buffer, maxPages = 15, startPage = 0) {
  const source = await PDFDocument.load(buffer);
  const total = source.getPageCount();
  const end = Math.min(startPage + maxPages, total);
  const indices = Array.from({ length: Math.max(0, end - startPage) }, (_, i) => startPage + i);

  const sliced = await PDFDocument.create();
  const copiedPages = await sliced.copyPages(source, indices);
  copiedPages.forEach((p) => sliced.addPage(p));

  const bytes = await sliced.save();
  return { bytes, pagesIncluded: indices.length, totalPages: total };
}

module.exports = { getPageCount, slicePages };
