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
  await check('staff exclusion: a signed marker with no user id or role; valid, expired, tampered and forged values', async () => {
    const v = A.signStaffCookie(ENV)
    assert.match(v, /^v1\.\d{10}\.[0-9a-f]{64}$/, 'no user id, no role, only an expiry and a signature')
    assert.ok(A.verifyStaffCookie(ENV, v))
    assert.ok(!A.verifyStaffCookie({ SUBMISSION_TOKEN_SECRET: 'x'.repeat(40) }, v), 'another secret')
    assert.ok(!A.verifyStaffCookie(ENV, v.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'))), 'tampered signature')
    const [, exp, mac] = v.split('.')
    assert.ok(!A.verifyStaffCookie(ENV, `v1.${Number(exp) + 3600}.${mac}`), 'a later expiry with the old signature')
    assert.ok(!A.verifyStaffCookie(ENV, A.signStaffCookie(ENV, Date.now() - 13 * 3600 * 1000)), 'expired')
    for (const bad of ['staff', 'true', 'role=administrator', '', `v2.${exp}.${mac}`, `${exp}.${mac}`]) assert.ok(!A.verifyStaffCookie(ENV, bad), bad)
    assert.ok(!A.verifyStaffCookie({}, v), 'no server secret: nothing verifies')
    assert.match(A.staffCookieHeader(ENV, true), /^sarp_staff_nocount=v1\.\d+\.[0-9a-f]{64}; Path=\/; Max-Age=43200; HttpOnly; SameSite=Lax; Secure$/)
  })
  await check('client keys: the same client gets the same key all UTC day, an unrelated key the next day; no raw address or browser string leaves', async () => {
    const h = hdr()
    const noon = Date.parse('2026-09-30T12:00:00Z')
    const a = A.clientHash(ENV, '203.0.113.7', h, Date.parse('2026-09-30T00:00:00Z'))
    assert.strictEqual(a, A.clientHash(ENV, '203.0.113.7', h, Date.parse('2026-09-30T23:59:59.999Z')))
    assert.notStrictEqual(a, A.clientHash(ENV, '203.0.113.7', h, Date.parse('2026-10-01T00:00:00Z')), 'no cross-day reuse')
    assert.notStrictEqual(a, A.clientHash(ENV, '203.0.113.8', h, noon))
    assert.notStrictEqual(A.clientHash(ENV, '203.0.113.7', h, noon), A.clientHash(ENV, '203.0.113.7', hdr({ 'user-agent': 'Mozilla/5.0 Firefox/130' }), noon))
    const sb = fake()
    const lines = []
    await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: h, clientKey: '203.0.113.7', env: ENV, log: { error: (x) => lines.push(x) }, now: noon })
    const sent = JSON.stringify(sb.calls) + lines.join('')
    assert.ok(!sent.includes('203.0.113.7') && !sent.includes('Chrome/130'), 'neither the address nor the browser string is sent or logged')
    const limiterKey = sb.calls.find((c) => c[0] === 'consume_submission_rate_limit')[1].p_key
    assert.strictEqual(limiterKey, `activity:${A.clientHash(ENV, '203.0.113.7', h, noon).slice(0, 32)}`, 'the rate-limit key is the daily key too')
    // The document route's limiter uses the same daily key.
    const fsb = fake({ public_document: () => ({ data: null, error: null }) })
    await handlePublicFile({ publicId: 'abcdefghjkmn', supabase: fsb, storage: {}, headers: h, env: ENV, clientKey: '203.0.113.7', log: quiet })
    assert.strictEqual(fsb.calls[0][1].p_key, `public_file:${A.clientHash(ENV, '203.0.113.7', h).slice(0, 32)}`)
    // 10-minute windows are epoch-aligned, so a UTC day always starts a new window: the daily key never splits one.
    assert.strictEqual(86400 % A.EVENT_LIMIT[1], 0)
  })
  await check('recording: the browser names an event only; the server hashes the client, never sends the address, never throws', async () => {
    let sb = fake()
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), clientKey: '203.0.113.7', env: ENV, log: quiet }), 'counted')
    const args = sb.calls.find((c) => c[0] === 'public_record_event')[1]
    assert.match(args.p_client, /^[0-9a-f]{64}$/); assert.ok(!JSON.stringify(sb.calls).includes('203.0.113.7'))
    sb = fake()
    const staff = hdr({ cookie: `other=1; ${A.STAFF_COOKIE}=${A.signStaffCookie(ENV)}` })
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: staff, env: ENV, log: quiet }), 'skipped:staff')
    assert.strictEqual(sb.calls.length, 0)
    sb = fake({ public_record_event: () => ({ data: null, error: { message: 'down' } }) })
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet }), 'not_recorded')
    sb = { rpc: async () => { throw new Error('network') } }
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet }), 'not_recorded')
    sb = fake({ consume_submission_rate_limit: () => ({ data: false, error: null }) })
    assert.strictEqual(await A.recordEvent({ supabase: sb, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet }), 'skipped:rate_limited')
  })
  // A dependency that never answers (not an immediate rejection).
  const stall = () => new Promise(() => {})
  const stalledRpc = (names) => fake(Object.fromEntries(names.map((n) => [n, stall])))
  await check('time budget: a stalled metrics database is abandoned within the budget, the request is aborted, and it is reported as not recorded', async () => {
    for (const names of [['consume_submission_rate_limit'], ['public_record_event']]) {
      const t0 = Date.now()
      const r = await A.recordEvent({ supabase: stalledRpc(names), publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet, budgetMs: 150 })
      const took = Date.now() - t0
      assert.strictEqual(r, 'not_recorded', names[0]); assert.ok(took >= 140 && took < 400, `${names[0]} took ${took} ms`)
    }
    let aborted = false
    const builder = { then: (res) => new Promise(() => {}).then(res), abortSignal(sig) { sig.addEventListener('abort', () => { aborted = true }); return this } }
    await A.recordEvent({ supabase: { rpc: () => builder }, publicId: 'abcdefghjkmn', event: 'page_view', headers: hdr(), env: ENV, log: quiet, budgetMs: 50 })
    assert.ok(aborted, 'the supabase-js request is aborted, not left running in the background')
    const t0 = Date.now()
    assert.deepStrictEqual(await A.getActivity(stalledRpc(['public_activity']), 'abcdefghjkmn', 150), { error: true })
    assert.ok(Date.now() - t0 < 400)
    assert.deepStrictEqual(await A.getActivity(fake({ public_activity: () => ({ data: { page_view: 3 }, error: null }) }), 'abcdefghjkmn'), { data: { page_view: 3 } }, 'normal reads still work')
    assert.strictEqual(A.METRICS_BUDGET_MS, 400)
  })
  await check('time budget: citation and document requests return promptly while metrics stall; eligibility is never skipped', async () => {
    let t0 = Date.now()
    let r = await handleCite({ publicId: 'abcdefghjkmn', format: 'ris', supabase: stalledRpc(['public_record_event']), headers: hdr(), env: ENV, log: quiet })
    assert.strictEqual(r.status, 200); assert.ok(Date.now() - t0 < 1000, `cite took ${Date.now() - t0} ms`)
    // Eligibility itself is not optional: a stalled record read is not bypassed.
    const slowRecord = fake({ public_record: () => new Promise((res) => setTimeout(() => res({ data: null, error: null }), 600)) })
    r = await handleCite({ publicId: 'abcdefghjkmn', format: 'ris', supabase: slowRecord, headers: hdr(), env: ENV, log: quiet })
    assert.strictEqual(r.status, 404, 'waited for the rule and refused')
    const doc = { storage_path: 'dissemination/p/v.pdf', format: 'pdf', title: 'T' }
    let signedAt = 0
    const storage = { createSignedUrl: async (p) => { signedAt = Date.now(); return { data: { signedUrl: `https://s.invalid/${p}` }, error: null } } }
    t0 = Date.now()
    r = await handlePublicFile({ publicId: 'abcdefghjkmn', mode: 'read', supabase: fake({ public_document: () => ({ data: doc, error: null }), public_record_event: stall }), storage, headers: hdr(), env: ENV, clientKey: 'c', log: quiet })
    const lost = Date.now() - signedAt
    assert.strictEqual(r.status, 303); assert.ok(lost < 1000, `the link lost ${lost} ms of its 60 s before the reader got it`)
    const hsb = fake({ public_document: () => ({ data: doc, error: null }), public_record_event: stall })
    r = await handlePublicFile({ method: 'HEAD', publicId: 'abcdefghjkmn', mode: 'read', supabase: hsb, storage, headers: hdr(), env: ENV, clientKey: 'c', log: quiet })
    assert.strictEqual(r.status, 200); assert.ok(!hsb.calls.some((c) => c[0] === 'public_record_event'), 'HEAD: no activity')
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
