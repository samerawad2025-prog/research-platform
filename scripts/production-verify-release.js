#!/usr/bin/env node
// Release session verification (docs/release-runbook.md §4, stages B + D,
// steps 4–5; and stage E's "a signed submission still completes"), through
// the real browser UI of a deployed site.
//
// Creates REAL records when pointed at production. Every one is clearly
// marked as synthetic: submitter "Synthetic Release Check", an
// @example.invalid email, a file named SYNTHETIC-…, and a line stamped on
// page 1 of the document ("SYNTHETIC TEST DOCUMENT …"). The documents are the
// repository's synthetic fixtures (scripts/fixtures/synthetic/, invented
// people); the stamp is added in memory, nothing is written to disk.
//
// Env:
//   PV_ORIGIN       https://… (the production origin, or a preview URL)
//   PV_BYPASS_FILE  optional: Vercel automation-bypass secret (previews only)
//   PV_ONLY         optional: comma list of checks to run
//                   (config, auto, manual, scan); default: all
//   PV_STATE        file to write paper tokens to (mode 600; never printed)
//   HV_PROXY_CA_SPKI optional, for the agent proxy (as hosted-verify-h12.js)
// Prints statuses and booleans only: never a token, link or key.

const assert = require('node:assert')
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { PDFDocument, StandardFonts, rgb } = require('pdf-lib')
const { findAgreement } = require('../lib/submission/agreements')

const O = (process.env.PV_ORIGIN || '').replace(/\/$/, '')
if (!/^https:\/\/[a-z0-9.-]+$/.test(O)) throw new Error('PV_ORIGIN must be an https origin')
const BYPASS = process.env.PV_BYPASS_FILE ? fs.readFileSync(process.env.PV_BYPASS_FILE, 'utf8').trim() : ''
const ONLY = new Set((process.env.PV_ONLY || 'config,auto,manual,scan').split(',').map((s) => s.trim()).filter(Boolean))
const STATE = process.env.PV_STATE
const FIX = path.join(__dirname, 'fixtures', 'synthetic')
const RUN = `${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(3).toString('hex')}`
const NAME = 'Synthetic Release Check'
const state = { run: RUN, papers: {} }
let passed = 0
let failed = 0
const scrub = (m) => String(m).replace(/[0-9a-f]{64}/g, '<token>').split(BYPASS || '\u0000').join('<bypass>')
async function check(name, key, fn) {
  if (!ONLY.has(key)) return
  try { const note = await fn(); passed++; console.log(`PASS  ${name}${note ? ` — ${note}` : ''}`) } catch (e) { failed++; console.log(`FAIL  ${name} — ${scrub(e.message)}`) }
}
const H = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : {}

async function stamped(file) {
  const doc = await PDFDocument.load(fs.readFileSync(path.join(FIX, file)))
  const page = doc.getPage(0)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  page.drawText(`SYNTHETIC TEST DOCUMENT - release check ${RUN} - invented people, not real research`, { x: 24, y: 12, size: 7, font, color: rgb(0.4, 0.4, 0.4) })
  return Buffer.from(await doc.save())
}

let browser
async function newPage() {
  if (!browser) {
    const { chromium } = require('playwright')
    const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined
    const args = process.env.HV_PROXY_CA_SPKI ? [`--ignore-certificate-errors-spki-list=${process.env.HV_PROXY_CA_SPKI}`] : []
    browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', proxy, args })
  }
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'en-GB' })).newPage()
  if (BYPASS) await page.goto(`${O}/?x-vercel-protection-bypass=${BYPASS}&x-vercel-set-bypass-cookie=true`)
  return page
}

// Fills the acceptance form; the document is stamped and renamed SYNTHETIC-….
async function fillForm(page, { tag, file, choice }) {
  const nav = await page.goto(`${O}/submit`)
  assert.strictEqual(nav.status(), 200, `submit page ${nav.status()}`)
  await page.waitForSelector('form input[type=checkbox]', { timeout: 30000 })
  await page.getByLabel('Full name', { exact: true }).fill(NAME)
  await page.getByLabel('Email', { exact: true }).fill(`release-check-${tag}-${RUN}@example.invalid`)
  await page.getByLabel('I am the author').check()
  await page.setInputFiles('input[type=file]', { name: `SYNTHETIC-release-check-${file}`, mimeType: 'application/pdf', buffer: await stamped(file) })
  assert.strictEqual(await page.getByLabel('Read my document with Gemini (recommended)').isChecked(), true, 'Gemini preselected')
  if (choice === 'manual') await page.getByLabel('Enter details manually').check()
  const box = page.locator('form input[type=checkbox]').last()
  assert.strictEqual(await box.isChecked(), false, 'acceptance starts unchecked')
  await box.check()
}

// Samples the page text while the flow runs: a thank-you must never appear
// before Confirm is pressed.
function sampler(page) {
  const seen = []
  const t0 = Date.now()
  let stop = false
  const done = (async () => {
    while (!stop) {
      const text = await page.evaluate(() => document.body.innerText).catch(() => '')
      seen.push({ t: Date.now() - t0, thanks: /thank you/i.test(text) })
      await new Promise((r) => setTimeout(r, 50))
    }
  })()
  return { seen, stop: async () => { stop = true; await done } }
}

// Visible text plus the values of the editable fields (suggestions are shown in them).
const pageText = (page) => page.evaluate(() => [document.body.innerText, ...[...document.querySelectorAll('input, textarea')].map((e) => e.value)].join('\n'))

async function submitAndConfirm(page, { key, afterLanding }) {
  const s = sampler(page)
  await page.getByRole('button', { name: 'Accept and submit' }).click()
  await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 90000 })
  state.papers[key] = page.url().split('/confirm/')[1]
  const note = await afterLanding()
  const beforeConfirm = s.seen.filter((x) => x.thanks)
  await page.getByRole('button', { name: 'Confirm these details' }).click()
  await page.getByRole('heading', { name: 'Thank you for confirming' }).waitFor({ timeout: 30000 })
  await s.stop()
  assert.strictEqual(beforeConfirm.length, 0, `a thank-you was visible before Confirm at ${beforeConfirm[0]?.t} ms`)
  return `${note}; ${s.seen.length} samples over ${s.seen.at(-1)?.t} ms, no thank-you before Confirm, thank-you after`
}

async function main() {
  await check('config: Version 4 (EN + AR) offered with the repository hashes; automatic reading under the free tier; /admin and /research unavailable', 'config', async () => {
    const r = await fetch(`${O}/api/submissions/terms`, { headers: H })
    assert.strictEqual(r.status, 200, `terms ${r.status}`)
    const j = await r.json()
    assert.strictEqual(j.offer.decision, 'automatic')
    assert.strictEqual(j.processing.terms, 'gemini_api_unpaid')
    const ids = j.agreements.map((a) => a.id).sort()
    assert.deepStrictEqual(ids, ['submission-terms-2026-10-04-v4-ar', 'submission-terms-2026-10-04-v4-en'])
    for (const a of j.agreements) {
      assert.strictEqual(a.versionLabel, 'Version 4')
      assert.strictEqual(a.sha256, findAgreement(a.id).sha256, `${a.id} hash`)
      assert.strictEqual(crypto.createHash('sha256').update(a.text).digest('hex'), a.sha256, `${a.id} served text matches its hash`)
    }
    for (const p of ['/admin', '/research']) {
      const x = await fetch(`${O}${p}`, { headers: H, redirect: 'manual' })
      assert.strictEqual(x.status, 404, `${p} ${x.status}`)
    }
    const page = await newPage()
    await page.goto(`${O}/submit`)
    await page.waitForSelector('form input[type=checkbox]', { timeout: 30000 })
    assert.strictEqual(await page.locator('form input[type=checkbox]').count(), 1, 'one acceptance box')
    assert.strictEqual(await page.locator('form input[type=checkbox]').isChecked(), false)
    assert.strictEqual(await page.getByLabel('Read my document with Gemini (recommended)').isChecked(), true)
    assert.ok(await page.getByLabel('Enter details manually').isVisible())
    assert.ok(await page.getByText('free tier').first().isVisible(), 'free-tier explanation')
    assert.strictEqual(await page.getByText('Submit my research').count(), 0, 'no legacy form')
    await page.context().close()
    return 'agreement texts served match their hashes; one unchecked box; Gemini preselected; manual alternative shown'
  })

  await check('automatic, text PDF: read, review with authors and supervisor, Confirm, thank-you only after', 'auto', async () => {
    const page = await newPage()
    try {
      await fillForm(page, { tag: 'auto', file: 'thesis-en.pdf', choice: 'automatic' })
      return await submitAndConfirm(page, {
        key: 'auto',
        afterLanding: async () => {
          await page.getByRole('heading', { name: 'Here’s what we found' }).waitFor({ timeout: 120000 })
          const seen = await pageText(page)
          return `review shown; author suggested ${/Amna Osman Elhassan/.test(seen)}; supervisor suggested ${/Kamal Eldin Yousif/.test(seen)}`
        },
      })
    } finally { await page.context().close() }
  })

  await check('manual chosen: no reading, hand entry, Confirm, thank-you only after', 'manual', async () => {
    const page = await newPage()
    try {
      await fillForm(page, { tag: 'manual', file: 'thesis-en.pdf', choice: 'manual' })
      return await submitAndConfirm(page, {
        key: 'manual',
        afterLanding: async () => {
          await page.getByRole('heading', { name: 'Add your research details' }).waitFor({ timeout: 30000 })
          assert.ok(await page.getByText('your document was not sent for automatic reading').isVisible(), 'chosen-manual note')
          await page.getByRole('button', { name: /^Title/ }).first().click()
          await page.keyboard.type(`SYNTHETIC release check ${RUN} (manual entry)`)
          await page.keyboard.press('Tab')
          return 'hand entry shown with the chosen-manual note'
        },
      })
    } finally { await page.context().close() }
  })

  await check('automatic, scanned PDF: read like any other PDF, review, Confirm, thank-you only after', 'scan', async () => {
    const page = await newPage()
    try {
      await fillForm(page, { tag: 'scan', file: 'scanned-cover.pdf', choice: 'automatic' })
      return await submitAndConfirm(page, {
        key: 'scan',
        afterLanding: async () => {
          await page.getByRole('heading', { name: 'Here’s what we found' }).waitFor({ timeout: 120000 })
          const seen = await pageText(page)
          return `review shown; title suggested ${/Solar-Powered Irrigation/i.test(seen)}; author suggested ${/Amna Osman Elhassan/.test(seen)}`
        },
      })
    } finally { await page.context().close() }
  })

  if (browser) await browser.close()
  if (STATE) fs.writeFileSync(STATE, JSON.stringify(state), { mode: 0o600 })
  console.log(`\n${passed} passed, ${failed} failed; run ${RUN}; origin ${O}`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('ERROR', scrub(e.message)); process.exit(2) })
