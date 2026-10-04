#!/usr/bin/env node
//
// The premature thank-you screen (founder report, 2026-10-04), and the
// Gemini-by-default flow with its manual alternative, in real Chromium
// against the built application and the LOCAL Supabase stack. Synthetic
// documents only; the AI provider is the in-repository mock, controlled
// through MOCK_CONTROL_FILE so extraction can be slow or fail on demand.
// Nothing is sent to Gemini.
//
// The reported glitch: after the first Submit click the live flow briefly
// showed a "Thank you…" screen before the extraction page. Its cause was
// the legacy form replacing itself with a thank-you panel for as long as
// the navigation to /confirm took. Every response on the way is delayed
// here, and the page is sampled every 25 ms: no thank-you may appear
// anywhere until Confirm has been pressed.
//
// Run by supabase/tests/run-flow-timing-e2e.sh (E2E_FLOW=acceptance, then
// E2E_FLOW=legacy, each against a server started for that flow).

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')

const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:3100'
const FLOW = process.env.E2E_FLOW || 'acceptance' // or 'legacy'
const CONTROL = process.env.MOCK_CONTROL_FILE
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(APP)) throw new Error('local application only')
if (!CONTROL) throw new Error('MOCK_CONTROL_FILE must be set (the same file the server reads)')

function sql(text) {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=localtestpw', 'sb-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim()
}
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`
const mock = (c) => fs.writeFileSync(CONTROL, JSON.stringify(c))
const uniq = (tag) => `${tag}-${crypto.randomBytes(4).toString('hex')}@example.invalid`

let failed = 0
async function check(name, fn) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return
  try {
    await fn()
    console.log(`ok     ${name}`)
  } catch (err) {
    console.error(`FAIL   ${name} — ${err.stack || err.message}`)
    failed++
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'timing-docs-'))
// A realistic synthetic thesis (invented people).
async function pdfFile(name) {
  const p = path.join(TMP, name)
  fs.copyFileSync(path.join(__dirname, '../../scripts/fixtures/synthetic/thesis-en.pdf'), p)
  return p
}

// Every hop between Submit and the next page, slowed down.
const DELAYS = { upload: 800, finalize: 1500, extract: 1000, navigation: 2500 }
async function slowDown(page) {
  const later = (ms) => async (route) => { await new Promise((r) => setTimeout(r, ms)); route.continue() }
  await page.route('**/storage/v1/object/**', later(DELAYS.upload))
  await page.route('**/api/submissions/finalize', later(DELAYS.finalize))
  await page.route('**/api/extract', later(DELAYS.extract))
  await page.route('**/rest/v1/rpc/submit_paper', later(DELAYS.finalize))
  await page.route('**/confirm/**', later(DELAYS.navigation))
}

// Samples the visible page every 25 ms from the moment it starts.
function sampler(page) {
  const samples = []
  const t0 = Date.now()
  let stopped = false
  const done = (async () => {
    while (!stopped) {
      try {
        const s = await page.evaluate(() => ({ path: location.pathname, text: document.body.innerText.replace(/\s+/g, ' ') }))
        samples.push({ t: Date.now() - t0, ...s })
      } catch { /* mid-navigation */ }
      await new Promise((r) => setTimeout(r, 25))
    }
  })()
  return {
    samples,
    now: () => Date.now() - t0,
    stop: async () => { stopped = true; await done },
  }
}

const THANKS = /thank you|شكر/i
function noThanksBefore(s, t, label) {
  const early = s.samples.filter((x) => x.t < t && THANKS.test(x.text))
  assert.strictEqual(early.length, 0, `${label}: a thank-you was visible before Confirm: "${early[0]?.text.slice(0, 160)}" at ${early[0]?.t}ms`)
}
function seen(s, re) { return s.samples.some((x) => re.test(x.text)) }

let browser
async function newPage() {
  sql('delete from submission_rate_limits')
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } })
  await context.addCookies([{ name: 'sarp_lang', value: 'en', url: APP }])
  const page = await context.newPage()
  page.extractCalls = 0
  page.on('request', (r) => { if (r.url().endsWith('/api/extract')) page.extractCalls++ })
  return page
}

async function fillAcceptance(page, { email, choice = 'automatic' }) {
  await page.goto(`${APP}/submit`)
  await page.waitForSelector('form input[type=checkbox]', { timeout: 20000 })
  await page.getByLabel('Full name', { exact: true }).fill('Timing Researcher')
  await page.getByLabel('Email', { exact: true }).fill(email)
  await page.getByLabel('I am the author').check()
  const file = await pdfFile('thesis.pdf')
  await page.setInputFiles('input[type=file]', { name: 'thesis.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(file) })
  // Gemini reading is the default and preselected; manual is the secondary choice.
  assert.strictEqual(await page.getByLabel('Read my document with Gemini (recommended)').isChecked(), true)
  if (choice === 'manual') await page.getByLabel('Enter details manually').check()
  await page.locator('form input[type=checkbox]').last().check()
}

async function fillLegacy(page, { email }) {
  await page.goto(`${APP}/submit`)
  await page.waitForSelector('form input[type=checkbox]', { timeout: 20000 })
  await page.getByLabel('Full name', { exact: true }).fill('Timing Researcher')
  await page.getByLabel('Email', { exact: true }).fill(email)
  const file = await pdfFile('thesis.pdf')
  await page.setInputFiles('input[type=file]', { name: 'thesis.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(file) })
  await page.locator('form input[type=checkbox]').nth(0).check() // consent
  await page.locator('form input[type=checkbox]').nth(1).check() // a scope
}

// Enters a title by hand on the confirmation page (the one required field).
async function enterTitle(page, title) {
  await page.getByRole('button', { name: /^Title/ }).first().click()
  await page.keyboard.type(title)
  await page.keyboard.press('Tab')
}

// Presses Confirm and waits for the completion screen; returns the time.
async function confirm(page, s) {
  const at = s.now()
  await page.getByRole('button', { name: 'Confirm these details' }).click()
  await page.getByRole('heading', { name: 'Thank you for confirming' }).waitFor({ timeout: 20000 })
  return at
}

const paperByEmail = (email) => JSON.parse(sql(`select coalesce(json_agg(p), '[]') from (select p.id, p.extraction_status, p.manual_entry_source, p.submission_extraction_policy from papers p join researchers r on r.id = p.submitted_by where r.email = ${lit(email)}) p`))
const generationsOf = (paperId) => Number(sql(`select count(*) from ai_generations where paper_id = ${lit(paperId)}`))

async function main() {
  browser = await chromium.launch()
  mock({ delayMs: 150 })

  if (FLOW === 'acceptance') {
    sql(`update extraction_policy set mode = 'automatic', changed_at = now()`)
    // Version 2 only: the version whose text describes Gemini reading.
    sql(`update agreement_versions set active = (id like 'submission-terms-2026-10-04-v4-%')`)

    await check('automatic: submit -> progress -> reading -> review -> thank-you only after Confirm (every hop delayed)', async () => {
      mock({ delayMs: 4000 }) // a slow extraction, so the reading state is long
      const page = await newPage()
      await slowDown(page)
      const email = uniq('auto')
      await fillAcceptance(page, { email })
      const s = sampler(page)
      await page.getByRole('button', { name: 'Accept and submit' }).click()
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      await page.getByRole('heading', { name: 'Reading your research' }).waitFor({ timeout: 20000 })
      await page.getByRole('heading', { name: 'Here’s what we found' }).waitFor({ timeout: 60000 })
      const at = await confirm(page, s)
      await s.stop()
      noThanksBefore(s, at, 'automatic')
      assert.ok(seen(s, /Opening the next step/), 'the form showed progress while the next page loaded')
      assert.ok(seen(s, /Reading your research/), 'the extraction page was shown')
      const [p] = paperByEmail(email)
      assert.strictEqual(p.extraction_status, 'completed')
      assert.ok(generationsOf(p.id) >= 1)
      await page.context().close()
      mock({ delayMs: 150 })
    })

    await check('manual chosen before submitting: no extraction request, nothing read, its own wording, thank-you only after Confirm', async () => {
      const page = await newPage()
      await slowDown(page)
      const email = uniq('manual')
      await fillAcceptance(page, { email, choice: 'manual' })
      const s = sampler(page)
      await page.getByRole('button', { name: 'Accept and submit' }).click()
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      await page.getByRole('heading', { name: 'Add your research details' }).waitFor({ timeout: 20000 })
      await page.getByText('You chose to enter these details yourself, so your document was not sent for automatic reading.').waitFor()
      await enterTitle(page, 'A Title Typed By Hand')
      const at = await confirm(page, s)
      await s.stop()
      noThanksBefore(s, at, 'manual')
      assert.ok(!seen(s, /Reading your research/), 'never claimed to be reading')
      assert.ok(!seen(s, /couldn’t fill these in/), 'not the failure note')
      assert.strictEqual(page.extractCalls, 0, 'the browser never asked for extraction')
      const [p] = paperByEmail(email)
      assert.strictEqual(p.manual_entry_source, 'researcher')
      assert.strictEqual(generationsOf(p.id), 0, 'no provider run, not even a refused one')
      await page.context().close()
    })

    let failedToken
    await check('extraction failure: a retryable notice with manual entry offered; no thank-you; retry then succeeds', async () => {
      mock({ delayMs: 600, fail: 'api_error' })
      const page = await newPage()
      await slowDown(page)
      const email = uniq('fail')
      await fillAcceptance(page, { email })
      const s = sampler(page)
      await page.getByRole('button', { name: 'Accept and submit' }).click()
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      failedToken = page.url().split('/confirm/')[1]
      await page.getByRole('button', { name: 'Enter the details yourself' }).waitFor({ timeout: 60000 })
      const retry = page.getByRole('button', { name: /Try again/ })
      await retry.waitFor()
      // The server allows a retry 30 s after the failure; move the failure
      // back in time rather than wait (local database only).
      const [p] = paperByEmail(email)
      sql(`update papers set extraction_started_at = now() - interval '1 minute' where id = ${lit(p.id)}`)
      mock({ delayMs: 1500 })
      await retry.click()
      await page.getByRole('heading', { name: 'Here’s what we found' }).waitFor({ timeout: 60000 })
      const at = await confirm(page, s)
      await s.stop()
      noThanksBefore(s, at, 'failure then retry')
      assert.strictEqual(paperByEmail(email)[0].extraction_status, 'completed')
      await page.context().close()
      mock({ delayMs: 150 })
    })

    await check('extraction failure, then manual entry: the upload and the submitter are kept; no new upload; thank-you only after Confirm', async () => {
      mock({ delayMs: 400, fail: 'timeout' })
      const page = await newPage()
      await slowDown(page)
      const email = uniq('failmanual')
      await fillAcceptance(page, { email })
      const s = sampler(page)
      await page.getByRole('button', { name: 'Accept and submit' }).click()
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      await page.getByRole('button', { name: 'Enter the details yourself' }).click({ timeout: 60000 })
      await page.getByRole('heading', { name: 'Add your research details' }).waitFor({ timeout: 20000 })
      await page.getByText('We couldn’t fill these in from your document this time').waitFor()
      // The submitter, entered on the form, is still on the team list.
      assert.strictEqual(await page.getByLabel('Researcher 1 full name').inputValue(), 'Timing Researcher')
      const before = paperByEmail(email)
      await enterTitle(page, 'Entered After A Failure')
      const at = await confirm(page, s)
      await s.stop()
      noThanksBefore(s, at, 'failure then manual')
      const after = paperByEmail(email)
      assert.strictEqual(after.length, 1, 'one paper, the same upload')
      assert.strictEqual(after[0].id, before[0].id)
      assert.strictEqual(after[0].manual_entry_source, 'researcher')
      await page.context().close()
      mock({ delayMs: 150 })
    })

    await check('double click and double submit create exactly one acceptance and one paper', async () => {
      const page = await newPage()
      await slowDown(page)
      const email = uniq('double')
      await fillAcceptance(page, { email })
      const button = page.getByRole('button', { name: 'Accept and submit' })
      await button.dblclick()
      // And two programmatic submits in the same task, before any re-render.
      await page.evaluate(() => { const f = document.querySelector('form'); f.requestSubmit(); f.requestSubmit() }).catch(() => {})
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      assert.strictEqual(Number(sql(`select count(*) from submission_acceptances where email = ${lit(email)}`)), 1)
      assert.strictEqual(paperByEmail(email).length, 1)
      await page.context().close()
    })

    void failedToken
  }

  if (FLOW === 'legacy') {
    sql(`update extraction_policy set mode = 'automatic', changed_at = now()`)

    await check('legacy form: submit -> progress -> manual entry (never read) -> thank-you only after Confirm (every hop delayed)', async () => {
      const page = await newPage()
      await slowDown(page)
      const email = uniq('legacy')
      await fillLegacy(page, { email })
      const s = sampler(page)
      await page.getByRole('button', { name: 'Submit my research' }).click()
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      await page.getByRole('heading', { name: 'Add your research details' }).waitFor({ timeout: 20000 })
      await enterTitle(page, 'A Legacy Submission')
      const at = await confirm(page, s)
      await s.stop()
      noThanksBefore(s, at, 'legacy')
      assert.ok(seen(s, /Uploaded\. Opening the next step/), 'the form showed progress while the next page loaded')
      assert.ok(!seen(s, /Reading your research/), 'a legacy-form submission is never shown as being read')
      const [p] = paperByEmail(email)
      assert.strictEqual(p.submission_extraction_policy, 'manual')
      assert.strictEqual(generationsOf(p.id), 0, 'nothing was sent to the provider')
      await page.context().close()
    })

    await check('legacy form: double click and double submit create exactly one paper', async () => {
      const page = await newPage()
      await slowDown(page)
      const email = uniq('legacydouble')
      await fillLegacy(page, { email })
      await page.getByRole('button', { name: 'Submit my research' }).dblclick()
      await page.evaluate(() => { const f = document.querySelector('form'); f.requestSubmit(); f.requestSubmit() }).catch(() => {})
      await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 60000 })
      await page.waitForTimeout(1000)
      assert.strictEqual(paperByEmail(email).length, 1)
      await page.context().close()
    })
  }

  await browser.close()
  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log(`\nAll ${FLOW} flow-timing checks passed.`)
}

main()
