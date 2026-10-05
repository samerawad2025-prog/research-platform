// lib/submission/agreementMarkdown.js
//
// A deliberately tiny parser for the Markdown subset the agreement files in
// docs/legal/ use: headings (#, ##, ###), paragraphs, **bold**, "* " bullet
// lists, and a trailing double space as a line break. It returns plain data
// that the page renders as React elements (never as HTML strings), so no
// dependency and no raw-HTML path is involved. Shared by the server (to
// find the acceptance sentence) and the browser (to render the text).

function inlines(text) {
  // **bold** only. An unmatched ** is kept as literal text.
  const out = []
  const re = /\*\*(.+?)\*\*/g
  let last = 0
  let m
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) })
    out.push({ text: m[1], bold: true })
    last = re.lastIndex
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

function parseAgreement(markdown) {
  const blocks = []
  let para = null
  let list = null
  const flush = () => {
    if (para) blocks.push({ type: 'p', lines: para.map(inlines) })
    if (list) blocks.push({ type: 'ul', items: list.map(inlines) })
    para = null
    list = null
  }
  for (const raw of String(markdown).replace(/\r\n/g, '\n').split('\n')) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(raw)
    const bullet = /^\*\s+(.*)$/.exec(raw)
    if (!raw.trim()) {
      flush()
    } else if (heading) {
      flush()
      blocks.push({ type: 'h', level: heading[1].length, text: heading[2].trim() })
    } else if (bullet) {
      if (para) flush()
      list = list || []
      list.push(bullet[1].trim())
    } else {
      if (list) flush()
      para = para || []
      para.push(raw.replace(/\s+$/, ''))
    }
  }
  flush()
  return blocks
}

// The sentence the checkbox uses: the paragraph under the last heading,
// which in both files is the acceptance heading, without its ** markers.
function acceptanceSentence(blocks) {
  let lastHeading = -1
  blocks.forEach((b, i) => { if (b.type === 'h') lastHeading = i })
  const p = blocks.slice(lastHeading + 1).find((b) => b.type === 'p')
  return p ? p.lines.map((l) => l.map((s) => s.text).join('')).join(' ').trim() : null
}

module.exports = { parseAgreement, acceptanceSentence, inlines }
