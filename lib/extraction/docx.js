// lib/extraction/docx.js
//
// Converts a DOCX file's raw content to plain text via mammoth.
//
// RESILIENCE PHASE: detects password-protected/encrypted DOCX files
// BEFORE mammoth is ever invoked, so the specific reason is known
// immediately rather than surfacing as mammoth's generic "is this a
// zip file?" error, which is also what a genuinely corrupted or
// mislabeled file produces.
//
// How this works: an unencrypted .docx is a plain ZIP archive and
// starts with the ZIP signature (0x50 0x4B, "PK"). A password-
// protected Office document is NOT a ZIP at the container level at
// all - Word wraps the encrypted payload in the legacy OLE Compound
// File Binary format instead, which has its own distinct, universally
// documented signature. Checking for that signature is a specific,
// evidence-based test, not a guess from a generic parse failure.
//
// Honest limit: this signature also matches a genuine legacy .doc
// file saved with a .docx extension, since .doc uses the same OLE
// container. Both cases are equally unprocessable by this pipeline
// today, so treating them the same is reasonable, but "encrypted" is
// a slightly confident label for what is really "this is an OLE
// Compound File, not a ZIP" - worth knowing if false positives on
// mislabeled legacy files ever show up in practice.

const mammoth = require('mammoth');
const { ExtractionError } = require('./errors');

const OLE_CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

function isOleCompoundFile(buffer) {
  if (!buffer || buffer.length < 8) return false;
  return buffer.subarray(0, 8).equals(OLE_CFB_SIGNATURE);
}

function assertNotEncrypted(buffer) {
  if (isOleCompoundFile(buffer)) {
    throw new ExtractionError(
      'encrypted_document',
      'This document is password-protected and cannot be processed automatically.',
      { detectedContainer: 'ole_compound_file' }
    );
  }
}

async function extractDocxText(buffer) {
  assertNotEncrypted(buffer);

  const result = await mammoth.extractRawText({ buffer });
  return {
    text: result.value,
    warnings: result.messages.map((m) => m.message),
  };
}

module.exports = { extractDocxText, isOleCompoundFile, assertNotEncrypted };
