// The citation download (RIS or BibTeX) for GET/HEAD
// /research/[publicId]/cite?format=ris|bibtex. Pure enough to test without
// Next.js: -> { status, headers, body }.
const { isPublicEnabled, recordUrl, getRecord, PUBLIC_ID } = require('./server')
const { ris, bibtex } = require('./citation')
const { recordEvent } = require('./activity')

const FORMATS = {
  ris: { make: ris, type: 'application/x-research-info-systems; charset=utf-8', ext: 'ris' },
  bibtex: { make: bibtex, type: 'application/x-bibtex; charset=utf-8', ext: 'bib' },
}

async function handleCite({ method = 'GET', publicId, format, supabase, headers, clientKey, env = process.env, log = console }) {
  const base = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' }
  const notFound = { status: 404, headers: base, body: 'Not found.' }
  if (!isPublicEnabled(env) || !PUBLIC_ID.test(String(publicId || ''))) return notFound
  const f = FORMATS[format]
  if (!f) return { status: 400, headers: base, body: 'Unknown format.' }
  // The same current rule as the page: a record that stopped being public
  // after the page was shown gets no citation.
  const r = await getRecord(supabase, publicId)
  if (r.error) return { status: 503, headers: base, body: 'Temporarily unavailable.' }
  if (!r.data) return notFound
  const body = f.make(r.data, recordUrl(publicId, env))
  const out = { ...base, 'Content-Type': f.type, 'Content-Disposition': `attachment; filename="sarp-${publicId}.${f.ext}"` }
  if (method === 'HEAD') return { status: 200, headers: out, body: null }
  // Counted after the file is ready; a counting failure never blocks it.
  await recordEvent({ supabase, publicId, event: 'citation_export', headers, clientKey, env, log })
  return { status: 200, headers: out, body }
}

module.exports = { handleCite, FORMATS }
