#!/usr/bin/env node
// Release verification H12 (docs/release-runbook.md §6), hosted, MOCK
// PROVIDER: Gemini by default on the document itself (agreement version 4,
// free tier), manual choice, scans, and no thank-you before Confirm, against
// an ISOLATED preview + test project. Proves our code paths only; it says
// nothing about how the real Gemini behaves (that is R1).
//
// Needs (as scripts/hosted-verify-submission.js):
//   HV_DEPLOYMENT  the exact preview deployment URL (https://…vercel.app)
//   HV_BYPASS_FILE file holding a Vercel automation-bypass secret
//   HV_SUPABASE_URL / HV_ANON_KEY  the TEST project (never production)
//   HV_STATE       file to write paper tokens (kept private, mode 600)
// Prints statuses and booleans only: never a token, signed URL or key.
// Synthetic documents (scripts/fixtures/synthetic/, invented people) only.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const { createClient } = require('@supabase/supabase-js')

const D = process.env.HV_DEPLOYMENT
const BYPASS = fs.readFileSync(process.env.HV_BYPASS_FILE, 'utf8').trim()
const SB = process.env.HV_SUPABASE_URL
const ANON = process.env.HV_ANON_KEY
const STATE = process.env.HV_STATE
const PROD_REF = 'mzpkiuovjppmavqkppem'
if (!/^https:\/\/[a-z0-9-]+\.vercel\.app$/.test(D || '')) throw new Error('HV_DEPLOYMENT must be a vercel.app deployment URL')
if (!SB || SB.includes(PROD_REF)) throw new Error('HV_SUPABASE_URL must be the test project')
const FIX = path.join(__dirname, 'fixtures', 'synthetic')
const RUN = Date.now().toString(36)
const state = { run: RUN, papers: {} }
let failed = 0
let passed = 0
const scrub = (m) => String(m).split(BYPASS).join('<bypass>').replace(/[0-9a-f]{64}/g, '<token>')
async function check(name, fn) {
  try { const note = await fn(); passed++; console.log(`PASS  ${name}${note ? ` — ${note}` : ''}`) } catch (e) { failed++; console.log(`FAIL  ${name} — ${scrub(e.message)}`) }
}
const H = { 'x-vercel-protection-bypass': BYPASS }
const api = async (p, body) => {
  const r = await fetch(`${D}${p}`, body === undefined ? { headers: H } : { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  let j = null; try { j = await r.json() } catch {}
  return { status: r.status, body: j }
}
const anon = createClient(SB, ANON, { auth: { persistSession: false } })
const TYPES = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }

// terms -> intent (with the researcher's choice) -> signed upload -> finalize
async function submit(label, bytes, ext, choice) {
  const terms = await api('/api/submissions/terms')
  assert.strictEqual(terms.status, 200, `terms ${terms.status}`)
  assert.strictEqual(terms.body.offer.decision, 'automatic', 'automatic reading offered')
  assert.strictEqual(terms.body.processing.terms, 'gemini_api_unpaid', 'the free-tier arrangement')
  const ag = terms.body.agreements.find((a) => a.language === 'en')
  assert.strictEqual(ag.versionLabel, 'Version 4')
  const it = await api('/api/submissions/intent', {
    offerToken: terms.body.offer.token, agreementId: ag.id, accepted: true, publicationSetting: 'record_abstract', claimedRole: 'author',
    processingChoice: choice, fullName: 'Amna Osman Elhassan', email: `h12-${label}-${RUN}@example.test`,
    file: { name: `${label}.${ext}`, size: bytes.length, type: TYPES[ext] },
  })
  assert.strictEqual(it.status, 201, `intent ${it.status} ${it.body?.reason || ''}`)
  const up = await anon.storage.from('papers').uploadToSignedUrl(it.body.upload.path, it.body.upload.token, bytes, { contentType: TYPES[ext] })
  assert.ok(!up.error, `upload: ${up.error?.message}`)
  const fin = await api('/api/submissions/finalize', { intentId: it.body.intentId, intentToken: it.body.intentToken })
  assert.strictEqual(fin.status, 200, `finalize ${fin.status}`)
  state.papers[label] = fin.body.confirmationToken
  return { it: it.body, fin: fin.body }
}
const read = async (token) => {
  const r = await anon.rpc('get_paper_for_confirmation', { p_token: token })
  assert.ok(!r.error, r.error?.message)
  return r.data
}

async function main() {
  await check('H12 automatic, text PDF: read, review offered with authors and supervisor', async () => {
    const { fin } = await submit('pdf', fs.readFileSync(path.join(FIX, 'thesis-en.pdf')), 'pdf', 'automatic')
    assert.strictEqual(fin.processing.decision, 'automatic'); assert.strictEqual(fin.extraction.mayStart, true)
    const x = await api('/api/extract', { token: state.papers.pdf })
    assert.strictEqual(x.status, 200, `extract ${x.status} ${x.body?.reason || ''}`)
    assert.strictEqual(x.body.status, 'completed')
    const v = await read(state.papers.pdf)
    assert.strictEqual(v.extraction_detail.researchers.status, 'found', 'authors are read')
    return `completed in ${x.body.passesRun} pass(es); researchers found; supervisor ${v.extraction_detail.supervisor_name?.status}`
  })

  await check('H12 automatic, Word file: read', async () => {
    await submit('docx', fs.readFileSync(path.join(FIX, 'thesis-en.docx')), 'docx', 'automatic')
    const x = await api('/api/extract', { token: state.papers.docx })
    assert.strictEqual(x.status, 200, `extract ${x.status}`)
    assert.strictEqual(x.body.status, 'completed')
    return `completed in ${x.body.passesRun} pass(es)`
  })

  await check('H12 manual chosen: recorded with the paper; the extraction route sends nothing', async () => {
    const { fin } = await submit('manual', fs.readFileSync(path.join(FIX, 'thesis-en.pdf')), 'pdf', 'manual')
    assert.strictEqual(fin.extraction.mayStart, false)
    const x = await api('/api/extract', { token: state.papers.manual })
    assert.strictEqual(x.status, 200); assert.strictEqual(x.body.alreadyHandled, true)
    const v = await read(state.papers.manual)
    assert.strictEqual(v.manual_entry_source, 'researcher'); assert.strictEqual(v.automatic_processing, false)
    return 'manual_entry_source=researcher, automatic_processing=false, extract alreadyHandled'
  })

  await check('H12 scanned PDF: read like any other PDF', async () => {
    await submit('scan', fs.readFileSync(path.join(FIX, 'scanned-cover.pdf')), 'pdf', 'automatic')
    const x = await api('/api/extract', { token: state.papers.scan })
    assert.strictEqual(x.status, 200, `extract ${x.status}`); assert.strictEqual(x.body.status, 'completed')
    return 'completed'
  })

  await check('H12 browser: submit -> progress -> review -> Confirm -> thank-you, never a thank-you earlier', async () => {
    const { chromium } = require('playwright')
    const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined
    const args = process.env.HV_PROXY_CA_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.HV_PROXY_CA_SPKI}`] : []
    const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy, args })
    try {
      const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage()
      const nav = await page.goto(`${D}/submit?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=true`)
      assert.strictEqual(nav.status(), 200, `submit page ${nav.status()}`)
      await page.waitForSelector('form input[type=checkbox]', { timeout: 30000 })
      assert.ok(await page.getByText('free tier').first().isVisible(), 'free-tier explanation shown')
      await page.getByLabel('Full name', { exact: true }).fill('Amna Osman Elhassan')
      await page.getByLabel('Email', { exact: true }).fill(`h12-browser-${RUN}@example.test`)
      await page.locator('input[name=role][value=author]').check()
      await page.setInputFiles('input[type=file]', path.join(FIX, 'thesis-en.pdf'))
      assert.strictEqual(await page.locator('input[name=processing][value=automatic]').isChecked(), true, 'Gemini is preselected')
      const box = page.locator('form input[type=checkbox]').last()
      assert.strictEqual(await box.isChecked(), false, 'acceptance starts unchecked')
      await box.check()
      const seen = []
      const t0 = Date.now()
      let stop = false
      const sampler = (async () => {
        while (!stop) {
          const text = await page.evaluate(() => document.body.innerText).catch(() => '')
          seen.push({ t: Date.now() - t0, thanks: /thank you/i.test(text), review: /Here’s what we found|Confirm these details/.test(text) })
          await new Promise((r) => setTimeout(r, 50))
        }
      })()
      await page.getByRole('button', { name: 'Accept and submit' }).click()
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      await page.getByRole('heading', { name: 'Here’s what we found' }).waitFor({ timeout: 60000 })
      const beforeConfirm = seen.filter((s) => s.thanks)
      await page.getByRole('button', { name: 'Confirm these details' }).click()
      await page.getByRole('heading', { name: 'Thank you for confirming' }).waitFor({ timeout: 30000 })
      stop = true; await sampler
      assert.strictEqual(beforeConfirm.length, 0, `a thank-you was visible before Confirm at ${beforeConfirm[0]?.t} ms`)
      return `${seen.length} samples over ${seen.at(-1)?.t} ms; no thank-you before Confirm; thank-you after Confirm`
    } finally { await browser.close() }
  })

  fs.writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 })
  console.log(`\n${passed} passed, ${failed} failed; deployment ${D}`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('ERROR', scrub(e.message)); process.exit(2) })
