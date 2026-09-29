#!/usr/bin/env node
// Phase 3 M5, mocked (runs in CI): the public file route's refusals and
// limits, where permanent links come from, URL filter parsing, the admin
// public link, and static guards on the public pages. The database side is
// tested for real in supabase/tests/public-postgres.test.js.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const ROOT = path.join(__dirname, '..')
const P = require(path.join(ROOT, 'lib/public/server'))
const { handleAdmin } = require(path.join(ROOT, 'lib/admin/handlers'))

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok     ${name}`) } catch (err) { console.error(`FAIL   ${name} — ${err.stack || err.message}`); failed++ }
}
const PID = 'abcdefghjkmn'
const ON = { PUBLIC_RESEARCH: 'enabled', SUBMISSION_TOKEN_SECRET: 'x'.repeat(40) }

function fake({ doc = null, docError = false, limited = false, signError = false } = {}) {
  const calls = { rpc: [], sign: [] }
  const supabase = {
    rpc: async (name, args) => {
      calls.rpc.push([name, args])
      if (name === 'consume_submission_rate_limit') return { data: !limited, error: null }
      if (name === 'public_document') return docError ? { data: null, error: { message: 'down' } } : { data: doc, error: null }
      return { data: null, error: null }
    },
  }
  const storage = { createSignedUrl: async (p, secs, opts) => { calls.sign.push([p, secs, opts]); return signError ? { data: null, error: {} } : { data: { signedUrl: `https://storage.invalid/sign/${p}?token=T` }, error: null } } }
  return { supabase, storage, calls }
}
const quiet = { error() {} }

async function main() {
  await check('file route: off, malformed, unknown and not-public all get the same 404 and sign nothing', async () => {
    const seen = new Set()
    for (const [env, pid, doc] of [[{}, PID, { storage_path: 'dissemination/x/y.pdf', format: 'pdf' }], [ON, '../../etc', null], [ON, 'ABCDEFGHJKMN', null], [ON, PID, null]]) {
      const f = fake({ doc })
      const r = await P.handlePublicFile({ publicId: pid, mode: 'read', env, clientKey: '1.2.3.4', log: quiet, ...f })
      seen.add(JSON.stringify(r)); assert.strictEqual(f.calls.sign.length, 0)
    }
    assert.strictEqual(seen.size, 1); assert.match([...seen][0], /"status":404/)
  })
  await check('file route: the path comes only from the database, the link lasts 60 s, nothing is cached, and a database failure is not a 404', async () => {
    const f = fake({ doc: { storage_path: 'dissemination/p/v.pdf', format: 'pdf', title: 'A: Study / 2020' } })
    let r = await P.handlePublicFile({ publicId: PID, mode: 'read', env: ON, clientKey: 'c', log: quiet, ...f })
    assert.strictEqual(r.status, 303)
    assert.deepStrictEqual(f.calls.sign[0], ['dissemination/p/v.pdf', 60, {}])
    assert.match(r.headers['Cache-Control'], /no-store/); assert.strictEqual(r.headers['Referrer-Policy'], 'no-referrer')
    r = await P.handlePublicFile({ publicId: PID, mode: 'download', env: ON, clientKey: 'c', log: quiet, ...f })
    assert.deepStrictEqual(f.calls.sign[1][2], { download: 'A Study 2020.pdf' })
    const e = fake({ docError: true })
    assert.strictEqual((await P.handlePublicFile({ publicId: PID, env: ON, clientKey: 'c', log: quiet, ...e })).status, 503)
    const s = fake({ doc: { storage_path: 'dissemination/p/v.pdf', format: 'pdf' }, signError: true })
    assert.strictEqual((await P.handlePublicFile({ publicId: PID, env: ON, clientKey: 'c', log: quiet, ...s })).status, 503)
  })
  await check('file route: a Word file is always a download, never an in-browser "read"', async () => {
    const f = fake({ doc: { storage_path: 'dissemination/p/v.docx', format: 'docx', title: 'T' } })
    await P.handlePublicFile({ publicId: PID, mode: 'read', env: ON, clientKey: 'c', log: quiet, ...f })
    assert.deepStrictEqual(f.calls.sign[0][2], { download: 'T.docx' })
  })
  await check('file route: limited per client by a keyed hash, checked before any lookup', async () => {
    const f = fake({ limited: true, doc: { storage_path: 'x.pdf', format: 'pdf' } })
    const r = await P.handlePublicFile({ publicId: PID, env: ON, clientKey: '203.0.113.9', log: quiet, ...f })
    assert.strictEqual(r.status, 429)
    assert.deepStrictEqual(f.calls.rpc.map((c) => c[0]), ['consume_submission_rate_limit'])
    const key = f.calls.rpc[0][1].p_key
    assert.match(key, /^public_file:[0-9a-f]{32}$/); assert.ok(!key.includes('203.0.113.9'))
  })
  await check('permanent links come only from PUBLIC_SITE_ORIGIN, never a request host; invalid origins are ignored', async () => {
    assert.strictEqual(P.siteOrigin({}), null)
    assert.strictEqual(P.siteOrigin({ PUBLIC_SITE_ORIGIN: 'https://research.example.org' }), 'https://research.example.org')
    assert.strictEqual(P.siteOrigin({ PUBLIC_SITE_ORIGIN: 'https://research.example.org/' }), 'https://research.example.org')
    for (const bad of ['http://research.example.org', 'https://x.org/path', 'https://u:p@x.org', 'javascript:alert(1)', 'not a url', 'https://x.org?a=1']) assert.strictEqual(P.siteOrigin({ PUBLIC_SITE_ORIGIN: bad }), null, bad)
    assert.strictEqual(P.siteOrigin({ PUBLIC_SITE_ORIGIN: 'http://127.0.0.1:3100' }), 'http://127.0.0.1:3100', 'local testing only')
    const src = ['app/research/page.jsx', 'app/research/[publicId]/page.jsx', 'app/sitemap.js', 'app/robots.js', 'lib/public/server.js'].map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n')
    assert.ok(!/headers\(\)|x-forwarded-host|request\.headers\.get\(['"]host/i.test(src), 'no request host is used')
  })
  await check('URL filters: only well-formed values pass; the rest are dropped', async () => {
    assert.deepStrictEqual(P.parseFilters({ q: '  water   quality ', year: '2019', type: 'thesis', page: '2', degree: 'MSc', unit: 'E1B2C3D4-0000-4000-8000-000000000000' }),
      { q: 'water quality', year: 2019, type: 'thesis', page: 2, degree: 'MSc', unit: 'e1b2c3d4-0000-4000-8000-000000000000' })
    assert.deepStrictEqual(P.parseFilters({ year: '19', type: 'poem', page: '-1', unit: "1' or 1=1", evil: 'x' }), {})
    assert.strictEqual(P.parseFilters({ q: 'x'.repeat(500) }).q.length, 200)
  })
  await check('admin: a public link only for an administrator, only while the site is on and the record is public', async () => {
    const run = async (env, detail, link = 'abcdefghjkmn') => {
      const supabase = {
        auth: { getUser: async () => ({ data: { user: { id: '00000000-0000-4000-8000-000000000001' } }, error: null }) },
        rpc: async (name) => ({ data: name === 'admin_public_link' ? { public_id: link } : detail, error: null }),
      }
      return (await handleAdmin({ method: 'GET', segments: ['reviews', '00000000-0000-4000-8000-000000000002'], token: 'a-sufficiently-long-test-token', supabase, env: { ADMIN_REVIEW: 'enabled', ...env }, log: quiet })).body
    }
    const pub = { viewer_role: 'administrator', eligibility: { record_public: true } }
    assert.strictEqual((await run({ PUBLIC_RESEARCH: 'enabled', PUBLIC_SITE_ORIGIN: 'https://r.example.org' }, pub)).public_url, 'https://r.example.org/research/abcdefghjkmn')
    assert.strictEqual((await run({ PUBLIC_RESEARCH: 'enabled' }, pub)).public_url, '/research/abcdefghjkmn')
    const off = await run({}, pub)
    assert.deepStrictEqual([off.public_url, off.public_site_enabled], [null, false])
    assert.strictEqual((await run({ PUBLIC_RESEARCH: 'enabled' }, { ...pub, eligibility: { record_public: false } })).public_url, null)
    assert.strictEqual((await run({ PUBLIC_RESEARCH: 'enabled' }, { ...pub, viewer_role: 'volunteer' })).public_url, null)
  })
  await check('public pages: dynamic (no page cache), private areas kept out of robots, no copy or print blocking', async () => {
    const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8')
    for (const f of ['app/research/page.jsx', 'app/research/[publicId]/page.jsx', 'app/research/[publicId]/file/route.js', 'app/sitemap.js', 'app/api/research/route.js', 'app/api/research/[publicId]/route.js']) assert.match(read(f), /dynamic = 'force-dynamic'/, f)
    const robots = read('app/robots.js')
    for (const p of ["'/confirm/'", "'/admin'", "'/api/'"]) assert.ok(robots.includes(p), p)
    const ui = read('components/research/RecordView.jsx') + read('components/research/Catalogue.jsx') + read('components/research/research.module.css')
    assert.ok(!/user-select|oncopy|contextmenu|@media print/i.test(ui))
    assert.ok(!/confirm\/|token|email|whatsapp|facebook/i.test(read('components/research/RecordView.jsx').replace(/CONTACT_EMAIL/g, '')))
  })
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll checks passed.')
  process.exit(failed ? 1 : 0)
}
main()
