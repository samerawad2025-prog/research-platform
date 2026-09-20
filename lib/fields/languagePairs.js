// lib/fields/languagePairs.js
//
// Which language of a paired field (title/title_ar, abstract/
// abstract_ar) the confirmation screen should actually show, and which
// column typed text belongs in.
//
// Kept out of the component so it can be tested directly rather than
// trusted by reading it — this is the logic that decides whether a
// submitter is shown a box their document has no content for, which is
// exactly the mistake BUG_HISTORY.md #20 records.

// Arabic, Arabic Supplement, Arabic Extended-A, and the Presentation
// Forms blocks. Enough to tell Arabic text from Latin, which is all
// this needs to decide — it is not a general language detector.
const ARABIC_SCRIPT = /[؀-ۿݐ-ݿﭐ-﷿ﹰ-﻿]/;

function looksArabic(text) {
  return ARABIC_SCRIPT.test(String(text ?? ''));
}

function nonEmpty(values, key) {
  return String(values?.[key] ?? '').trim().length > 0;
}

// Returns true when this field should be rendered at all.
//
// A paper is written in one language, usually. Showing an English and
// an Arabic box for the same title asks the submitter to fill in a
// field their document does not have.
//
//   - both languages present  -> both rendered (a real bilingual paper)
//   - one present             -> only that one
//   - neither                 -> only the pair's primary, never two
//                                empty boxes
function isFieldVisible(field, values) {
  if (!field.pair) return true;

  const self = nonEmpty(values, field.key);
  const other = nonEmpty(values, field.pair);

  if (self) return true;
  if (other) return false;
  return Boolean(field.primary);
}

// True only when BOTH halves of a pair are on screen, which is the
// only time a field needs its language spelled out in the label. A
// lone box saying "Title (English)" invites the same "where does my
// Arabic title go?" confusion this logic exists to remove.
function needsLanguageLabel(field, values) {
  return Boolean(field.pair) && nonEmpty(values, field.pair) && nonEmpty(values, field.key);
}

// When a pair was empty and the submitter typed into the single
// fallback box, move the text into the column matching the script they
// actually used. Without this an Arabic title typed into the one
// visible box lands in `title` and the Arabic column stays empty —
// re-creating the split this change removes.
//
// Returns a NEW corrections object; the input is not modified.
function routeByScript(corrections, fields) {
  const out = { ...corrections };

  for (const field of fields) {
    if (!field.primary || !field.pair) continue;

    const typed = String(out[field.key] ?? '').trim();
    // Only ever acts on the fallback case. If the partner column
    // already holds something, both boxes were on screen and the
    // submitter's own choice of box is authoritative.
    if (!typed || String(out[field.pair] ?? '').trim()) continue;

    if (looksArabic(typed)) {
      out[field.pair] = typed;
      out[field.key] = '';
    }
  }

  return out;
}

module.exports = { looksArabic, isFieldVisible, needsLanguageLabel, routeByScript };
