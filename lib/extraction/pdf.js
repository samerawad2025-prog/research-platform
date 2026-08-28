// lib/extraction/pdf.js
//
// Two separate, focused jobs, deliberately not combined into one:
//
// sliceFrontMatter: builds a smaller PDF containing only the first N
// pages, so pass 1 sends a fraction of a long thesis to the model
// instead of the whole document. This is what pdf-lib is for here,
// it manipulates PDF structure, it doesn't read text.
//
// extractTextLayer: pulls whatever text layer the PDF has (empty
// string for a pure scan with no text layer), used only by the
// non-AI keyword scan before a second pass. This is what pdf-parse
// is for, it's a text reader, not a structure editor.

const { PDFDocument } = require('pdf-lib');
const { PDFParse } = require('pdf-parse');

async function getPageCount(buffer) {
  const doc = await PDFDocument.load(buffer);
  return doc.getPageCount();
}

async function sliceFrontMatter(buffer, maxPages = 15) {
  const source = await PDFDocument.load(buffer);
  const total = source.getPageCount();
  const count = Math.min(maxPages, total);

  const sliced = await PDFDocument.create();
  const indices = Array.from({ length: count }, (_, i) => i);
  const copiedPages = await sliced.copyPages(source, indices);
  copiedPages.forEach((p) => sliced.addPage(p));

  const bytes = await sliced.save();
  return { bytes, pagesIncluded: count, totalPages: total };
}

async function extractTextLayer(buffer) {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return { text: result.text, hasTextLayer: result.text.trim().length > 0 };
  } catch (err) {
    // A malformed or unusual PDF shouldn't crash the pipeline, just
    // mean the keyword scan has nothing to work with, which is a
    // known, handled case (falls through to the bounded broader pass).
    return { text: '', hasTextLayer: false, error: String(err.message) };
  } finally {
    await parser.destroy();
  }
}

module.exports = { getPageCount, sliceFrontMatter, extractTextLayer };
