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

  await check('withdrawal: page, file and sitemap stop at once; an already issued link lasts at most its 60 seconds', async () => {
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
  await browser.close()
}

main().then(() => { console.log(failed ? `\n${failed} FAILED` : '\nall public e2e checks passed'); process.exit(failed ? 1 : 0) }, (e) => { console.error(e); process.exit(1) })
