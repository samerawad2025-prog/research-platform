#!/usr/bin/env node
//
// Phase 3 M5 on the LOCAL Supabase stack: the built application with the
// public site on, real Storage (private bucket, signed links), real GoTrue
// for the administrator who approves, and Chromium for the pages. Synthetic
// data only; the full-text legal restriction is lifted ONLY inside this
// disposable local database, for the full-text checks, and restored after.
// Run by supabase/tests/run-public-e2e.sh. Screenshots: $E2E_SHOTS.

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const { PDFDocument } = require('pdf-lib')

const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:3100'
const SB = 'http://127.0.0.1:54321'
const SB_DIR = process.env.SB_DIR || '/var/tmp/sb'
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/public-shots'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(APP)) throw new Error('local application only')
const keys = JSON.parse(fs.readFileSync(path.join(SB_DIR, 'keys.json'), 'utf8'))
fs.mkdirSync(SHOTS, { recursive: true })
const svc = createClient(SB, keys.service, { auth: { persistSession: false } })
const anon = createClient(SB, keys.anon, { auth: { persistSession: false } })

function sql(text) {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=localtestpw', 'sb-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim()
}
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok     ${name}`) } catch (err) { console.error(`FAIL   ${name} — ${err.stack || err.message}`); failed++ }
}

const RUN = crypto.randomBytes(3).toString('hex')
let ADMIN
async function api(method, p, body) {
  const res = await fetch(`${APP}/api/admin/${p}`, { method, headers: { Authorization: `Bearer ${ADMIN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: res.status, body: await res.json().catch(() => null) }
}
const get = (p, init) => fetch(`${APP}${p}`, { redirect: 'manual', ...init })

async function pdfBytes(text) {
  const d = await PDFDocument.create()
  d.addPage().drawText(text, { x: 50, y: 700 })
  return Buffer.from(await d.save())
}
const papers = {}
async function seed(key, o = {}) {
  const id = crypto.randomUUID(); const rid = crypto.randomUUID(); const rid2 = crypto.randomUUID()
  const bytes = await pdfBytes(`synthetic ${key} ${RUN}`)
  const file = `legacy-${RUN}-${key}.pdf`
  const up = await svc.storage.from('papers').upload(file, bytes, { contentType: 'application/pdf', upsert: false })
  assert.ok(!up.error, up.error?.message)
  sql(`insert into researchers (id, full_name, email, whatsapp_number, linkedin_url, linkedin_public, facebook_url) values
         (${lit(rid)}, ${lit(o.author || 'Samira Idris')}, ${lit(`${key}${RUN}@example.invalid`)}, '+249911111111', 'https://www.linkedin.com/in/samira-example', true, 'https://facebook.com/private-${key}'),
         (${lit(rid2)}, 'Khalid Osman', ${lit(`k${key}${RUN}@example.invalid`)}, '+249922222222', 'https://www.linkedin.com/in/khalid-hidden', false, null);
       insert into papers (id, file_path, permission_to_process, publication_scope, submitted_by, extraction_status, metadata_confirmed_at,
                           title, title_ar, abstract, abstract_ar, year, university, faculty, degree_type, supervisor_name, document_type, confirmation_token_hash)
       values (${lit(id)}, ${lit(file)}, true, ${lit(o.scope || '{abstract_and_citation}')}, ${lit(rid)}, 'completed', now(),
               ${lit(o.title)}, ${o.title_ar ? lit(o.title_ar) : 'null'}, ${lit(o.abstract || 'A synthetic abstract for local testing of the public research pages.')},
               ${o.abstract_ar ? lit(o.abstract_ar) : 'null'}, ${o.year || 2021}, 'University of Khartoum', ${lit(o.faculty || 'Faculty of Science')}, ${lit(o.degree || 'MSc')},
               'Dr Synthetic Supervisor', 'thesis', encode(sha256(${lit(`token-${key}-${RUN}`)}::bytea), 'hex'));
       insert into paper_researchers (paper_id, researcher_id, author_order) values (${lit(id)}, ${lit(rid)}, 1), (${lit(id)}, ${lit(rid2)}, 2);`)
  papers[key] = { id, file, bytes, token: `token-${key}-${RUN}` }
  return id
}
async function approve(key, setting = 'record_abstract', dissemination) {
  const id = papers[key].id
  assert.strictEqual((await api('POST', `reviews/${id}/legacy-setting`, { setting, note: 'Old form covered this.' })).status, 200)
  const d = (await api('GET', `reviews/${id}`)).body
  const r = await api('POST', `reviews/${id}/decision`, { decision: 'approved', reason: 'ok', expectedRevision: d.revision, ...(dissemination ? { disseminationVersionId: dissemination } : {}) })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
  papers[key].pid = sql(`select public_id from public_records where paper_id = ${lit(id)}`)
}
async function decide(key, decision, reason) {
  const d = (await api('GET', `reviews/${papers[key].id}`)).body
  const r = await api('POST', `reviews/${papers[key].id}/decision`, { decision, reason, expectedRevision: d.revision })
  assert.strictEqual(r.status, 200, JSON.stringify(r.body))
}
const PRIVATE = (key) => [papers[key]?.id, papers[key]?.file, papers[key]?.token, '@example.invalid', '+2499', 'facebook', 'khalid-hidden', 'storage_path', 'dissemination/', 'Old form covered', 'Author asked'].filter(Boolean)
function noLeak(text, key) { for (const s of PRIVATE(key)) assert.ok(!text.includes(s), `leak: ${s}`) }

async function main() {
  const email = `admin-${RUN}@example.invalid`
  const { data: u, error } = await svc.auth.admin.createUser({ email, password: 'Correct-horse-9', email_confirm: true })
  assert.ok(!error, error?.message)
  sql(`update staff_members set active = false; select bootstrap_first_administrator(${lit(u.user.id)})`)
  ADMIN = (await anon.auth.signInWithPassword({ email, password: 'Correct-horse-9' })).data.session.access_token

  await seed('ok', { title: `Groundwater Salinity in Gezira ${RUN}`, title_ar: `ملوحة المياه الجوفية في الجزيرة ${RUN}`, abstract_ar: 'دراسة تركيبية عن ملوحة المياه الجوفية وأثرها على الزراعة.' })
  await approve('ok')
  await seed('ft', { title: `Nile Sediment Transport ${RUN}`, scope: '{full_paper}', year: 2023, degree: 'PhD' })
  const des = await api('POST', `reviews/${papers.ft.id}/documents`, { origin: 'original_reviewed' })
  assert.strictEqual(des.status, 201, JSON.stringify(des.body))
  await approve('ft', 'record_abstract_fulltext', des.body.versionId)
  papers.ft.version = des.body.versionId
  await seed('wd', { title: `Withdrawn Record ${RUN}` }); await approve('wd'); await decide('wd', 'withdrawn', 'Author asked to withdraw.')
  await seed('pend', { title: `Pending Record ${RUN}` })
  await seed('susp', { title: `Suspended Record ${RUN}` }); await approve('susp')
  assert.strictEqual((await api('POST', `reviews/${papers.susp.id}/issues`, { kind: 'privacy', description: 'Signature visible.', blocking: true })).status, 201)
  await seed('emb', { title: `Embargoed Record ${RUN}` }); await approve('emb')
  assert.strictEqual((await api('POST', `reviews/${papers.emb.id}/embargo`, { until: '2999-01-01', note: 'Patent.' })).status, 200)
  for (let i = 0; i < 23; i++) { await seed(`p${i}`, { title: `Paging Record ${String(i).padStart(2, '0')} ${RUN}`, year: 2000 + (i % 4), degree: i % 2 ? 'PhD' : 'MSc' }); await approve(`p${i}`) }
  const hidden = ['wd', 'pend', 'susp', 'emb']

  await check('record page: public fields, authors in order, LinkedIn only where chosen, rights, canonical from the configured origin', async () => {
    const res = await get(`/research/${papers.ok.pid}`)
    assert.strictEqual(res.status, 200)
    assert.match(res.headers.get('cache-control') || '', /no-store/, 'no page cache that could outlive a withdrawal')
    const html = await res.text()
    assert.ok(html.includes(`Groundwater Salinity in Gezira ${RUN}`) && html.includes('ملوحة المياه الجوفية'))
    assert.ok(html.indexOf('Samira Idris') < html.indexOf('Khalid Osman'))
    assert.ok(html.includes('https://www.linkedin.com/in/samira-example'))
    assert.ok(html.includes(`<link rel="canonical" href="http://127.0.0.1:3100/research/${papers.ok.pid}"`))
    assert.match(html, /<meta property="og:title" content="Groundwater Salinity/)
    assert.ok(html.includes('Copyright remains with its owners') && html.includes('not peer review'))
    noLeak(html, 'ok')
    assert.ok(!html.includes('/file?'), 'no read or download action for a record-and-abstract work')
  })

  await check('every hidden state: page, JSON, search, sitemap and file are the same neutral not-found, with no reason', async () => {
    const unknown = await (await get('/research/abcdefghjkmn')).text()
    const sitemap = await (await get('/sitemap.xml')).text()
    const catalogue = await (await get(`/api/research?q=${RUN}`)).json()
    for (const k of hidden) {
      const pid = papers[k].pid
      if (pid) {
        const r = await get(`/research/${pid}`)
        assert.strictEqual(r.status, 404, k)
        const body = await r.text()
        assert.ok(!body.includes(RUN) && !body.includes('Author asked'), `${k}: title or reason shown`)
        assert.ok(body.includes('not available'), k)
        assert.strictEqual((await get(`/api/research/${pid}`)).status, 404)
        assert.strictEqual((await get(`/research/${pid}/file?mode=download`)).status, 404)
        assert.ok(!sitemap.includes(pid), k)
      }
      assert.ok(!catalogue.items.some((i) => i.title.includes(k === 'wd' ? 'Withdrawn' : k === 'pend' ? 'Pending' : k === 'susp' ? 'Suspended' : 'Embargoed')), k)
    }
    assert.ok(unknown.includes('not available'))
    assert.ok(sitemap.includes(papers.ok.pid) && sitemap.includes('http://127.0.0.1:3100/research'))
    assert.strictEqual(catalogue.total, 25, 'only the public records of this run are counted')
    noLeak(JSON.stringify(catalogue), 'ok')
  })

  await check('robots keeps private areas out; the private confirmation link is never linked from public pages', async () => {
    const robots = await (await get('/robots.txt')).text()
    for (const p of ['Disallow: /confirm/', 'Disallow: /admin', 'Disallow: /api/', 'Sitemap: http://127.0.0.1:3100/sitemap.xml']) assert.ok(robots.includes(p), p)
    const html = await (await get(`/research?q=${RUN}`)).text()
    assert.ok(!html.includes('/confirm/'))
  })

  await check('full text: refused while the legal restriction is active (the default)', async () => {
    assert.strictEqual(sql(`select active from release_restrictions where key = 'fulltext_legal_advice'`), 't')
    const html = await (await get(`/research/${papers.ft.pid}`)).text()
    assert.ok(!html.includes('/file?') && html.includes('The full document is not available here'))
    assert.strictEqual((await get(`/research/${papers.ft.pid}/file?mode=read`)).status, 404)
  })

  let issuedLink
  await check('full text (restriction lifted in this synthetic database only): the approved copy, via a 60-second link; ranges stay behind the same check', async () => {
    sql(`update release_restrictions set active = false, changed_by = 'synthetic e2e only', note = 'local test' where key = 'fulltext_legal_advice'`)
    const html = await (await get(`/research/${papers.ft.pid}`)).text()
    assert.ok(html.includes(`/research/${papers.ft.pid}/file?mode=read`) && html.includes(`/research/${papers.ft.pid}/file?mode=download`))
    const r = await get(`/research/${papers.ft.pid}/file?mode=read`, { headers: { Range: 'bytes=0-10' } })
    assert.strictEqual(r.status, 303, 'a Range header does not skip the check')
    assert.match(r.headers.get('cache-control'), /no-store/)
    issuedLink = r.headers.get('location')
    const path1 = sql(`select storage_path from document_versions where id = ${lit(papers.ft.version)}`)
    assert.ok(issuedLink.includes(encodeURI(path1).replace(/%2F/g, '/')) || issuedLink.includes(path1), 'the approved dissemination copy')
    assert.ok(!issuedLink.includes(papers.ft.file), 'never the submitted original')
    const exp = JSON.parse(Buffer.from(new URL(issuedLink).searchParams.get('token').split('.')[1], 'base64url').toString())
    assert.ok(exp.exp - exp.iat <= 60, `link lifetime ${exp.exp - exp.iat}s`)
    const bytes = Buffer.from(await (await fetch(issuedLink)).arrayBuffer())
    assert.ok(bytes.equals(papers.ft.bytes), 'the reviewed original, copied unchanged')
    const part = await fetch(issuedLink, { headers: { Range: 'bytes=0-4' } })
    assert.strictEqual(Buffer.from(await part.arrayBuffer()).toString(), '%PDF-')
    const dl = await get(`/research/${papers.ft.pid}/file?mode=download`)
    assert.strictEqual(new URL(dl.headers.get('location')).searchParams.get('download'), `Nile Sediment Transport ${RUN}.pdf`)
  })

  await check('the bucket stays private: originals and copies are not reachable without the server', async () => {
    for (const p of [papers.ft.file, sql(`select storage_path from document_versions where id = ${lit(papers.ft.version)}`)]) {
      const pub = await fetch(`${SB}/storage/v1/object/public/papers/${p}`)
      assert.ok(pub.status >= 400, `public URL for ${p}: ${pub.status}`)
      const dl = await anon.storage.from('papers').download(p)
      assert.ok(dl.error, `anon download of ${p}`)
      const signed = await anon.storage.from('papers').createSignedUrl(p, 60)
      assert.ok(signed.error, `anon signing of ${p}`)
    }
    // No route takes a path from the visitor.
    assert.strictEqual((await get(`/research/${papers.ft.pid}/file?path=${encodeURIComponent(papers.ft.file)}`)).status, 303)
    assert.strictEqual((await get(`/research/../api/admin/queue`)).status >= 400, true)
  })

  await check('withdrawal: page, file and sitemap stop at once; a link issued before it still works immediately afterwards (expiry is checked below)', async () => {
    await decide('ft', 'withdrawn', 'Author asked to withdraw the full text.')
    assert.strictEqual((await get(`/research/${papers.ft.pid}`)).status, 404)
    assert.strictEqual((await get(`/research/${papers.ft.pid}/file?mode=read`)).status, 404)
    assert.ok(!(await (await get('/sitemap.xml')).text()).includes(papers.ft.pid))
    // Honest: a link handed out before the withdrawal keeps working until it expires.
    assert.strictEqual((await fetch(issuedLink)).status, 200, 'documented exposure window')
    sql(`update release_restrictions set active = true, changed_by = 'synthetic e2e restore', note = 'restored' where key = 'fulltext_legal_advice'`)
  })

  await check('admin: a public link appears only for a public record', async () => {
    assert.strictEqual((await api('GET', `reviews/${papers.ok.id}`)).body.public_url, `http://127.0.0.1:3100/research/${papers.ok.pid}`)
    for (const k of hidden) assert.strictEqual((await api('GET', `reviews/${papers[k].id}`)).body.public_url, null, k)
  })


  // ------------------------------------------------------------- M6: citations and activity
  const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
  const count = (key, ev) => Number(sql(`select coalesce((select count from activity_counts where paper_id = ${lit(papers[key].id)} and event = ${lit(ev)}), 0)`))
  const post = (pid, event, headers = {}) => fetch(`${APP}/api/research/${pid}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA, ...headers }, body: JSON.stringify({ event }) })

  await check('cite: RIS and BibTeX from confirmed metadata with the permanent URL; each served file counts once per day', async () => {
    const before = count('ok', 'citation_export')
    const ris = await get(`/research/${papers.ok.pid}/cite?format=ris`, { headers: { 'User-Agent': UA } })
    assert.strictEqual(ris.status, 200); assert.match(ris.headers.get('content-type'), /research-info-systems/)
    assert.match(ris.headers.get('content-disposition'), new RegExp(`attachment; filename="sarp-${papers.ok.pid}.ris"`))
    const text = await ris.text()
    assert.ok(text.startsWith('TY  - THES\r\n') && text.includes('AU  - Samira Idris\r\nAU  - Khalid Osman\r\n'))
    assert.ok(text.includes(`UR  - http://127.0.0.1:3100/research/${papers.ok.pid}`) && text.includes('TT  - ملوحة المياه الجوفية'))
    noLeak(text, 'ok')
    const bib = await (await get(`/research/${papers.ok.pid}/cite?format=bibtex`, { headers: { 'User-Agent': UA } })).text()
    assert.match(bib, /^@mastersthesis\{sarp-/); assert.ok(bib.includes('author = {{Samira Idris} and {Khalid Osman}}'))
    assert.strictEqual(count('ok', 'citation_export'), before + 1, 'RIS then BibTeX from the same client on the same day: one citation export')
    await get(`/research/${papers.ok.pid}/cite?format=ris`, { headers: { 'User-Agent': UA } })
    assert.strictEqual(count('ok', 'citation_export'), before + 1, 'a repeat is not counted')
  })

  await check('not counted: HEAD, declared bots, link previews, prefetch, and staff (server-signed cookie)', async () => {
    const pid = papers.p1.pid
    const before = [count('p1', 'citation_export'), count('p1', 'page_view')]
    assert.strictEqual((await fetch(`${APP}/research/${pid}/cite?format=ris`, { method: 'HEAD', headers: { 'User-Agent': UA } })).status, 200)
    for (const ua of ['Googlebot/2.1 (+http://www.google.com/bot.html)', 'facebookexternalhit/1.1', 'WhatsApp/2.23.20.0', 'curl/8.4.0']) {
      await get(`/research/${pid}/cite?format=ris`, { headers: { 'User-Agent': ua } })
      assert.strictEqual((await (await post(pid, 'page_view', { 'User-Agent': ua })).json()).recorded, false, ua)
    }
    await get(`/research/${pid}/cite?format=ris`, { headers: { 'User-Agent': UA, 'Sec-Purpose': 'prefetch' } })
    // A staff member: the admin API sets a cookie this server signed.
    const ex = await fetch(`${APP}/api/admin/metrics-exclusion`, { method: 'POST', headers: { Authorization: `Bearer ${ADMIN}`, 'Content-Type': 'application/json' }, body: '{}' })
    const cookie = (ex.headers.get('set-cookie') || '').split(';')[0]
    assert.match(cookie, /^sarp_staff_nocount=\d+\./); assert.match(ex.headers.get('set-cookie'), /HttpOnly/)
    assert.strictEqual((await (await post(pid, 'page_view', { Cookie: cookie })).json()).recorded, false)
    await get(`/research/${pid}/cite?format=bibtex`, { headers: { 'User-Agent': UA, Cookie: cookie } })
    // A forged cookie is not staff.
    assert.strictEqual((await (await post(pid, 'page_view', { Cookie: 'sarp_staff_nocount=9999999999.YWRtaW4.' + '0'.repeat(64) })).json()).recorded, true)
    assert.deepStrictEqual([count('p1', 'citation_export'), count('p1', 'page_view')], [before[0], before[1] + 1])
    // Nobody but staff can get the cookie.
    assert.strictEqual((await fetch(`${APP}/api/admin/metrics-exclusion`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 401)
  })

  await check('the event endpoint takes a name only: counts, roles and unknown events are refused, cross-site posts too', async () => {
    const pid = papers.p2.pid
    for (const body of ['{"event":"page_view","count":1000}', '{"event":"download"}', '{"event":"page_view","role":"administrator"}', 'not json']) {
      const r = await fetch(`${APP}/api/research/${pid}/events`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': UA }, body })
      assert.strictEqual(r.status, 400, body)
    }
    assert.strictEqual((await post(pid, 'page_view', { 'Sec-Fetch-Site': 'cross-site' })).status, 403)
    assert.strictEqual(count('p2', 'page_view'), 0)
  })

  await check('eligibility changes between showing the page and the request: no citation, no event, no counts', async () => {
    await seed('late', { title: `Late Withdrawal ${RUN}` }); await approve('late')
    const html = await (await get(`/research/${papers.late.pid}`)).text()
    assert.ok(html.includes('Cite this research') && html.includes('Activity on this platform'))
    await decide('late', 'withdrawn', 'Author asked.')
    assert.strictEqual((await get(`/research/${papers.late.pid}/cite?format=ris`, { headers: { 'User-Agent': UA } })).status, 404)
    assert.strictEqual((await post(papers.late.pid, 'citation_copy')).status, 404)
    assert.strictEqual((await post(papers.late.pid, 'page_view')).status, 404)
    await seed('late2', { title: `Late Suspension ${RUN}` }); await approve('late2')
    assert.strictEqual((await (await post(papers.late2.pid, 'page_view')).json()).recorded, true)
    assert.strictEqual((await api('POST', `reviews/${papers.late2.id}/issues`, { kind: 'rights', description: 'x', blocking: true })).status, 201)
    for (const i of (await api('GET', `reviews/${papers.late2.id}`)).body.issues.filter((x) => x.state === 'open')) await api('POST', `reviews/${papers.late2.id}/issues/${i.id}/resolve`, { resolution: 'fixed' })
    for (const p of [`/research/${papers.late2.pid}`, `/research/${papers.late2.pid}/cite?format=bibtex`]) assert.strictEqual((await get(p)).status, 404, p)
    assert.strictEqual((await post(papers.late2.pid, 'page_view')).status, 404)
    assert.strictEqual(count('late2', 'page_view'), 1, 'kept privately')
  })

  await check('a collection failure never blocks reading, citing or the document, and is never shown as a count', async () => {
    sql(`revoke execute on function public_record_event(text, text, text) from service_role`)
    try {
      const before = count('p3', 'citation_export')
      const r = await get(`/research/${papers.p3.pid}/cite?format=ris`, { headers: { 'User-Agent': UA } })
      assert.strictEqual(r.status, 200); assert.match(await r.text(), /^TY {2}- THES/)
      assert.deepStrictEqual(await (await post(papers.p3.pid, 'page_view')).json(), { recorded: false })
      assert.strictEqual((await get(`/research/${papers.p3.pid}`)).status, 200)
      assert.strictEqual(count('p3', 'citation_export'), before)
    } finally {
      sql(`grant execute on function public_record_event(text, text, text) to service_role`)
    }
    sql(`revoke execute on function public_activity(text) from service_role`)
    try {
      const html = await (await get(`/research/${papers.p3.pid}`)).text()
      assert.ok(html.includes('Activity counts are not available right now') && html.includes('Cite this research'))
      assert.ok(!/Page views/.test(html), 'no invented zeros')
    } finally {
      sql(`grant execute on function public_activity(text) to service_role`)
    }
  })

  await check('activity section: separate counts, no document counts for a metadata-only record, no counts for hidden records', async () => {
    const html = await (await get(`/research/${papers.ok.pid}`)).text()
    for (const label of ['Page views', 'Citation exports', 'not citations and not a count of individual readers']) assert.ok(html.includes(label), label)
    assert.ok(!html.includes('Download requests') && !html.includes('Requests to read the document online'), 'metadata-only: no document counts')
    for (const k of hidden) if (papers[k].pid) assert.ok(!(await (await get(`/research/${papers[k].pid}`)).text()).includes('Page views'), k)
  })

  // ------------------------------------------------------------- browser
  const browser = await chromium.launch()
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  async function open(width, lang) {
    const ctx = await browser.newContext({ viewport: { width, height: 900 }, locale: lang === 'ar' ? 'ar' : 'en-GB' })
    await ctx.addCookies([{ name: 'sarp_lang', value: lang, url: APP }])
    return { ctx, page: await ctx.newPage() }
  }

  await check('catalogue: search by keyboard, URL state, pagination, filters and empty results', async () => {
    const { ctx, page } = await open(1280, 'en')
    await page.goto(`${APP}/research`)
    await page.keyboard.press('Tab') // skip link
    await page.locator('input[name=q]').focus()
    await page.keyboard.type(`Paging ${RUN}`)
    await page.keyboard.press('Enter')
    await page.waitForURL(/q=Paging/)
    assert.match(await page.locator('main').innerText(), /23 records for/)
    assert.strictEqual(await page.locator('main li h2 a').count(), 20)
    await page.locator('a[rel=next]').click()
    await page.waitForURL(/page=2/)
    assert.strictEqual(await page.locator('main li h2 a').count(), 3)
    await page.locator('select[name=degree]').selectOption('PhD')
    await page.locator('select[name=year]').selectOption('2001')
    await page.locator('button', { hasText: 'Apply' }).click()
    await page.waitForURL(/degree=PhD/)
    const url = new URL(page.url())
    assert.strictEqual(url.searchParams.get('year'), '2001'); assert.strictEqual(url.searchParams.get('page'), null, 'a new filter starts at page 1')
    const n = await page.locator('main li h2 a').count()
    assert.ok(n > 0 && n < 23)
    await page.goto(`${APP}/research?q=${RUN}-nothing-matches`)
    assert.match(await page.locator('main').innerText(), /Nothing matches yet/)
    await page.screenshot({ path: path.join(SHOTS, 'catalogue-empty-1280-en.png') })
    await ctx.close()
  })

  await check('Arabic search and RTL pages; widths 320 to 1440 without horizontal scroll', async () => {
    for (const lang of ['en', 'ar']) {
      for (const w of [320, 390, 768, 1280, 1440]) {
        const { ctx, page } = await open(w, lang)
        await page.goto(`${APP}/research?q=${encodeURIComponent(lang === 'ar' ? 'الجوفيه' : 'groundwater')}`)
        assert.strictEqual(await page.locator('html').getAttribute('dir'), lang === 'ar' ? 'rtl' : 'ltr')
        assert.ok((await page.locator('main li h2 a').count()) >= 1, `${lang} search found nothing`)
        assert.ok((await overflow(page)) <= 0, `catalogue overflow ${w} ${lang}`)
        if ([320, 1280].includes(w)) await page.screenshot({ path: path.join(SHOTS, `catalogue-${w}-${lang}.png`), fullPage: true })
        await page.goto(`${APP}/research/${papers.ok.pid}`)
        assert.ok((await overflow(page)) <= 0, `record overflow ${w} ${lang}`)
        if ([320, 1280].includes(w)) await page.screenshot({ path: path.join(SHOTS, `record-${w}-${lang}.png`), fullPage: true })
        await ctx.close()
      }
    }
  })

  await check('record page reads in the chosen language without inventing text', async () => {
    const { ctx, page } = await open(1280, 'ar')
    await page.goto(`${APP}/research/${papers.p0.pid}`)
    const text = await page.locator('main').innerText()
    assert.ok(text.includes(`Paging Record 00 ${RUN}`), 'English title shown as it is')
    assert.ok(!/الملخص \(بالعربية\)/.test(text), 'no empty Arabic abstract section')
    await ctx.close()
  })

  await check('browser: page view only after the page stays visible, not from an automated browser; copy success counts, failure does not', async () => {
    const human = async (init) => {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, userAgent: UA, permissions: ['clipboard-read', 'clipboard-write'] })
      await ctx.addInitScript(() => Object.defineProperty(Navigator.prototype, 'webdriver', { get: () => false }))
      if (init) await ctx.addInitScript(init)
      return { ctx, page: await ctx.newPage() }
    }
    // Automated (the default for this test browser): nothing is sent.
    const auto = await open(1280, 'en')
    await auto.page.goto(`${APP}/research/${papers.p5.pid}`); await auto.page.waitForTimeout(3000)
    assert.strictEqual(count('p5', 'page_view'), 0, 'navigator.webdriver: not counted')
    await auto.ctx.close()
    // A person: counted once, after 2 seconds; a reload the same day is not.
    let h = await human()
    await h.page.goto(`${APP}/research/${papers.p5.pid}`)
    await h.page.waitForTimeout(800)
    assert.strictEqual(count('p5', 'page_view'), 0, 'not before 2 seconds')
    await h.page.waitForTimeout(2200)
    assert.strictEqual(count('p5', 'page_view'), 1)
    await h.page.reload(); await h.page.waitForTimeout(3000)
    assert.strictEqual(count('p5', 'page_view'), 1, 'a reload is not another view')
    // Keyboard: open the citation panel, copy.
    const before = count('p5', 'citation_export')
    await h.page.locator('summary', { hasText: 'Cite this research' }).focus()
    await h.page.keyboard.press('Enter')
    assert.strictEqual(count('p5', 'citation_export'), before, 'opening the panel is not an export')
    await h.page.locator('button', { hasText: 'Copy citation' }).focus()
    await h.page.keyboard.press('Enter')
    await h.page.locator('[role=status]', { hasText: 'Copied.' }).waitFor()
    assert.ok((await h.page.evaluate(() => navigator.clipboard.readText())).includes(`Paging Record 05 ${RUN}`))
    await h.page.waitForTimeout(500)
    assert.strictEqual(count('p5', 'citation_export'), before + 1)
    await h.page.screenshot({ path: path.join(SHOTS, 'record-cite-1280-en.png'), fullPage: true })
    await h.ctx.close()
    // A copy that fails says so and counts nothing.
    h = await human(() => { Object.defineProperty(navigator, 'clipboard', { get: () => ({ writeText: () => Promise.reject(new Error('denied')) }) }) })
    await h.page.goto(`${APP}/research/${papers.p6.pid}`)
    await h.page.locator('summary', { hasText: 'Cite this research' }).click()
    await h.page.locator('button', { hasText: 'Copy citation' }).click()
    await h.page.locator('[role=status]', { hasText: 'Copying did not work' }).waitFor()
    await h.page.waitForTimeout(500)
    assert.strictEqual(count('p6', 'citation_export'), 0)
    await h.ctx.close()
  })

  await check('browser: citation and activity in Arabic and on phones, secondary to the research, no horizontal scroll', async () => {
    for (const [w, lang] of [[320, 'ar'], [390, 'en'], [768, 'ar'], [1440, 'en']]) {
      const { ctx, page } = await open(w, lang)
      await page.goto(`${APP}/research/${papers.ok.pid}`)
      await page.locator('summary').first().click()
      assert.ok((await overflow(page)) <= 0, `${w} ${lang}`)
      const text = await page.locator('main').innerText()
      assert.ok(text.includes(lang === 'ar' ? 'الاستشهاد بهذا البحث' : 'Cite this research'))
      assert.ok(text.includes(lang === 'ar' ? 'النشاط على هذه المنصة' : 'Activity on this platform'))
      const order = await page.evaluate(() => { const h = document.querySelector('h1').getBoundingClientRect().top; const c = document.querySelector('details').getBoundingClientRect().top; return c > h })
      assert.ok(order, 'the research comes first')
      await page.screenshot({ path: path.join(SHOTS, `record-m6-${w}-${lang}.png`), fullPage: true })
      await ctx.close()
    }
  })
  await browser.close()

  // M5 follow-up: the link issued before the withdrawal really expires.
  await check('signed link expiry (local Storage): after its expiry time a fresh request with the old link is refused', async () => {
    const token = new URL(issuedLink).searchParams.get('token')
    const { exp } = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString())
    const wait = exp * 1000 - Date.now() + 3000 // 3 s clock tolerance
    if (wait > 0) await new Promise((r) => setTimeout(r, wait))
    const r = await fetch(issuedLink, { headers: { 'Cache-Control': 'no-cache' } })
    assert.ok(r.status >= 400 && r.status < 500, `expected a refusal, got ${r.status}`)
    const body = Buffer.from(await r.arrayBuffer())
    assert.ok(!body.equals(papers.ft.bytes) && !body.subarray(0, 5).toString().startsWith('%PDF'), 'no document bytes after expiry')
  })
}

main().then(() => { console.log(failed ? `\n${failed} FAILED` : '\nall public e2e checks passed'); process.exit(failed ? 1 : 0) }, (e) => { console.error(e); process.exit(1) })
