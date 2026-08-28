// lib/extraction/docx.js
//
// Converts a DOCX file's raw content to plain text. This is the whole
// job: mammoth handles the OOXML parsing, we just want the text out.
// Not used for DOC (the legacy binary format) - see the note in the
// implementation report about why that's handled as a separate decision.

const mammoth = require('mammoth');

async function extractDocxText(buffer) {
  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value,
    warnings: result.messages.map((m) => m.message),
  };
}

module.exports = { extractDocxText };
