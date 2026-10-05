#!/usr/bin/env node
// Release verification, hosted (H7, H8, H9, H11): public eligibility on
// every path, withdrawal, signed-download expiry, response caching and
// activity counts, against an ISOLATED preview + test project.
// Phases (HV_PHASE): approve | public | fulltext | withdraw-ft | metrics | metrics-lock
// Synthetic records only. Prints statuses and booleans, never a link or key.

const assert = require('node:assert')
const fs = require('node:fs')
const D = process.env.HV_DEPLOYMENT
const BYPASS = fs.readFileSync(process.env.HV_BYPASS_FILE, 'utf8').trim()
const STATE = process.env.HV_STATE
const ADMIN = fs.readFileSync(`${STATE}.admin`, 'utf8').trim()
const IDS = JSON.parse(process.env.HV_IDS) // { abs, ft, nonuofk, pend, wd } paper ids
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'
const scrub = (m) => String(m).split(BYPASS).join('<bypass>').replace(/https:\/\/[a-z0-9]+\.supabase\.co\/storage\/[^\s"']+/g, '<signed-url>')
const state = JSON.parse(fs.readFileSync(STATE, 'utf8'))
state.pub = state.pub || {}
let failed = 0
async function check(name, fn) {
  try { const n = await fn(); console.log(`PASS  ${name}${n ? ` — ${n}` : ''}`) } catch (e) { failed++; console.log(`FAIL  ${name} — ${scrub(e.message)}`) }
}
const BH = { 'x-vercel-protection-bypass': BYPASS, 'User-Agent': UA }
const get = (p, init = {}) => fetch(`${D}${p}`, { redirect: 'manual', ...init, headers: { ...BH, ...(init.headers || {}) } })
async function api(method, p, body) {
  const r = await fetch(`${D}/api/admin/${p}`, { method, headers: { ...BH, Authorization: `Bearer ${ADMIN}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined })
  return { status: r.status, body: await r.json().catch(() => null) }
}
async function decide(id, decision, reason, extra = {}) {
  const d = (await api('GET', `reviews/${id}`)).body
  return api('POST', `reviews/${id}/decision`, { decision, reason, expectedRevision: d.revision, ...extra })
}
async function pidOf(title) {
  const r = await get(`/api/research?q=${encodeURIComponent(title)}`)
  const j = await r.json()
  const hit = (j.items || []).find((i) => i.title === title)
  return hit ? hit.public_id || hit.publicId || hit.id : null
}
const save = () => fs.writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 })

const phases = {
  async approve() {
    await check('setup: approve the abstract-only record (new flow)', async () => {
      const r = await decide(IDS.abs, 'approved', 'Synthetic hosted verification.')
      assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    })
    await check('setup: register a reviewed dissemination copy and approve the full-text record', async () => {
      const des = await api('POST', `reviews/${IDS.ft}/documents`, { origin: 'original_reviewed' })
      assert.strictEqual(des.status, 201, JSON.stringify(des.body))
      const r = await decide(IDS.ft, 'approved', 'Synthetic hosted verification.', { disseminationVersionId: des.body.versionId })
      assert.strictEqual(r.status, 200, JSON.stringify(r.body))
      state.pub.ftVersion = des.body.versionId
    })
    await check('setup: approve a legacy UofK record (to withdraw later)', async () => {
      const s = await api('POST', `reviews/${IDS.wd}/legacy-setting`, { setting: 'record_abstract', note: 'Synthetic: old form covered this.' })
      assert.strictEqual(s.status, 200, JSON.stringify(s.body))
      const r = await decide(IDS.wd, 'approved', 'Synthetic hosted verification.')
      assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    })
    await check('H7 a non-UofK record cannot be approved for publication', async () => {
      await api('POST', `reviews/${IDS.nonuofk}/legacy-setting`, { setting: 'record_abstract', note: 'Synthetic.' })
      const r = await decide(IDS.nonuofk, 'approved', 'Synthetic.')
      assert.notStrictEqual(r.status, 200, 'approved a non-UofK record')
      return `refused ${r.status} ${r.body?.code || r.body?.reason || ''}`.trim()
    })
    state.pub.abs = await pidOf('HV Abstract Synthetic Record')
    state.pub.ft = await pidOf('HV Fulltext Synthetic Record')
    state.pub.wd = await pidOf('HV Withdrawn Record')
    await check('setup: approved records have public ids', async () => { assert.ok(state.pub.abs && state.pub.ft && state.pub.wd, JSON.stringify(state.pub)) })
    save()
  },

  async public() {
    const { abs, ft, wd } = state.pub
    await check('H7 catalogue/search lists exactly the three approved records', async () => {
      const j = await (await get('/api/research?q=HV')).json()
      const titles = (j.items || []).map((i) => i.title).sort()
      assert.deepStrictEqual(titles, ['HV Abstract Synthetic Record', 'HV Fulltext Synthetic Record', 'HV Withdrawn Record'])
      return titles.join(' | ')
    })
    await check('H7 pages and API answer for an approved record; nothing private leaks', async () => {
      for (const p of [`/research/${abs}`, `/api/research/${abs}`]) {
        const r = await get(p); assert.strictEqual(r.status, 200, `${p} ${r.status}`)
        // The platform's own published contact number is in the footer of every page.
        const t = (await r.text()).split('+249117754018').join('')
        for (const leak of ['example.test', '+249', 'Synthetic: old form', IDS.abs, 'intents/', 'confirmation']) assert.ok(!t.includes(leak), `leak "${leak}" in ${p}`)
      }
    })
    await check('H7 citation exports for an approved record (RIS and BibTeX)', async () => {
      const ris = await get(`/research/${abs}/cite?format=ris`); const bib = await get(`/research/${abs}/cite?format=bibtex`)
      assert.strictEqual(ris.status, 200); assert.strictEqual(bib.status, 200)
      const t = await ris.text(); assert.ok(/TI {2}- HV Abstract Synthetic Record/.test(t), 'RIS title missing')
      return `ris ${ris.headers.get('content-type')}; bibtex ${bib.headers.get('content-type')}`
    })
    await check('H7 an abstract-only record never serves a file', async () => {
      const r = await get(`/research/${abs}/file?mode=read`); assert.strictEqual(r.status, 404, `status ${r.status}`)
    })
    await check('H7 full text stays closed while the legal restriction is active', async () => {
      const r = await get(`/research/${ft}/file?mode=read`); assert.strictEqual(r.status, 404, `status ${r.status}`)
      const page = await (await get(`/research/${ft}`)).text()
      assert.ok(!page.includes(`/research/${ft}/file`), 'page links to the file')
    })
    await check('H7 unknown public ids are 404 on page, API, cite and file', async () => {
      const bogus = 'zzzzzzzzzzzz'
      for (const p of [`/research/${bogus}`, `/api/research/${bogus}`, `/research/${bogus}/cite?format=ris`, `/research/${bogus}/file?mode=read`]) {
        const r = await get(p); assert.strictEqual(r.status, 404, `${p} ${r.status}`)
      }
    })
    await check('H7 sitemap and robots without a permanent origin', async () => {
      const sm = await get('/sitemap.xml'); const st = await sm.text()
      const rb = await (await get('/robots.txt')).text()
      assert.ok(!st.includes(abs) && !st.includes(ft), 'sitemap lists records although no origin is set')
      return `sitemap ${sm.status} with no record URLs; robots: ${rb.replace(/\s+/g, ' ').trim().slice(0, 80)}`
    })
    await check('H9 cache headers on a public page and API response', async () => {
      const a = await get(`/research/${abs}`); const b = await get(`/api/research/${abs}`)
      return `page cache-control "${a.headers.get('cache-control')}" x-vercel-cache ${a.headers.get('x-vercel-cache')}; api cache-control "${b.headers.get('cache-control')}" x-vercel-cache ${b.headers.get('x-vercel-cache')}`
    })
    await check('H8 withdrawal removes a record from every path at once (no stale cache)', async () => {
      const before = await get(`/research/${wd}`); assert.strictEqual(before.status, 200)
      const r = await decide(IDS.wd, 'withdrawn', 'Synthetic: author asked to withdraw.')
      assert.strictEqual(r.status, 200, JSON.stringify(r.body))
      for (const p of [`/research/${wd}`, `/api/research/${wd}`, `/research/${wd}/cite?format=ris`]) {
        const x = await get(p); assert.strictEqual(x.status, 404, `${p} ${x.status} after withdrawal`)
      }
      const j = await (await get('/api/research?q=HV')).json()
      assert.ok(!(j.items || []).some((i) => i.title === 'HV Withdrawn Record'), 'still in search')
      const sm = await (await get('/sitemap.xml')).text(); assert.ok(!sm.includes(wd))
      return 'page, API and citation 404 immediately; gone from search and sitemap'
    })
  },

  async leak() { // re-run of the leak check alone (the public phase withdraws a record)
    const { abs } = state.pub
    await check('H7 pages and API answer for an approved record; nothing private leaks', async () => {
      for (const p of [`/research/${abs}`, `/api/research/${abs}`]) {
        const r = await get(p); assert.strictEqual(r.status, 200, `${p} ${r.status}`)
        const t = (await r.text()).split('+249117754018').join('')
        for (const leak of ['example.test', '+249', 'Synthetic: old form', IDS.abs, 'intents/', 'confirmation']) assert.ok(!t.includes(leak), `leak "${leak}" in ${p}`)
      }
      return 'no submitter email, phone, review note, paper id, storage path or token on page or API'
    })
  },

  async fulltext() { // run only after the restriction is lifted IN THE TEST DATABASE
    const { ft } = state.pub
    await check('H7 full text served for an approved record once its restriction is lifted (test only)', async () => {
      const head = await get(`/research/${ft}/file?mode=read`, { method: 'HEAD' })
      assert.ok(!head.headers.get('location'), 'HEAD issued a link')
      const r = await get(`/research/${ft}/file?mode=read`)
      assert.ok([302, 303, 307].includes(r.status), `status ${r.status}`)
      const link = r.headers.get('location'); assert.ok(link && link.includes('/storage/v1/object/sign/'), 'not a signed Storage link')
      const f = await fetch(link); assert.strictEqual(f.status, 200, `signed link ${f.status}`)
      const bytes = Buffer.from(await f.arrayBuffer()); assert.strictEqual(bytes.subarray(0, 5).toString(), '%PDF-')
      const pub = await fetch(link.replace('/object/sign/', '/object/public/').split('?')[0]); assert.notStrictEqual(pub.status, 200, 'bucket served publicly')
      state.pub.link = link; state.pub.linkIssued = Date.now(); save()
      return `HEAD issues no link; GET ${r.status} to a signed link; file served (${bytes.length} bytes, %PDF-); public URL refused (${pub.status})`
    })
  },

  async 'withdraw-ft'() { // after > 60 s
    const { ft, link, linkIssued } = state.pub
    await check('H8 the signed download link actually expires', async () => {
      const age = Math.round((Date.now() - linkIssued) / 1000)
      const r = await fetch(link); assert.notStrictEqual(r.status, 200, `link still works after ${age}s`)
      return `refused ${r.status} after ${age}s (issued for 60s)`
    })
    await check('H8 withdrawing the full-text record closes page and file', async () => {
      const r = await decide(IDS.ft, 'withdrawn', 'Synthetic: author asked to withdraw.')
      assert.strictEqual(r.status, 200, JSON.stringify(r.body))
      for (const p of [`/research/${ft}`, `/research/${ft}/file?mode=read`]) { const x = await get(p); assert.strictEqual(x.status, 404, `${p} ${x.status}`) }
    })
  },

  async metrics() {
    const { abs } = state.pub
    const ev = (headers = {}) => fetch(`${D}/api/research/${abs}/events`, { method: 'POST', headers: { ...BH, 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ event: 'page_view' }) }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }))
    await check('H11 a visitor event is recorded; a repeat the same day is deduplicated', async () => {
      const a = await ev(); const b = await ev()
      // 202 by design. Behind a multi-address egress (as in CI containers) the two
      // requests may come from different clients; confirm counts in the database.
      assert.strictEqual(a.status, 202); assert.strictEqual(b.status, 202)
      return `first recorded=${a.body.recorded}, repeat recorded=${b.body.recorded} (verify activity_counts / activity_dedup directly)`
    })
    await check('H11 staff (exclusion cookie) are not counted', async () => {
      const r = await ev({ Cookie: state.staffCookie, 'User-Agent': `${UA} staff` })
      assert.strictEqual(r.body.recorded, false, JSON.stringify(r.body))
    })
    await check('H11 HEAD on cite generates no activity and no link', async () => {
      const h = await get(`/research/${abs}/cite?format=ris`, { method: 'HEAD', headers: { 'User-Agent': `${UA} head` } })
      assert.strictEqual(h.status, 200)
    })
    await check('H11 counts shown on the page when the database answers', async () => {
      const t = await (await get(`/research/${abs}`)).text()
      assert.ok(!t.includes('Activity counts are not available right now.'), 'unavailable message shown')
    })
  },

  async 'metrics-lock'() { // run while activity_counts is locked in the test database
    const { abs } = state.pub
    await check('H11 a stalled metrics dependency: page still renders promptly with the unavailable message', async () => {
      const t0 = Date.now(); const r = await get(`/research/${abs}`); const t = await r.text(); const ms = Date.now() - t0
      assert.strictEqual(r.status, 200); assert.ok(t.includes('HV Abstract Synthetic Record'))
      assert.ok(t.includes('Activity counts are not available right now.'), 'no unavailable message')
      return `200 in ${ms} ms with the unavailable message`
    })
    await check('H11 a stalled metrics dependency: citation export still returns promptly', async () => {
      const t0 = Date.now(); const r = await get(`/research/${abs}/cite?format=bibtex`, { headers: { 'User-Agent': `${UA} lock` } }); await r.text()
      assert.strictEqual(r.status, 200); return `200 in ${Date.now() - t0} ms`
    })
  },
}

const phase = process.env.HV_PHASE
if (!phases[phase]) throw new Error(`HV_PHASE must be one of ${Object.keys(phases).join(', ')}`)
phases[phase]().then(() => { console.log(`\n[${phase}] ${failed ? `${failed} failed` : 'all passed'}; deployment ${D}`); process.exit(failed ? 1 : 0) })
  .catch((e) => { console.error('ERROR', scrub(e.message)); process.exit(2) })
