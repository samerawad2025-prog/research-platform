// lib/public/citation.js
//
// Phase 3 M6: citation text, RIS and BibTeX from a public record (the
// allowlisted fields of public_record(), migration 0016) and its permanent
// URL. Only confirmed local metadata is used:
//   - author names exactly as confirmed, in their order; a full name is
//     never split into family and given names (BibTeX gets each name in
//     braces so it is treated as one literal name);
//   - no invented year, publisher, journal, degree or identifier: a
//     missing value is left out ("n.d." in the text citation only);
//   - no DOI: the schema records none, so none is exported;
//   - Arabic and other Unicode text is kept as it is (UTF-8).
// Plain CommonJS so it can be tested without Next.js.

const clean = (s) => (s == null ? '' : String(s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim())

function workType(r) {
  const deg = clean(r.degree_type)
  if (r.document_type === 'thesis') {
    if (/^(ph\.?\s?d|d\.?\s?phil|doctor)/i.test(deg)) return 'phd'
    if (/^(m\.?\s?sc|m\.?\s?a\b|m\.?\s?phil|mba|m\.?\s?ed|master|llm)/i.test(deg)) return 'masters'
    return 'thesis'
  }
  if (r.document_type === 'article') return 'article'
  return 'other'
}

function institutionName(r) {
  return clean(r.institution?.name_en || r.institution?.name_ar)
}
function unitName(r) {
  return clean(r.unit?.name_en || r.unit?.name_ar || r.unit?.text)
}
function titleOf(r) {
  const en = clean(r.title)
  const ar = clean(r.title_ar)
  return { main: en || ar, other: en && ar && en !== ar ? ar : '' }
}
function authorsOf(r) {
  return (r.authors || []).map((a) => clean(a.name)).filter(Boolean)
}

// "A, B and C (2021). Title [Arabic title]. MSc thesis, Faculty, University. URL"
function citationText(r, url) {
  const authors = authorsOf(r)
  const who = authors.length === 0 ? '' : authors.length === 1 ? authors[0]
    : `${authors.slice(0, -1).join(', ')} and ${authors[authors.length - 1]}`
  const { main, other } = titleOf(r)
  const t = workType(r)
  const deg = clean(r.degree_type)
  const kind = t === 'phd' || t === 'masters' || t === 'thesis' ? `${deg ? `${deg} thesis` : 'Thesis'}` : ''
  const where = [unitName(r), institutionName(r)].filter(Boolean).join(', ')
  const parts = []
  // A full stop is added only where the text does not already end in one.
  const dot = (x) => (/[.!?؟]$/.test(x) ? x : `${x}.`)
  parts.push(`${who ? `${who} ` : ''}(${r.year || 'n.d.'}).`)
  parts.push(dot(`${main}${other ? ` [${other}]` : ''}`))
  const desc = [kind, where].filter(Boolean).join(', ')
  if (desc) parts.push(dot(desc))
  if (url) parts.push(url)
  return parts.join(' ')
}

// RIS: one tag per line, "TAG  - value", CRLF, ending with "ER  - ".
function ris(r, url) {
  const t = workType(r)
  const lines = [['TY', t === 'article' || t === 'other' ? 'GEN' : 'THES']]
  for (const a of authorsOf(r)) lines.push(['AU', a])
  const { main, other } = titleOf(r)
  lines.push(['TI', main])
  if (other) lines.push(['TT', other])
  if (r.year) lines.push(['PY', String(r.year)])
  if (t === 'article') lines.push(['M3', 'Article'])
  else if (t !== 'other') lines.push(['M3', clean(r.degree_type) ? `${clean(r.degree_type)} thesis` : 'Thesis'])
  if (institutionName(r) && t !== 'article') lines.push(['PB', institutionName(r)])
  if (unitName(r)) lines.push(['AD', unitName(r)])
  const abs = clean(r.abstract) || clean(r.abstract_ar)
  if (abs) lines.push(['AB', abs])
  if (url) lines.push(['UR', url])
  lines.push(['ER', ''])
  return lines.map(([k, v]) => `${k}  - ${v}`.trimEnd() + (k === 'ER' ? ' ' : '')).join('\r\n') + '\r\n'
}

// BibTeX: special characters escaped; each author in braces (one literal
// name, never split); UTF-8 kept.
function bibEscape(s) {
  return clean(s).replace(/[\\{}]/g, (c) => (c === '\\' ? '\\textbackslash{}' : `\\${c}`))
    .replace(/[&%$#_]/g, (c) => `\\${c}`).replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}')
}
function bibtex(r, url) {
  const t = workType(r)
  const entry = t === 'phd' ? 'phdthesis' : t === 'masters' ? 'mastersthesis' : 'misc'
  const f = []
  const authors = authorsOf(r)
  if (authors.length) f.push(['author', authors.map((a) => `{${bibEscape(a)}}`).join(' and ')])
  const { main, other } = titleOf(r)
  f.push(['title', `{${bibEscape(main)}}`])
  if (other) f.push(['note', `Title in Arabic: ${bibEscape(other)}`])
  if (r.year) f.push(['year', String(r.year)])
  if (t === 'phd' || t === 'masters') {
    if (institutionName(r)) f.push(['school', bibEscape(institutionName(r))])
    if (clean(r.degree_type)) f.push(['type', `${bibEscape(r.degree_type)} thesis`])
  } else if (t === 'thesis') {
    f.push(['howpublished', `${clean(r.degree_type) ? `${bibEscape(r.degree_type)} thesis` : 'Thesis'}${institutionName(r) ? `, ${bibEscape(institutionName(r))}` : ''}`])
  }
  if (unitName(r)) f.push(['address', bibEscape(unitName(r))])
  if (url) f.push(['url', url])
  const abs = clean(r.abstract) || clean(r.abstract_ar)
  if (abs) f.push(['abstract', bibEscape(abs)])
  return `@${entry}{sarp-${r.public_id},\n${f.map(([k, v]) => `  ${k} = {${v}}`).join(',\n')}\n}\n`
}

module.exports = { citationText, ris, bibtex, bibEscape, workType }
