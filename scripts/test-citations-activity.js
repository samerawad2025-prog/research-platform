#!/usr/bin/env node
// Phase 3 M6, mocked (runs in CI): citation text, RIS and BibTeX from
// synthetic records; what is and is not counted; the server-signed staff
// exclusion; and that citations, documents and pages never depend on the
// counting succeeding. Real parsers: scripts/validate-citations.py. Real
// database: supabase/tests/public-postgres.test.js.

const assert = require('node:assert')
const path = require('node:path')
const ROOT = path.join(__dirname, '..')
const C = require(path.join(ROOT, 'lib/public/citation'))
const A = require(path.join(ROOT, 'lib/public/activity'))
const { handleCite } = require(path.join(ROOT, 'lib/public/cite'))
const { handleEvent } = require(path.join(ROOT, 'lib/public/events'))
const { handlePublicFile } = require(path.join(ROOT, 'lib/public/server'))

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok     ${name}`) } catch (err) { console.error(`FAIL   ${name} — ${err.stack || err.message}`); failed++ }
}
const quiet = { error() {} }
const ENV = { PUBLIC_RESEARCH: 'enabled', PUBLIC_SITE_ORIGIN: 'https://research.example.org', SUBMISSION_TOKEN_SECRET: 's'.repeat(40) }
const BROWSER = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const hdr = (o = {}) => new Headers({ 'user-agent': BROWSER, ...o })

const EN = {
  public_id: 'abcdefghjkmn', title: 'Groundwater Salinity in the Gezira Scheme', title_ar: null, abstract: 'Line one.\nLine two with 50% & more_{x}.',
  year: 2021, degree_type: 'MSc', document_type: 'thesis', supervisor_name: 'Dr X',
  institution: { name_en: 'University of Khartoum', name_ar: 'جامعة الخرطوم' }, unit: { name_en: 'Faculty of Science', name_ar: null },
  authors: [{ name: 'Amna Hassan Ali' }, { name: 'Omer El Tayeb' }, { name: 'de la Cruz, Maria' }], setting: 'record_abstract',
}
const AR = { ...EN, title: null, title_ar: 'ملوحة المياه الجوفية في مشروع الجزيرة', abstract: null, abstract_ar: 'دراسة عن الملوحة.', authors: [{ name: 'آمنة حسن علي' }], degree_type: 'دكتوراه', year: null }
const MIXED = { ...EN, title: 'Water {Quality} in Kassala', title_ar: 'جودة المياه في كسلا', document_type: 'article', degree_type: null, authors: [{ name: 'A. B. Smith' }, { name: 'محمد أحمد' }] }
const BARE = { public_id: 'abcdefghjkmn', title: 'Only a Title', authors: [], document_type: null, year: null }

function risFields(text) {
  const lines = text.split('\r\n').filter(Boolean)
  for (const l of lines) assert.match(l, /^[A-Z][A-Z0-9]  - ?/, `bad RIS line: ${l}`)
  assert.strictEqual(lines[0].slice(0, 6), 'TY  - '); assert.strictEqual(lines[lines.length - 1], 'ER  - ')
  const out = {}
  for (const l of lines) { const k = l.slice(0, 2); (out[k] = out[k] || []).push(l.slice(6)) }
  return out
}
function bibBalanced(text) {
  let depth = 0
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') { i++; continue }
    if (text[i] === '{') depth++
    if (text[i] === '}') { depth--; assert.ok(depth >= 0, 'unbalanced braces') }
  }
  assert.strictEqual(depth, 0, 'unbalanced braces')
}

async function main() {
  await check('citation text: authors as recorded and in order, no invented values, the permanent URL', async () => {
    const t = C.citationText(EN, 'https://research.example.org/research/abcdefghjkmn')
    assert.strictEqual(t, 'Amna Hassan Ali, Omer El Tayeb and de la Cruz, Maria (2021). Groundwater Salinity in the Gezira Scheme. MSc thesis, Faculty of Science, University of Khartoum. https://research.example.org/research/abcdefghjkmn')
    assert.strictEqual(C.citationText(BARE, null), '(n.d.). Only a Title.', 'missing author, year, type and URL are not filled in')
    const ar = C.citationText(AR, null)
    assert.ok(ar.includes('آمنة حسن علي') && ar.includes('ملوحة المياه الجوفية') && ar.includes('(n.d.)') && ar.includes('دكتوراه thesis'))
    const mixed = C.citationText(MIXED, null)
    assert.ok(mixed.includes('Water {Quality} in Kassala [جودة المياه في كسلا]') && !/thesis/i.test(mixed), 'an article is not called a thesis; no journal is invented')
  })
  await check('RIS: well-formed lines, one AU per author unsplit, types from the metadata, multiline collapsed, UTF-8 kept', async () => {
    const f = risFields(C.ris(EN, 'https://research.example.org/research/abcdefghjkmn'))
    assert.deepStrictEqual(f.TY, ['THES']); assert.deepStrictEqual(f.AU, ['Amna Hassan Ali', 'Omer El Tayeb', 'de la Cruz, Maria'])
    assert.deepStrictEqual(f.PY, ['2021']); assert.deepStrictEqual(f.PB, ['University of Khartoum']); assert.deepStrictEqual(f.M3, ['MSc thesis'])
    assert.deepStrictEqual(f.AB, ['Line one. Line two with 50% & more_{x}.'])
    assert.deepStrictEqual(f.UR, ['https://research.example.org/research/abcdefghjkmn'])
    const a = risFields(C.ris(AR, null))
    assert.deepStrictEqual(a.TI, ['ملوحة المياه الجوفية في مشروع الجزيرة']); assert.strictEqual(a.PY, undefined); assert.strictEqual(a.UR, undefined)
    const m = risFields(C.ris(MIXED, null))
    assert.deepStrictEqual(m.TY, ['GEN']); assert.deepStrictEqual(m.TT, ['جودة المياه في كسلا']); assert.strictEqual(m.PB, undefined, 'no publisher invented for an article')
    const b = risFields(C.ris(BARE, null))
    assert.deepStrictEqual(Object.keys(b).sort(), ['ER', 'TI', 'TY'])
    assert.ok(!C.ris({ ...EN, title: 'A\r\nTI  - injected' }, null).includes('\r\nTI  - injected'), 'a line break in a value cannot start a new tag')
  })
  await check('BibTeX: entry type from the degree, names kept whole, specials escaped, braces balanced, no DOI', async () => {
    const b = C.bibtex(EN, 'https://research.example.org/research/abcdefghjkmn')
    assert.match(b, /^@mastersthesis\{sarp-abcdefghjkmn,\n/)
    assert.ok(b.includes('author = {{Amna Hassan Ali} and {Omer El Tayeb} and {de la Cruz, Maria}}'))
    assert.ok(b.includes('abstract = {Line one. Line two with 50\\% \\& more\\_\\{x\\}.}'))
    assert.ok(b.includes('school = {University of Khartoum}') && b.includes('type = {MSc thesis}'))
    assert.ok(!/doi/i.test(b))
    bibBalanced(b)
    assert.match(C.bibtex({ ...EN, degree_type: 'PhD' }, null), /^@phdthesis/)
    assert.match(C.bibtex({ ...EN, degree_type: 'Diploma' }, null), /^@misc/, 'an unknown degree is not guessed')
    assert.match(C.bibtex(MIXED, null), /^@misc/, 'no journal, so not @article')
    const ar = C.bibtex(AR, null)
    assert.ok(ar.includes('title = {{ملوحة المياه الجوفية في مشروع الجزيرة}}') && !/year =/.test(ar) && !/url =/.test(ar))
    for (const r of [AR, MIXED, BARE, { ...EN, title: 'Back\\slash ~ ^ # $ } {' }]) bibBalanced(C.bibtex(r, null))
  })
  await check('what is not counted: bots, previews, prefetch, no browser string; real browsers are', async () => {
    for (const ua of ['Googlebot/2.1', 'facebookexternalhit/1.1', 'WhatsApp/2.23', 'Slackbot-LinkExpanding', 'curl/8.0', 'Mozilla/5.0 HeadlessChrome/120', 'python-requests/2.31', 'node-fetch']) {
      assert.ok(A.automatedReason(new Headers({ 'user-agent': ua })), ua)
    }
    assert.strictEqual(A.automatedReason(new Headers({})), 'no_user_agent')
    assert.strictEqual(A.automatedReason(hdr({ 'sec-purpose': 'prefetch;prerender' })), 'prefetch')
    assert.strictEqual(A.automatedReason(hdr({ purpose: 'prefetch' })), 'prefetch')
    assert.strictEqual(A.automatedReason(hdr({ 'next-router-prefetch': '1' })), 'prefetch')
    assert.strictEqual(A.automatedReason(hdr()), null)
  })
  await check('staff exclusion: only a cookie this server signed, unexpired and untampered, excludes', async () => {
    const v = A.signStaffCookie(ENV, '00000000-0000-4000-8000-000000000001')
    assert.ok(A.verifyStaffCookie(ENV, v))
    assert.ok(!A.verifyStaffCookie({ SUBMISSION_TOKEN_SECRET: 'x'.repeat(40) }, v), 'another secret')
    assert.ok(!A.verifyStaffCookie(ENV, v.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), 'tampered')
    assert.ok(!A.verifyStaffCookie(ENV, A.signStaffCookie(ENV, 'u', Date.now() - 13 * 3600 * 1000)), 'expired')
    for (const bad of ['staff', 'true', 'role=administrator', '']) assert.ok(!A.verifyStaffCookie(ENV, bad))
    assert.match(A.staffCookieHeader(ENV, 'u', true), /HttpOnly; SameSite=Lax; Secure$/)
  })
  const fake = (over = {}) => {
    const calls = []
    return {
      calls,
      rpc: async (name, args) => {
        calls.push([name, args])
        if (over[name]) return over[name](args)
        if (name === 'consume_submission_rate_limit') return { data: true, error: null }
        if (name === 'public_record_event') return { data: 'counted', error: null }
        if (name === 'public_record') return { data: EN, error: null }
        return { data: null, error: null }
      },
    }
  }
  await check('recording: the browser names an event only; the server hashes the client, never sends the address, never throws', async () => {
    let sb = fake()
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), clientKey: '203.0.113.7', env: ENV, log: quiet }), 'counted')
    const args = sb.calls.find((c) => c[0] === 'public_record_event')[1]
    assert.match(args.p_client, /^[0-9a-f]{64}$/); assert.ok(!JSON.stringify(sb.calls).includes('203.0.113.7'))
    sb = fake()
    const staff = hdr({ cookie: `other=1; ${A.STAFF_COOKIE}=${A.signStaffCookie(ENV, 'u')}` })
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: staff, env: ENV, log: quiet }), 'skipped:staff')
    assert.strictEqual(sb.calls.length, 0)
    sb = fake({ public_record_event: () => ({ data: null, error: { message: 'down' } }) })
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet }), 'not_recorded')
    sb = { rpc: async () => { throw new Error('network') } }
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet }), 'not_recorded')
    sb = fake({ consume_submission_rate_limit: () => ({ data: false, error: null }) })
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet }), 'skipped:rate_limited')
  })
  await check('event endpoint: two named events only, no counts or roles from the browser, cross-site refused, honest "recorded"', async () => {
    const run = (body, h = hdr(), over) => handleEvent({ publicId: 'abcdefghjkmn', body, headers: h, supabase: fake(over), env: ENV, log: quiet })
    assert.deepStrictEqual(await run({ event: 'page_view' }), { status: 202, body: { recorded: true } })
    for (const bad of [{ event: 'download' }, { event: 'page_view', count: 50 }, { event: 'page_view', role: 'administrator' }, [], null]) assert.strictEqual((await run(bad)).status, 400, JSON.stringify(bad))
    assert.strictEqual((await run({ event: 'page_view' }, hdr({ 'sec-fetch-site': 'cross-site' }))).status, 403)
    assert.deepStrictEqual(await run({ event: 'page_view' }, hdr(), { public_record_event: () => ({ data: 'duplicate', error: null }) }), { status: 202, body: { recorded: false } })
    assert.deepStrictEqual(await run({ event: 'citation_copy' }, hdr(), { public_record_event: () => ({ data: 'not_eligible', error: null }) }), { status: 404, body: { recorded: false } })
    assert.deepStrictEqual(await run({ event: 'page_view' }, hdr(), { public_record_event: () => ({ data: null, error: {} }) }), { status: 202, body: { recorded: false } }, 'a failure is never reported as a count')
    assert.strictEqual((await handleEvent({ publicId: 'abcdefghjkmn', body: { event: 'page_view' }, headers: hdr(), supabase: fake(), env: {}, log: quiet })).status, 404, 'site off')
  })
  await check('citation download: the current rule, a HEAD counts nothing, and a counting failure still serves the file', async () => {
    let sb = fake()
    let r = await handleCite({ publicId: 'abcdefghjkmn', format: 'ris', supabase: sb, headers: hdr(), env: ENV, log: quiet })
    assert.strictEqual(r.status, 200); assert.match(r.headers['Content-Type'], /research-info-systems/); assert.match(r.headers['Content-Disposition'], /sarp-abcdefghjkmn\.ris/)
    assert.ok(r.body.includes('UR  - https://research.example.org/research/abcdefghjkmn'))
    assert.ok(sb.calls.some((c) => c[0] === 'public_record_event' && c[1].p_event === 'citation_export'))
    sb = fake()
    r = await handleCite({ method: 'HEAD', publicId: 'abcdefghjkmn', format: 'bibtex', supabase: sb, headers: hdr(), env: ENV, log: quiet })
    assert.strictEqual(r.status, 200); assert.strictEqual(r.body, null); assert.ok(!sb.calls.some((c) => c[0] === 'public_record_event'))
    sb = fake({ public_record_event: () => ({ data: null, error: {} }) })
    r = await handleCite({ publicId: 'abcdefghjkmn', format: 'bibtex', supabase: sb, headers: hdr(), env: ENV, log: quiet })
    assert.strictEqual(r.status, 200); assert.match(r.body, /^@mastersthesis/)
    sb = fake({ public_record: () => ({ data: null, error: null }) })
    r = await handleCite({ publicId: 'abcdefghjkmn', format: 'ris', supabase: sb, headers: hdr(), env: ENV, log: quiet })
    assert.strictEqual(r.status, 404, 'a record that stopped being public after the page was shown')
    assert.ok(!sb.calls.some((c) => c[0] === 'public_record_event'))
    assert.strictEqual((await handleCite({ publicId: 'abcdefghjkmn', format: 'endnote', supabase: fake(), headers: hdr(), env: ENV })).status, 400)
    r = await handleCite({ publicId: 'abcdefghjkmn', format: 'ris', supabase: fake(), headers: hdr(), env: { ...ENV, PUBLIC_SITE_ORIGIN: '' }, log: quiet })
    assert.ok(!/UR {2}-/.test(r.body), 'no permanent address: no URL, never the request host')
  })
  await check('document route: a HEAD issues no link and counts nothing; a counting failure still gives the reader the link', async () => {
    const doc = { storage_path: 'dissemination/p/v.pdf', format: 'pdf', title: 'T' }
    const storage = { createSignedUrl: async (p) => ({ data: { signedUrl: `https://s.invalid/${p}` }, error: null }) }
    let sb = fake({ public_document: () => ({ data: doc, error: null }) })
    let r = await handlePublicFile({ method: 'HEAD', publicId: 'abcdefghjkmn', mode: 'read', supabase: sb, storage, headers: hdr(), env: ENV, clientKey: 'c', log: quiet })
    assert.strictEqual(r.status, 200); assert.ok(!r.headers.Location); assert.ok(!sb.calls.some((c) => c[0] === 'public_record_event'))
    sb = fake({ public_document: () => ({ data: doc, error: null }), public_record_event: () => ({ data: null, error: {} }) })
    r = await handlePublicFile({ publicId: 'abcdefghjkmn', mode: 'download', supabase: sb, storage, headers: hdr(), env: ENV, clientKey: 'c', log: quiet })
    assert.strictEqual(r.status, 303); assert.ok(r.headers.Location)
    assert.strictEqual(sb.calls.find((c) => c[0] === 'public_record_event')[1].p_event, 'document_download')
  })
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
  process.exit(failed ? 1 : 0)
}
main()
