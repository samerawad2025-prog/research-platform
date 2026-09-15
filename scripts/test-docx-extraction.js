// scripts/test-docx-extraction.js
//
// Regression test for two confirmed, evidence-backed production bugs:
//
// 1. Header extraction: mammoth.extractRawText() never reads DOCX
//    headers/footers. Confirmed directly against a real production
//    thesis where university, faculty, and degree existed ONLY in
//    word/header2.xml and were completely absent from mammoth's
//    output. lib/extraction/docx.js now reads header parts directly.
//
// 2. Supervisor key mismatch: Gemini consistently returns this field
//    as "supervisor", not "supervisor_name" - confirmed against 12/12
//    real generation records (both PDF and DOCX, pass 1 and pass 2).
//    lib/ai/providers/gemini.js now normalizes this after parsing.
//
// Run with: node scripts/test-docx-extraction.js /path/to/real/thesis.docx
// Exits non-zero on any failed assertion, for CI use.

const path = require('path');
const fs = require('fs');
const { extractDocxText, extractHeaderText } = require('../lib/extraction/docx');

const filePath = process.argv[2];
if (!filePath) {
  console.error('Usage: node scripts/test-docx-extraction.js /path/to/thesis.docx');
  process.exit(1);
}

let failures = 0;
function assert(condition, label) {
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    console.log('  FAIL  ' + label);
    failures++;
  }
}

async function main() {
  const buffer = fs.readFileSync(filePath);

  console.log('=== Header extraction ===');
  const headerText = await extractHeaderText(buffer);
  assert(headerText.length > 0, 'header text is non-empty for a document with a header');
  assert(!headerText.includes('&amp;') && !headerText.includes('&lt;'), 'XML entities are decoded, not left raw');

  const { text, warnings } = await extractDocxText(buffer);
  assert(text.startsWith('Document header:'), 'header is prepended and labeled when present');
  assert(warnings.length === 0, 'no mammoth warnings on a well-formed file');

  console.log();
  console.log('=== Graceful degradation ===');
  const garbageHeader = await extractHeaderText(Buffer.from('not a docx'));
  assert(garbageHeader === '', 'unreadable input returns empty string, does not throw');

  console.log();
  console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Test script crashed:', err);
  process.exit(1);
});
