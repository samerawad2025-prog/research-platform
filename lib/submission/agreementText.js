// lib/submission/agreementText.js
//
// Server only. Reads an agreement's exact text from docs/legal/ (the
// single source of truth) and serves it only if its SHA-256 is still the
// one in the registry, so the text a researcher reads is byte-for-byte
// the version the offer names and the acceptance records. A mismatch or a
// missing file means that agreement is simply not offered.
// next.config.mjs includes docs/legal/*.md in the /api/submissions/terms
// function bundle.

const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const cache = new Map()

function agreementText(agreement, root = process.cwd()) {
  if (cache.has(agreement.id)) return cache.get(agreement.id)
  let text = null
  try {
    const bytes = fs.readFileSync(path.join(root, agreement.file))
    if (crypto.createHash('sha256').update(bytes).digest('hex') === agreement.sha256) text = bytes.toString('utf8')
  } catch {
    text = null
  }
  if (text) cache.set(agreement.id, text)
  return text
}

module.exports = { agreementText }
