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
const JSZip = require('jszip');
const { ExtractionError } = require('./errors');

const OLE_CFB_SIGNATURE = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);

// Word stores up to three header parts: header1 (default), header2
// (first page - the one that matters for a cover page), header3
// (even pages). Confirmed against a real thesis: header1.xml had no
// text runs, header2.xml held the university, faculty, and degree,
// header3.xml didn't exist. All three are checked since which one
// carries the cover-page content varies by document.
const HEADER_PARTS = ['word/header1.xml', 'word/header2.xml', 'word/header3.xml'];

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

// mammoth.extractRawText() never reads header or footer parts at all -
// confirmed directly against a real production thesis, where
// university, faculty, and degree existed ONLY inside word/header2.xml
// and were completely absent from mammoth's output. This reads those
// parts directly from the underlying zip and pulls their visible text
// with the same plain <w:t> run extraction used to establish that
// finding. Deliberately narrow: this is a text-run reader, not a
// general OOXML parser, and it only ever adds content, it never
// changes what mammoth itself returns.
function decodeXmlEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&'); // must run last, or a decoded "&lt;" would be re-mangled
}

async function extractHeaderText(buffer) {
  try {
    const zip = await JSZip.loadAsync(buffer);
    const sections = [];

    for (const part of HEADER_PARTS) {
      const file = zip.file(part);
      if (!file) continue;

      const xml = await file.async('string');
      const runs = [...xml.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) => decodeXmlEntities(m[1]));
      const text = runs.join('').trim();
      if (text) sections.push(text);
    }

    return sections.join('\n');
  } catch {
    // A header we can't read is not a reason to fail the whole
    // extraction - mammoth's own body text is unaffected either way.
    // This function only ever adds information; it never removes any.
    return '';
  }
}

async function extractDocxText(buffer) {
  assertNotEncrypted(buffer);

  const [bodyResult, headerText] = await Promise.all([
    mammoth.extractRawText({ buffer }),
    extractHeaderText(buffer),
  ]);

  // Labeled and kept separate from the body, not blended in - so the
  // model can tell a header's institution name apart from anything
  // that looks like a running title repeated on every page, rather
  // than treating it as more body content.
  const text = headerText
    ? `Document header: ${headerText}\n\n${bodyResult.value}`
    : bodyResult.value;

  return {
    text,
    warnings: bodyResult.messages.map((m) => m.message),
  };
}

module.exports = { extractDocxText, isOleCompoundFile, assertNotEncrypted, extractHeaderText };
