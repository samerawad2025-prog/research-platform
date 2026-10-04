// lib/extraction/pdfText.js
//
// Reads a PDF's own text layer on this server, so that under Google's
// unpaid Gemini terms only a short, minimized excerpt ever leaves it
// (lib/extraction/excerpt.js), never the PDF pages themselves.
//
// Why `unpdf` and not pdf-parse (BUG_HISTORY.md #2): pdf-parse loaded
// pdf.js's rendering path, which needs the browser-only DOMMatrix at
// module load and broke on Vercel's runtime. unpdf ships a serverless
// build of pdf.js with no DOM dependency (it polyfills the one global it
// touches) and no dependencies of its own. It is loaded lazily, only on
// the excerpt path, so nothing else in the pipeline depends on it.
//
// What it cannot do, deliberately:
//   - a scanned PDF has no text layer, so it yields no text (no OCR here);
//   - a PDF whose fonts carry no Unicode mapping yields unreadable glyphs.
// Both are reported to the caller, which then offers manual entry rather
// than sending anything (excerpt.js, assessText).

const MAX_PAGES = 25

// Arabic and the other right-to-left scripts this platform sees.
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-﻿]/
const LTR_LETTER = /[A-Za-z0-9À-ɏ]/

function classify(str) {
  if (RTL_LETTER.test(str)) return 'R'
  if (LTR_LETTER.test(str)) return 'L'
  return 'N'
}

// pdf.js reports text items in drawing order, each at its position on the
// page. Many PDF writers (Chromium, and Word for Arabic) draw right-to-left
// text glyph by glyph in VISUAL order, left to right. This rebuilds one
// line in reading (logical) order: items are ordered by x, runs written in
// the other direction than the line's own are kept together, and an RTL
// line is then read from its right edge. A deliberately small subset of
// the Unicode bidi algorithm, enough for title pages and abstracts; the
// excerpt path checks the result before using it (assessText).
function lineText(items) {
  const sorted = [...items].sort((a, b) => a.x - b.x)
  let r = 0
  let l = 0
  for (const it of sorted) {
    for (const ch of it.str) {
      if (RTL_LETTER.test(ch)) r += 1
      else if (/[A-Za-z]/.test(ch)) l += 1
    }
  }
  const base = r > l ? 'R' : 'L'
  const other = base === 'R' ? 'L' : 'R'

  // Pieces in visual (x) order, with a space where the gap says one is.
  const pieces = []
  let prev = null
  for (const it of sorted) {
    if (prev && it.str.trim() && prev.str.trim()) {
      const gap = it.x - (prev.x + prev.w)
      if (gap > Math.max(prev.h, it.h, 1) * 0.2) pieces.push({ str: ' ', kind: 'N' })
    }
    pieces.push({ str: it.str, kind: classify(it.str) })
    prev = it
  }

  // Group runs written in the other direction (neutrals between two of
  // them belong to the run), then lay the units out in reading order.
  const units = []
  for (let i = 0; i < pieces.length; i += 1) {
    const piece = pieces[i]
    if (piece.kind !== other) {
      units.push(piece.str)
      continue
    }
    const run = [piece.str]
    let j = i + 1
    while (j < pieces.length) {
      if (pieces[j].kind === other) { run.push(pieces[j].str); j += 1; continue }
      if (pieces[j].kind === 'N') {
        let k = j
        while (k < pieces.length && pieces[k].kind === 'N') k += 1
        if (k < pieces.length && pieces[k].kind === other) {
          for (let m = j; m <= k; m += 1) run.push(pieces[m].str)
          j = k + 1
          continue
        }
      }
      break
    }
    // An RTL run inside an LTR line reads right to left.
    units.push(base === 'L' ? run.reverse().join('') : run.join(''))
    i = j - 1
  }
  const text = base === 'R' ? units.reverse().join('') : units.join('')
  return normalizeLine(text)
}

// NFKC turns Arabic presentation forms back into ordinary letters and the
// "fi" ligature back into two letters; tatweel is decoration.
function normalizeLine(text) {
  return text.normalize('NFKC').replace(/ـ/g, '').replace(/[​-‏‪-‮⁦-⁩]/g, '').replace(/\s+/g, ' ').trim()
}

// Lines follow pdf.js's drawing order, which keeps a multi-column page's
// columns apart; a new line starts where the baseline moves or pdf.js
// marks an end of line.
function pageLines(items) {
  const lines = []
  let current = []
  let lastY = null
  let lastH = 0
  for (const raw of items) {
    if (typeof raw.str !== 'string') continue
    const it = { str: raw.str, x: raw.transform[4], y: raw.transform[5], w: raw.width || 0, h: raw.height || 0 }
    const tol = Math.max(lastH, it.h, 2) * 0.5
    if (current.length && lastY !== null && Math.abs(it.y - lastY) > tol && it.str !== '') {
      lines.push(current)
      current = []
    }
    if (it.str !== '') {
      current.push(it)
      lastY = it.y
      lastH = it.h || lastH
    }
    if (raw.hasEOL && current.length) {
      lines.push(current)
      current = []
      lastY = null
    }
  }
  if (current.length) lines.push(current)
  return lines.map(lineText).filter(Boolean)
}

// Returns { pages: [[line, ...], ...], totalPages }. Throws an
// ExtractionError-shaped error the caller maps to "manual entry" when the
// file cannot be parsed at all.
async function extractPdfLines(buffer, maxPages = MAX_PAGES) {
  const { getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(buffer))
  try {
    const count = Math.min(pdf.numPages, maxPages)
    const pages = []
    for (let i = 1; i <= count; i += 1) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      pages.push(pageLines(content.items))
    }
    return { pages, totalPages: pdf.numPages }
  } finally {
    await pdf.destroy?.()
  }
}

module.exports = { extractPdfLines, lineText, pageLines, normalizeLine, MAX_PAGES }
