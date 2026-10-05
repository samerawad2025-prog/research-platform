#!/usr/bin/env node
// Release verification, hosted (H2, H3, H4, H5-after-cutover, H6): the
// signed-submission flow against an ISOLATED preview + test project.
//
// Run only after scripts/check-isolation.js --live has passed for the
// preview's credentials. Needs:
//   HV_DEPLOYMENT  the exact preview deployment URL (https://…vercel.app)
//   HV_BYPASS_FILE file holding a Vercel automation-bypass secret
//   HV_SUPABASE_URL / HV_ANON_KEY  the TEST project (never production)
//   HV_STATE       file to write intent/paper ids (kept private, mode 600)
// Prints statuses and booleans only: never a token, signed URL or key.
// Synthetic PDFs and example.test addresses only.

const assert = require('node:assert')
const fs = require('node:fs')
const { createClient } = require('@supabase/supabase-js')
const { PDFDocument } = require('pdf-lib')

const D = process.env.HV_DEPLOYMENT
const BYPASS = fs.readFileSync(process.env.HV_BYPASS_FILE, 'utf8').trim()
const SB = process.env.HV_SUPABASE_URL
const ANON = process.env.HV_ANON_KEY
const STATE = process.env.HV_STATE
const PROD_REF = 'mzpkiuovjppmavqkppem'
if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(D || '')) throw new Error('HV_DEPLOYMENT must be a vercel.app deployment URL')
if (!SB || SB.includes(PROD_REF)) throw new Error('HV_SUPABASE_URL must be the test project')
const RUN = Date.now().toString(36)
const state = { run: RUN }
const results = []
let failed = 0
async function check(name, fn) {
  try { const note = await fn(); results.push(['PASS', name, note || '']); console.log(`PASS  ${name}${note ? ` — ${note}` : ''}`) } catch (e) { failed++; results.push(['FAIL', name, scrub(e.message)]); console.log(`FAIL  ${name} — ${scrub(e.message)}`) }
}
const H = { 'x-vercel-protection-bypass': BYPASS }
const scrub = (m) => String(m).split(BYPASS).join('<bypass>').replace(/token=[^&\s"]+/g, 'token=<redacted>')
const api = async (path, body) => {
  const r = await fetch(`${D}${path}`, body === undefined ? { headers: H } : { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j }
}
async function pdf(text) { const d = await PDFDocument.create(); d.addPage().drawText(text, { x: 50, y: 700 }); return Buffer.from(await d.save()) }
const jwtExp = (t) => { try { return JSON.parse(Buffer.from(t.split('.')[1], 'base64url')).exp } catch { return null } }

async function intent(setting, role, bytes, name) {
  const terms = await api('/api/submissions/terms')
  assert.strictEqual(terms.status, 200, `terms ${terms.status}`)
  const ag = terms.body.agreements.find((a) => a.language === 'en')
  const body = { offerToken: terms.body.offer.token, agreementId: ag.id, accepted: true, publicationSetting: setting, claimedRole: role,
    fullName: `Synthetic Tester ${RUN}`, email: `${name}-${RUN}@example.test`, file: { name: `${name}.pdf`, size: bytes.length, type: 'application/pdf' } }
  const r = await api('/api/submissions/intent', body)
  assert.strictEqual(r.status, 201, `intent ${r.status} ${r.body?.reason || r.body?.error || ''}`)
  return r.body
}

async function main() {
  const anon = createClient(SB, ANON, { auth: { persistSession: false } })

  // ---- H3 + H2 (browser): a real cross-origin upload from the preview origin
  await check('H3 browser: terms → intent → upload to Storage from the preview origin → finalize', async () => {
    const { chromium } = require('playwright')
    const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined
    // Behind an intercepting egress proxy, trust exactly that proxy's CA key
    // (HV_PROXY_CA_SPKI); certificate verification stays on for everything else.
    const args = process.env.HV_PROXY_CA_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.HV_PROXY_CA_SPKI}`] : []
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy, args })
    try {
      const page = await (await browser.newContext()).newPage()
      // Vercel's documented way to give a browser the bypass: a cookie set once.
      const nav = await page.goto(`${D}/submit?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=true`)
      assert.strictEqual(nav.status(), 200, `submit page ${nav.status()}`)
      const bytes = [...(await pdf(`synthetic browser upload ${RUN}`))]
      const out = await page.evaluate(async ({ bytes, RUN }) => {
        const j = async (r) => ({ status: r.status, body: await r.json().catch(() => null) })
        const terms = await j(await fetch('/api/submissions/terms'))
        const ag = terms.body.agreements.find((a) => a.language === 'en')
        const blob = new Blob([new Uint8Array(bytes)], { type: 'application/pdf' })
        const it = await j(await fetch('/api/submissions/intent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
          offerToken: terms.body.offer.token, agreementId: ag.id, accepted: true, publicationSetting: 'record_abstract_fulltext', claimedRole: 'author',
          fullName: `Synthetic Browser ${RUN}`, email: `browser-${RUN}@example.test`, file: { name: 'browser.pdf', size: blob.size, type: 'application/pdf' } }) }))
        if (it.status !== 201) return { stage: 'intent', status: it.status }
        let up
        try { up = await fetch(it.body.upload.signedUrl, { method: 'PUT', headers: { 'Content-Type': 'application/pdf', 'x-upsert': 'false' }, body: blob }) } catch (e) { return { stage: 'upload', error: String(e) } }
        const fin = await j(await fetch('/api/submissions/finalize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intentId: it.body.intentId, intentToken: it.body.intentToken }) }))
        return { stage: 'done', uploadStatus: up.status, finalize: fin.status, decision: fin.body?.processing?.decision, mayStart: fin.body?.extraction?.mayStart,
          intentId: it.body.intentId, intentToken: it.body.intentToken, conf: fin.body?.confirmationToken, path: it.body.upload.path }
      }, { bytes, RUN })
      assert.strictEqual(out.stage, 'done', JSON.stringify(out))
      assert.strictEqual(out.uploadStatus, 200, `browser upload ${out.uploadStatus}`)
      assert.strictEqual(out.finalize, 200, `finalize ${out.finalize}`)
      assert.strictEqual(out.decision, 'manual'); assert.strictEqual(out.mayStart, false)
      state.browser = { intentId: out.intentId, intentToken: out.intentToken, conf: out.conf, path: out.path, setting: 'record_abstract_fulltext' }
      return 'upload 200 from the browser (CORS allowed), finalize 200, decision manual, extraction may not start'
    } finally { await browser.close() }
  })

  // ---- H2: path binding, overwrite refusal, authorization lifetime
  const bytes = await pdf(`synthetic api upload ${RUN}`)
  const it = await intent('record_abstract', 'coauthor', bytes, 'api')
  state.api = { intentId: it.intentId, intentToken: it.intentToken, path: it.upload.path, setting: 'record_abstract' }
  await check('H2 upload authorization is bound to its one path', async () => {
    const other = it.upload.path.replace(/[^/]+$/, 'another-name.pdf')
    const r = await anon.storage.from('papers').uploadToSignedUrl(other, it.upload.token, bytes, { contentType: 'application/pdf' })
    assert.ok(r.error, 'upload to another path was accepted')
    const r2 = await anon.storage.from('papers').upload(`intents/free-${RUN}.pdf`, bytes, { contentType: 'application/pdf' })
    assert.ok(r2.error, 'anonymous direct upload was accepted')
    return `other path refused (${r.error.statusCode || r.error.message}); direct anonymous upload refused (${r2.error.statusCode || r2.error.message})`
  })
  await check('H4 finalize before the upload exists is refused, then recovers', async () => {
    const f = await api('/api/submissions/finalize', { intentId: it.intentId, intentToken: it.intentToken })
    assert.notStrictEqual(f.status, 200, 'finalized with no file')
    return `refused ${f.status} ${f.body?.reason || ''}`
  })
  await check('H2 upload to the issued path succeeds', async () => {
    const r = await anon.storage.from('papers').uploadToSignedUrl(it.upload.path, it.upload.token, bytes, { contentType: 'application/pdf' })
    assert.ok(!r.error, r.error?.message)
  })
  await check('H2 overwrite through the same authorization is refused (even asking for upsert)', async () => {
    const other = await pdf(`replacement ${RUN}`)
    const r = await anon.storage.from('papers').uploadToSignedUrl(it.upload.path, it.upload.token, other, { contentType: 'application/pdf', upsert: true })
    assert.ok(r.error, 'overwrite accepted')
    return `refused (${r.error.statusCode || r.error.message})`
  })
  await check('H2 upload authorization lifetime as issued by hosted Storage', async () => {
    const exp = jwtExp(it.upload.token)
    assert.ok(exp, 'no exp claim in the upload token')
    const mins = Math.round((exp * 1000 - Date.now()) / 60000)
    state.api.uploadExpiresAt = new Date(exp * 1000).toISOString()
    return `expires in about ${mins} minutes (${state.api.uploadExpiresAt})`
  })
  await check('H4 wrong intent token is refused', async () => {
    const f = await api('/api/submissions/finalize', { intentId: it.intentId, intentToken: 'x'.repeat(it.intentToken.length) })
    assert.notStrictEqual(f.status, 200)
    return `refused ${f.status}`
  })
  await check('H4 concurrent finalize creates one paper and returns the same token', async () => {
    const [a, b] = await Promise.all([1, 2].map(() => api('/api/submissions/finalize', { intentId: it.intentId, intentToken: it.intentToken })))
    assert.strictEqual(a.status, 200); assert.strictEqual(b.status, 200)
    assert.strictEqual(a.body.confirmationToken, b.body.confirmationToken, 'different tokens')
    const c = await api('/api/submissions/finalize', { intentId: it.intentId, intentToken: it.intentToken })
    assert.strictEqual(c.status, 200); assert.strictEqual(c.body.alreadyFinalized, true); assert.strictEqual(c.body.confirmationToken, a.body.confirmationToken)
    state.api.conf = a.body.confirmationToken
    assert.strictEqual(a.body.processing.decision, 'manual'); assert.strictEqual(a.body.extraction.mayStart, false)
    return 'same token on all three calls; retry reports alreadyFinalized; decision manual'
  })
  await check('H6 manual mode: the extraction route records manual entry and calls no provider', async () => {
    const r = await api('/api/extract', { token: state.api.conf })
    // Documented M1 behaviour: 200 with mode 'manual', the decision recorded; no
    // provider call. The absence of ai_generations rows is checked in the database.
    assert.strictEqual(r.status, 200, `status ${r.status}`)
    assert.strictEqual(r.body?.mode, 'manual', JSON.stringify(r.body))
    assert.strictEqual(r.body?.recorded, true)
    return `200 mode=manual recorded=true manualEntry=${r.body.manualEntry}`
  })
  await check('H5 after cutover: the anonymous legacy RPC is refused', async () => {
    const r = await anon.rpc('submit_paper', { p_full_name: 'x', p_email: 'x@example.test', p_file_path: 'x.pdf', p_permission_to_process: true, p_publication_scope: ['abstract_and_citation'] })
    assert.ok(r.error, 'legacy RPC accepted')
    return `refused (${r.error.code})`
  })

  fs.writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 })
  console.log(`\n${results.length - failed} passed, ${failed} failed; deployment ${D}`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('ERROR', scrub(e.message)); process.exit(2) })
