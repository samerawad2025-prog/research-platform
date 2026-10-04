#!/usr/bin/env node
//
// Phase 3 M2B/M3, browser to database: real Chromium driving the built
// application, against the LOCAL Supabase stack (Postgres, PostgREST,
// Storage API). Never a hosted project; synthetic documents only; the AI
// provider is the in-repository mock (AI_PROVIDER unset), so nothing is
// sent to Gemini. Run by supabase/tests/run-browser-e2e.sh, which starts
// the application with local keys.
//
// Screenshots are written to $E2E_SHOTS (default /var/tmp/e2e-shots).

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { chromium } = require('playwright')
const { createClient } = require('@supabase/supabase-js')
const { PDFDocument } = require('pdf-lib')
const JSZip = require('jszip')

const APP = process.env.E2E_APP_URL || 'http://127.0.0.1:3100'
const SB_URL = 'http://127.0.0.1:54321'
const SB_DIR = process.env.SB_DIR || '/var/tmp/sb'
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/e2e-shots'
const PHASE = process.env.E2E_PHASE || 'before-cutover' // or 'after-cutover'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(APP)) throw new Error('local application only')
const keys = JSON.parse(fs.readFileSync(path.join(SB_DIR, 'keys.json'), 'utf8'))
const anon = createClient(SB_URL, keys.anon, { auth: { persistSession: false } })
fs.mkdirSync(SHOTS, { recursive: true })

function sql(text) {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=localtestpw', 'sb-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim()
}
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`
const setPolicy = (mode) => sql(`update extraction_policy set mode = ${lit(mode)}, changed_at = now()`)

let failed = 0
const results = []
async function check(name, fn) {
  // E2E_ONLY=<regex> runs a subset (used to reproduce a finding first).
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return
  try {
    await fn()
    console.log(`ok     ${name}`)
    results.push(['ok', name])
  } catch (err) {
    console.error(`FAIL   ${name} — ${err.stack || err.message}`)
    results.push(['FAIL', name])
    failed++
  }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-docs-'))
async function pdfFile(name, text) {
  const d = await PDFDocument.create()
  d.addPage().drawText(text, { x: 50, y: 700 })
  const p = path.join(TMP, name)
  fs.writeFileSync(p, Buffer.from(await d.save()))
  return p
}
async function docxFile(name) {
  const z = new JSZip()
  // A minimal but well-formed Word document, so the real DOCX reader
  // (mammoth) accepts it.
  z.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>')
  z.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
  z.file('word/document.xml', '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Synthetic thesis for local testing</w:t></w:r></w:p></w:body></w:document>')
  const p = path.join(TMP, name)
  fs.writeFileSync(p, await z.generateAsync({ type: 'nodebuffer' }))
  return p
}

const EN = {
  submit: 'Accept and submit',
  accept: /^I have read and agree to the Submission and Deposit Agreement/,
  roles: { author: 'I am the author', coauthor: 'I am one of the authors', authorized_depositor: 'I am submitting on behalf of the authors' },
  settings: { record_abstract: 'Record and abstract only', record_abstract_fulltext: 'Record, abstract and full text' },
}
const AR = {
  submit: 'أوافق وأقدّم البحث',
  roles: { author: 'أنا مؤلف البحث', coauthor: 'أنا أحد مؤلفي البحث', authorized_depositor: 'أقدّم البحث نيابةً عن مؤلفيه' },
  settings: { record_abstract: 'بيانات البحث والملخص فقط', record_abstract_fulltext: 'بيانات البحث والملخص والنص الكامل' },
}

let browser
const consoleErrors = []
async function newPage({ locale = 'en', width = 1280, height = 900 } = {}) {
  // Every local request comes from one address, so the per-address limits
  // (10 acceptances an hour) are reset between scenarios. Local stack only.
  sql('delete from submission_rate_limits')
  const context = await browser.newContext({ viewport: { width, height } })
  await context.addCookies([{ name: 'sarp_lang', value: locale, url: APP }])
  const page = await context.newPage()
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push({ url: page.url(), text: m.text() }) })
  page.on('pageerror', (e) => consoleErrors.push({ url: page.url(), text: `pageerror: ${e.message}` }))
  return page
}

async function openForm(page) {
  await page.goto(`${APP}/submit`)
  await page.waitForSelector('form input[type=checkbox]', { timeout: 20000 })
}

async function fill(page, { L = EN, name, email, role = 'author', authors = [], file, setting = 'record_abstract', accept = true }) {
  await page.getByLabel(L === EN ? 'Full name' : 'الاسم الكامل', { exact: true }).fill(name)
  await page.getByLabel(L === EN ? 'Email' : 'البريد الإلكتروني', { exact: true }).fill(email)
  await page.getByLabel(L.roles[role]).check()
  if (role === 'authorized_depositor') {
    for (let i = 0; i < authors.length; i++) {
      if (i > 0) await page.getByRole('button', { name: L === EN ? '+ Add an author' : '+ إضافة مؤلف' }).click()
      await page.getByLabel(L === EN ? `Author ${i + 1} name` : `اسم المؤلف ${i + 1}`).fill(authors[i])
    }
  }
  // Name and bytes rather than a path: the Arabic file name is kept
  // exactly (a real production case, BUG_HISTORY.md #17).
  await page.setInputFiles('input[type=file]', { name: path.basename(file), mimeType: file.endsWith('.pdf') ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buffer: fs.readFileSync(file) })
  await page.getByLabel(L.settings[setting]).check()
  if (accept) await page.locator('form input[type=checkbox]').last().check()
}

async function submitAndWaitForConfirm(page, L = EN) {
  await page.getByRole('button', { name: L.submit }).click()
  await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 30000 })
  return page.url().split('/confirm/')[1]
}

const acceptancesFor = (email) => JSON.parse(sql(`select coalesce(json_agg(a order by created_at), '[]') from (select status, claimed_role, publication_setting, processing_decision, processing_offer_decision, declared_authors, paper_id, created_at from submission_acceptances where email = ${lit(email)}) a`))
const paperFor = (email) => JSON.parse(sql(`select coalesce(to_json(p), 'null') from (select p.* from papers p join submission_acceptances a on a.paper_id = p.id where a.email = ${lit(email)}) p`))
const authorsOf = (paperId) => JSON.parse(sql(`select coalesce(json_agg(json_build_object('name', r.full_name, 'email', r.email, 'order', pr.author_order, 'linkedin', r.linkedin_url, 'public', r.linkedin_public) order by pr.author_order nulls last), '[]') from paper_researchers pr join researchers r on r.id = pr.researcher_id where pr.paper_id = ${lit(paperId)}`))
const uniq = (tag) => `${tag}-${crypto.randomBytes(4).toString('hex')}@example.invalid`

async function noHorizontalScroll(page) {
  const [sw, cw] = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth])
  assert.ok(sw <= cw + 1, `horizontal scroll: ${sw} > ${cw}`)
}

async function main() {
  browser = await chromium.launch()
  sql(`update agreement_versions set active = (id like 'submission-terms-2026-10-04-v3-%')`)
  const pdf = await pdfFile('synthetic-thesis.pdf', 'Synthetic thesis for local testing')
  const pdf2 = await pdfFile('بحث-تجريبي.pdf', 'Second synthetic document')
  const docx = await docxFile('synthetic.docx')
  // Realistic synthetic documents (invented people) for automatic reading
  // under the free tier, and what the mock provider was sent.
  const thesisDocx = path.join(__dirname, '../../scripts/fixtures/synthetic/thesis-en.docx')
  const scannedPdf = path.join(__dirname, '../../scripts/fixtures/synthetic/scanned-cover.pdf')
  const sentToProvider = () => (process.env.MOCK_RECORD && fs.existsSync(process.env.MOCK_RECORD)
    ? fs.readFileSync(process.env.MOCK_RECORD, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
  const PERSONAL = [/Amna/i, /Elhassan/i, /Kamal/i, /Yousif/i, /Hassan Ali/i, /Sara Ahmed/i, /@/, /0912345678/]

  if (PHASE === 'after-cutover') {
    await check('after cutover: a signed submission still completes in the browser (EN, author, manual processing)', async () => {
      setPolicy('manual')
      const page = await newPage()
      await openForm(page)
      const email = uniq('after-cutover')
      await fill(page, { name: 'After Cutover', email, file: pdf })
      const token = await submitAndWaitForConfirm(page)
      assert.ok(token)
      await page.getByText('Your research has been received').waitFor()
      assert.strictEqual(acceptancesFor(email)[0].status, 'finalized')
      await page.context().close()
    })
    await check('after cutover: the form never offers or uses the legacy path', async () => {
      const page = await newPage()
      const legacyCalls = []
      page.on('request', (r) => { if (/\/rpc\/submit_paper|\/storage\/v1\/object\/papers\//.test(r.url())) legacyCalls.push(r.url()) })
      await openForm(page)
      await fill(page, { name: 'No Legacy', email: uniq('nolegacy'), file: pdf })
      await submitAndWaitForConfirm(page)
      assert.deepStrictEqual(legacyCalls, [])
      await page.context().close()
    })
    return finish()
  }

  // ------------------------------------------------------------ unavailable
  await check('unavailable: with no active agreement the form says so and offers no way to submit (no legacy fallback)', async () => {
    sql(`update agreement_versions set active = false`)
    const page = await newPage()
    await page.goto(`${APP}/submit`)
    await page.getByRole('heading', { name: 'Submissions are temporarily unavailable' }).waitFor()
    assert.strictEqual(await page.locator('input[type=file]').count(), 0)
    assert.strictEqual(await page.getByText('Publish the complete paper').count(), 0, 'no legacy form')
    await page.screenshot({ path: `${SHOTS}/unavailable-en-1280.png`, fullPage: true })
    sql(`update agreement_versions set active = (id like 'submission-terms-2026-10-04-v3-%')`)
    await page.getByRole('button', { name: 'Try again' }).click()
    await page.waitForSelector('form input[type=checkbox]')
    await page.context().close()
  })

  // ------------------------------------------------------------ EN, keyboard, manual
  await check('EN keyboard-only: author, record and abstract, manual processing -> private receipt; nothing published', async () => {
    setPolicy('manual')
    const page = await newPage({ width: 1280 })
    await openForm(page)
    const submit = page.getByRole('button', { name: EN.submit })
    assert.ok(await submit.isDisabled(), 'disabled before anything is filled')
    assert.ok(await page.getByText(/Still needed: your name, a valid email address, your role/).isVisible())
    const checkbox = page.locator('form input[type=checkbox]').last()
    assert.strictEqual(await checkbox.isChecked(), false, 'acceptance starts unchecked')
    assert.strictEqual(await page.getByLabel(EN.settings.record_abstract).isChecked(), true, 'record and abstract is the default')
    assert.ok(await page.getByText('Your document will not be read automatically').isVisible(), 'server processing explanation')
    // Keyboard: the skip link and every control reached with Tab.
    const email = uniq('keyboard')
    await page.getByLabel('Full name', { exact: true }).focus()
    await page.keyboard.type('Keyboard Author')
    await page.keyboard.press('Tab')
    await page.keyboard.type(email)
    await page.getByLabel(EN.roles.author).focus()
    await page.keyboard.press('Space')
    await page.setInputFiles('input[type=file]', pdf)
    // Opening the agreement keeps everything entered.
    await page.getByText('Read the full agreement').focus()
    await page.keyboard.press('Enter')
    await page.getByRole('region', { name: 'Full text of the agreement' }).waitFor()
    assert.ok(await page.getByText('Submission and Deposit Agreement and Privacy Notice', { exact: true }).isVisible())
    assert.strictEqual(await page.getByLabel('Full name', { exact: true }).inputValue(), 'Keyboard Author')
    assert.ok(await page.getByText('synthetic-thesis.pdf').isVisible(), 'file kept')
    await page.screenshot({ path: `${SHOTS}/form-terms-open-en-1280.png`, fullPage: true })
    assert.ok(await submit.isDisabled(), 'still disabled until acceptance')
    await checkbox.focus()
    await page.keyboard.press('Space')
    assert.ok(await submit.isEnabled())
    await submit.focus()
    await page.keyboard.press('Enter')
    await page.waitForURL(/\/confirm\/[0-9a-f]{64}$/, { timeout: 30000 })
    await page.getByText('Your research has been received').waitFor()
    assert.ok(await page.getByText('It is private and has not been published').isVisible())
    assert.ok(await page.getByText('is your private link').isVisible())
    await page.getByRole('heading', { name: 'Add your research details' }).waitFor({ timeout: 20000 })
    const robots = await page.locator('meta[name=robots]').getAttribute('content')
    assert.match(robots, /noindex/)
    assert.strictEqual(await page.locator('meta[name=referrer]').getAttribute('content'), 'no-referrer')
    await page.screenshot({ path: `${SHOTS}/confirm-receipt-manual-en-1280.png`, fullPage: true })
    const [acc] = acceptancesFor(email)
    assert.strictEqual(acc.status, 'finalized')
    assert.strictEqual(acc.publication_setting, 'record_abstract')
    assert.strictEqual(acc.processing_decision, 'manual')
    const paper = paperFor(email)
    assert.strictEqual(paper.status, 'submitted')
    assert.strictEqual(paper.submission_extraction_policy, 'manual')
    // Recorded by the server when the page first opens (it never reads this paper).
    for (let i = 0; i < 50 && !paperFor(email).manual_entry_at; i++) await new Promise((r) => setTimeout(r, 100))
    assert.ok(paperFor(email).manual_entry_at, 'manual decision recorded, no provider call')
    assert.strictEqual(paperFor(email).manual_entry_source, 'mode', 'the server\'s decision, not labelled as the researcher\'s')
    assert.deepStrictEqual(authorsOf(paper.id).map((x) => [x.name, x.order]), [['Keyboard Author', 1]])
    await page.context().close()
  })

  // ------------------------------------------------------------ AR mobile, depositor, automatic
  await check('AR 360px: depositor with two authors, full text, simulated automatic processing; RTL; depositor not an author', async () => {
    setPolicy('automatic')
    const page = await newPage({ locale: 'ar', width: 360, height: 780 })
    await openForm(page)
    assert.strictEqual(await page.locator('form').getAttribute('dir'), 'rtl')
    assert.strictEqual(await page.locator('[data-decision]').getAttribute('data-decision'), 'automatic', 'automatic explanation from the server offer')
    await noHorizontalScroll(page)
    const email = uniq('depositor')
    const sentBefore = sentToProvider().length
    await fill(page, { L: AR, name: 'أمينة المكتبة', email, role: 'authorized_depositor', authors: ['فاطمة الأمين', 'Mohammed Adam'], file: thesisDocx, setting: 'record_abstract_fulltext' })
    assert.ok(await page.locator('label').getByText('قرأت اتفاقية تقديم البحوث وإيداعها', { exact: false }).isVisible(), 'Arabic acceptance sentence')
    await page.getByText('اقرأ نص الاتفاقية كاملاً').click()
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/form-depositor-ar-360.png`, fullPage: true })
    await submitAndWaitForConfirm(page, AR)
    await page.getByText('تم استلام بحثك').waitFor()
    await page.getByRole('heading', { name: 'هذه هي التفاصيل التي وجدناها' }).waitFor({ timeout: 30000 })
    // The depositor's typed authors seed the team, not the extraction's guess.
    assert.strictEqual(await page.getByLabel('الاسم الكامل للباحث 1').inputValue(), 'فاطمة الأمين')
    assert.strictEqual(await page.getByLabel('الاسم الكامل للباحث 2').inputValue(), 'Mohammed Adam')
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/confirm-automatic-ar-360.png`, fullPage: true })
    const [acc] = acceptancesFor(email)
    assert.strictEqual(acc.claimed_role, 'authorized_depositor')
    assert.deepStrictEqual(acc.declared_authors, ['فاطمة الأمين', 'Mohammed Adam'])
    assert.strictEqual(acc.publication_setting, 'record_abstract_fulltext')
    assert.strictEqual(acc.processing_decision, 'automatic')
    const paper = paperFor(email)
    const team = authorsOf(paper.id)
    assert.deepStrictEqual(team.map((x) => [x.name, x.order, x.email]), [['فاطمة الأمين', 1, null], ['Mohammed Adam', 2, null]])
    assert.ok(!team.some((x) => x.email === email), 'depositor never an author')
    const gens = Number(sql(`select count(*) from ai_generations where paper_id = ${lit(paper.id)} and provider = 'mock'`))
    assert.ok(gens >= 1, 'mock provider ran; no external call')
    // Free tier: the built server sent one text excerpt, no file, nobody's details.
    const sent = sentToProvider().slice(sentBefore)
    assert.strictEqual(sent.length, 1, 'one request')
    assert.strictEqual(sent[0].type, 'text')
    assert.strictEqual(sent[0].scope, 'excerpt')
    assert.strictEqual(sent[0].pdfBytes, null)
    for (const re of PERSONAL) assert.ok(!re.test(sent[0].content), `${re} would have been sent`)
    assert.ok(/University of Khartoum/.test(sent[0].content) && /twelve smallholder schemes/.test(sent[0].content), 'the useful part is sent')
    assert.ok(await page.getByText('هذه الاقتراحات مأخوذة من مقتطف قصير').isVisible(), 'the excerpt note says authors are entered by hand')
    assert.ok(await page.getByText('اضغط للإضافة.').first().isVisible(), 'the supervisor was not looked for: an invitation, not "not found"')
    await page.context().close()
  })

  await check('EN free tier: a scanned PDF is never sent - hand entry with its own explanation, no retry', async () => {
    setPolicy('automatic')
    const page = await newPage({ width: 390, height: 844 })
    await openForm(page)
    assert.ok(await page.getByText('only a short excerpt').isVisible(), 'the free-tier explanation is shown')
    const sentBefore = sentToProvider().length
    const email = uniq('scanned')
    await fill(page, { name: 'Scanned Thesis', email, file: scannedPdf })
    await submitAndWaitForConfirm(page)
    await page.getByRole('heading', { name: 'Add your research details' }).waitFor({ timeout: 30000 })
    await page.getByText('we could not prepare one from this file', { exact: false }).waitFor()
    assert.strictEqual(await page.getByRole('button', { name: 'Try again' }).count(), 0, 'no retry that would make the same decision')
    assert.strictEqual(sentToProvider().length, sentBefore, 'nothing was sent')
    const paper = paperFor(email)
    assert.strictEqual(paper.failure_code, 'excerpt_unavailable')
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/confirm-protected-en-390.png`, fullPage: true })
    await page.context().close()
  })

  await check('EN coauthor, DOCX: linked without a position until confirmed', async () => {
    setPolicy('manual')
    const page = await newPage({ width: 768 })
    await openForm(page)
    const email = uniq('coauthor')
    await fill(page, { name: 'Second Author', email, role: 'coauthor', file: docx })
    await page.screenshot({ path: `${SHOTS}/form-filled-en-768.png`, fullPage: true })
    await submitAndWaitForConfirm(page)
    const paper = paperFor(email)
    assert.deepStrictEqual(authorsOf(paper.id).map((x) => [x.name, x.order]), [['Second Author', null]])
    await page.context().close()
  })

  // ------------------------------------------------------------ offer changes
  await check('stale offer: processing broadened after the form loaded -> fresh acceptance required, inputs kept, nothing recorded', async () => {
    setPolicy('manual')
    const page = await newPage()
    await openForm(page)
    const email = uniq('broadened')
    await fill(page, { name: 'Broadened Case', email, file: pdf })
    setPolicy('automatic')
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('How submissions are processed has changed since you opened this form').waitFor()
    assert.strictEqual(await page.locator('form input[type=checkbox]').last().isChecked(), false, 'acceptance cleared')
    assert.strictEqual(await page.getByLabel('Full name', { exact: true }).inputValue(), 'Broadened Case')
    assert.ok(await page.getByText('synthetic-thesis.pdf').isVisible())
    assert.strictEqual(await page.locator('[data-decision]').getAttribute('data-decision'), 'automatic', 'the new explanation is shown')
    assert.ok(await page.getByRole('button', { name: EN.submit }).isDisabled())
    assert.strictEqual(acceptancesFor(email).length, 0, 'nothing recorded for the stale offer')
    await page.screenshot({ path: `${SHOTS}/stale-offer-en-1280.png`, fullPage: true })
    await page.locator('form input[type=checkbox]').last().check()
    await submitAndWaitForConfirm(page)
    const [acc] = acceptancesFor(email)
    assert.strictEqual(acc.processing_offer_decision, 'automatic')
    assert.strictEqual(acc.processing_decision, 'automatic')
    await page.context().close()
  })

  await check('stale offer: agreement deactivated after the form loaded -> reacceptance required', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('agreement')
    await fill(page, { name: 'Agreement Case', email, file: pdf })
    sql(`update agreement_versions set active = false where language = 'en'`)
    await page.getByRole('button', { name: EN.submit }).click()
    // Only the Arabic agreement remains: shown, with the note, and not accepted.
    await page.getByText('The agreement has changed since you opened this form').waitFor()
    assert.ok(await page.getByText('The agreement is not available in your language').isVisible())
    assert.strictEqual(await page.locator('form input[type=checkbox]').last().isChecked(), false)
    assert.strictEqual(acceptancesFor(email).length, 0)
    sql(`update agreement_versions set active = (id like 'submission-terms-2026-10-04-v3-%')`)
    await page.context().close()
  })

  await check('narrower processing: explained before upload; uploads only on the researcher\'s say-so', async () => {
    setPolicy('automatic')
    const page = await newPage({ width: 390, height: 844 })
    await openForm(page)
    const email = uniq('narrowed')
    await fill(page, { name: 'Narrowed Case', email, file: pdf })
    setPolicy('manual')
    const uploads = []
    page.on('request', (r) => { if (r.url().includes('/object/upload/sign/')) uploads.push(r.url()) })
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByRole('heading', { name: 'Processing has changed' }).waitFor()
    assert.deepStrictEqual(uploads, [], 'nothing uploaded yet')
    await noHorizontalScroll(page)
    await page.screenshot({ path: `${SHOTS}/narrowed-en-390.png`, fullPage: true })
    await page.getByRole('button', { name: 'Continue with upload' }).click()
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    const [acc] = acceptancesFor(email)
    assert.strictEqual(acc.processing_offer_decision, 'automatic')
    assert.strictEqual(acc.processing_decision, 'manual')
    await page.context().close()
  })

  await check('language switch: acceptance withdrawn, Arabic agreement shown, inputs kept; submitted agreement is the Arabic one', async () => {
    setPolicy('manual')
    const page = await newPage()
    await openForm(page)
    const email = uniq('language')
    await fill(page, { name: 'Language Case', email, file: pdf })
    await page.getByRole('button', { name: 'عرض الموقع بالعربية' }).click()
    await page.getByText('تُعرض الاتفاقية الآن باللغة التي اخترتها').waitFor()
    assert.strictEqual(await page.locator('form input[type=checkbox]').last().isChecked(), false)
    assert.strictEqual(await page.getByLabel('الاسم الكامل', { exact: true }).inputValue(), 'Language Case')
    await page.locator('form input[type=checkbox]').last().check()
    await submitAndWaitForConfirm(page, AR)
    const lang = sql(`select agreement_language from submission_acceptances where email = ${lit(email)}`)
    assert.strictEqual(lang, 'ar')
    await page.context().close()
  })

  // ------------------------------------------------------------ failures and retries
  await check('upload failure: explained, inputs kept; retry reuses the same acceptance', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('uploadfail')
    await fill(page, { name: 'Upload Fail', email, file: pdf })
    let aborted = 0
    await page.route('**/storage/v1/object/upload/sign/**', (route) => (aborted++ === 0 ? route.abort('connectionreset') : route.continue()))
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('Your file didn’t upload').waitFor()
    assert.strictEqual(acceptancesFor(email).length, 1)
    await page.screenshot({ path: `${SHOTS}/upload-failed-en-1280.png`, fullPage: true })
    await submitAndWaitForConfirm(page)
    const acc = acceptancesFor(email)
    assert.strictEqual(acc.length, 1, 'same intent reused')
    assert.strictEqual(acc[0].status, 'finalized')
    await page.context().close()
  })

  await check('upload link expired: distinct message; retry takes a new link (new acceptance record), the old one stays unused', async () => {
    const page = await newPage({ locale: 'ar', width: 390, height: 844 })
    await openForm(page)
    const email = uniq('linkexpired')
    await fill(page, { L: AR, name: 'رابط منتهي', email, file: pdf2 })
    let n = 0
    await page.route('**/storage/v1/object/upload/sign/**', (route) =>
      n++ === 0 ? route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ statusCode: '400', error: 'InvalidJWT', message: 'jwt expired' }) }) : route.continue())
    await page.getByRole('button', { name: AR.submit }).click()
    await page.getByText('انتهت صلاحية رابط الرفع').waitFor()
    await page.screenshot({ path: `${SHOTS}/upload-link-expired-ar-390.png`, fullPage: true })
    await submitAndWaitForConfirm(page, AR)
    const acc = acceptancesFor(email)
    assert.deepStrictEqual(acc.map((x) => x.status).sort(), ['finalized', 'open'])
    await page.context().close()
  })

  await check('submission expired at finalization: distinct message, inputs kept, a new submission works', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('expired')
    await fill(page, { name: 'Expired Case', email, file: pdf })
    let n = 0
    await page.route('**/api/submissions/finalize', async (route) => {
      if (n++ === 0) {
        sql(`update submission_acceptances set expires_at = now() - interval '1 minute' where email = ${lit(email)}`)
      }
      await route.continue()
    })
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('This submission expired before it was completed').waitFor()
    assert.strictEqual(await page.getByLabel('Email', { exact: true }).inputValue(), email)
    await submitAndWaitForConfirm(page)
    const acc = acceptancesFor(email)
    assert.deepStrictEqual(acc.map((x) => x.status).sort(), ['expired', 'finalized'])
    await page.context().close()
  })

  await check('lost finalization response: retried automatically, one submission, same private link', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('lost')
    await fill(page, { name: 'Lost Response', email, file: pdf })
    let n = 0
    await page.route('**/api/submissions/finalize', async (route) => {
      if (n++ === 0) {
        await route.fetch() // the server finalizes...
        return route.abort('connectionreset') // ...but the answer never arrives
      }
      return route.continue()
    })
    const token = await submitAndWaitForConfirm(page)
    assert.ok(n >= 2)
    const acc = acceptancesFor(email)
    assert.strictEqual(acc.length, 1)
    assert.strictEqual(Number(sql(`select count(*) from papers where submission_acceptance_id in (select id from submission_acceptances where email = ${lit(email)})`)), 1)
    assert.strictEqual(sql(`select confirmation_token_hash from papers where id = ${lit(acc[0].paper_id)}`), crypto.createHash('sha256').update(token).digest('hex'))
    await page.context().close()
  })

  await check('recovery after reload: an uploaded but unfinished submission can be completed from the form', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('reload')
    await fill(page, { name: 'Reload Case', email, file: pdf })
    await page.route('**/api/submissions/finalize', (route) => route.abort('connectionreset'))
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('We couldn’t reach the server').waitFor({ timeout: 20000 })
    await page.unroute('**/api/submissions/finalize')
    await page.reload()
    await page.getByRole('heading', { name: 'Finish your earlier submission' }).waitFor()
    await page.screenshot({ path: `${SHOTS}/recovery-en-1280.png`, fullPage: true })
    await page.getByRole('button', { name: 'Complete submission' }).click()
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    assert.strictEqual(acceptancesFor(email)[0].status, 'finalized')
    await page.context().close()
  })

  await check('duplicate clicks and Enter presses create one acceptance and one submission', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('double')
    await fill(page, { name: 'Double Click', email, file: pdf })
    const btn = page.locator('form button[type=submit]')
    await Promise.all([btn.dblclick(), btn.click({ delay: 0 }).catch(() => {}), page.keyboard.press('Enter')])
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    assert.strictEqual(acceptancesFor(email).length, 1)
    await page.context().close()
  })

  await check('server enforces acceptance and the offer even if the browser is bypassed', async () => {
    const terms = await (await fetch(`${APP}/api/submissions/terms`)).json()
    const body = { offerToken: terms.offer.token, agreementId: 'submission-terms-2026-10-04-v3-en', publicationSetting: 'record_abstract', claimedRole: 'author', processingChoice: 'automatic', fullName: 'Direct', email: uniq('direct'), file: { name: 'a.pdf', size: 100, type: 'application/pdf' } }
    for (const [over, status, reason] of [
      [{ accepted: false }, 400, 'acceptance_required'],
      [{ accepted: true, offerToken: 'forged.offer' }, 400, 'offer_invalid'],
      [{ accepted: true, processingDecision: 'automatic' }, 400, 'unexpected_field'],
      // The processing choice is never implied: it must be sent, explicitly.
      [{ accepted: true, processingChoice: undefined }, 400, 'processing_choice_invalid'],
      // An agreement without the AI-reading disclosure is not offered at all.
      [{ accepted: true, agreementId: 'submission-terms-2026-09-25-en' }, 409, 'offer_stale'],
    ]) {
      const r = await fetch(`${APP}/api/submissions/intent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...over }) })
      assert.strictEqual(r.status, status)
      assert.strictEqual((await r.json()).reason, reason)
    }
  })


  // ------------------------------------------------------------ snapshot integrity (correction pass)
  await check('snapshot: during the narrowed notice, setting, acceptance, file and language cannot drift from what was accepted and uploaded', async () => {
    setPolicy('automatic')
    const page = await newPage()
    await openForm(page)
    const email = uniq('snapshot')
    const original = fs.readFileSync(pdf)
    await fill(page, { name: 'Snapshot Case', email, file: pdf, setting: 'record_abstract_fulltext' })
    setPolicy('manual')
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByRole('heading', { name: 'Processing has changed' }).waitFor()
    // 1. Publication permission.
    await page.getByLabel(EN.settings.record_abstract).check({ force: true, timeout: 2000 }).catch(() => {})
    // 2. Acceptance.
    await page.locator('form input[type=checkbox]').last().uncheck({ force: true, timeout: 2000 }).catch(() => {})
    // 3. A different file of exactly the same size (and the same name).
    const replacement = Buffer.from(original)
    replacement[Math.floor(replacement.length / 2)] ^= 0x01
    assert.strictEqual(replacement.length, original.length)
    await page.setInputFiles('input[type=file]', { name: 'synthetic-thesis.pdf', mimeType: 'application/pdf', buffer: replacement }).catch(() => {})
    // 4. Language.
    await page.getByRole('button', { name: 'عرض الموقع بالعربية' }).click()
    // What is visible still matches what was accepted.
    assert.strictEqual(await page.getByLabel(AR.settings.record_abstract_fulltext).isChecked(), true, 'setting unchanged on screen')
    assert.strictEqual(await page.locator('form input[type=checkbox]').last().isChecked(), true, 'acceptance unchanged on screen')
    assert.strictEqual(await page.locator('[data-agreement-language]').getAttribute('data-agreement-language'), 'en', 'the accepted (English) agreement stays shown')
    await page.screenshot({ path: `${SHOTS}/snapshot-locked-ar-1280.png`, fullPage: true })
    await page.getByRole('button', { name: 'متابعة الرفع' }).click()
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    const [acc] = acceptancesFor(email)
    assert.strictEqual(acc.publication_setting, 'record_abstract_fulltext')
    assert.strictEqual(sql(`select agreement_language from submission_acceptances where email = ${lit(email)}`), 'en')
    assert.strictEqual(paperFor(email).file_sha256, crypto.createHash('sha256').update(original).digest('hex'), 'the uploaded bytes are the accepted file')
    await page.context().close()
  })

  await check('snapshot: "Cancel and edit" after the narrowed notice unlocks the form, and edits then need a fresh submission', async () => {
    setPolicy('automatic')
    const page = await newPage()
    await openForm(page)
    const email = uniq('cancel-edit')
    await fill(page, { name: 'Cancel Edit', email, file: pdf, setting: 'record_abstract_fulltext' })
    setPolicy('manual')
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByRole('heading', { name: 'Processing has changed' }).waitFor()
    await page.getByRole('button', { name: 'Cancel and edit details' }).click()
    await page.getByLabel(EN.settings.record_abstract).check()
    assert.strictEqual(await page.locator('form input[type=checkbox]').last().isChecked(), true)
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByRole('heading', { name: 'Processing has changed' }).waitFor()
    await page.getByRole('button', { name: 'Continue with upload' }).click()
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    const acc = acceptancesFor(email)
    assert.deepStrictEqual(acc.map((x) => [x.publication_setting, x.status]), [['record_abstract_fulltext', 'open'], ['record_abstract', 'finalized']], 'a new acceptance for the edited choice')
    await page.context().close()
  })

  await check('snapshot: controls are locked while the upload and finalization run', async () => {
    setPolicy('manual')
    const page = await newPage()
    await openForm(page)
    await fill(page, { name: 'Locked While Working', email: uniq('working'), file: pdf })
    let release
    const gate = new Promise((r) => { release = r })
    await page.route('**/api/submissions/finalize', async (route) => { await gate; await route.continue() })
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('Completing your submission…').first().waitFor()
    assert.ok(await page.getByLabel('Full name', { exact: true }).isDisabled())
    assert.ok(await page.getByLabel(EN.settings.record_abstract_fulltext).isDisabled())
    assert.ok(await page.locator('form input[type=checkbox]').last().isDisabled())
    release()
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    await page.context().close()
  })

  // ------------------------------------------------------------ recovery decided by the server (correction pass)
  await check('recovery: finalized but the response was lost; after the intent expires, reload still recovers the same paper and link', async () => {
    setPolicy('manual')
    const page = await newPage()
    await openForm(page)
    const email = uniq('lost-expired')
    await fill(page, { name: 'Lost Then Expired', email, file: pdf })
    await page.route('**/api/submissions/finalize', async (route) => { await route.fetch(); return route.abort('connectionreset') })
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('We couldn’t reach the server').waitFor({ timeout: 30000 })
    assert.strictEqual(acceptancesFor(email)[0].status, 'finalized', 'the server did finalize')
    await page.unroute('**/api/submissions/finalize')
    sql(`update submission_acceptances set expires_at = now() - interval '1 hour' where email = ${lit(email)}`)
    // Make the browser's own copy look expired too.
    await page.evaluate(() => {
      const k = 'sarp_pending_submission'
      const p = JSON.parse(sessionStorage.getItem(k))
      p.expiresAt = new Date(Date.now() - 3600_000).toISOString()
      sessionStorage.setItem(k, JSON.stringify(p))
    })
    await page.reload()
    await page.getByRole('heading', { name: 'Finish your earlier submission' }).waitFor()
    await page.getByRole('button', { name: 'Complete submission' }).click()
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    const token = page.url().split('/confirm/')[1]
    const acc = acceptancesFor(email)
    assert.strictEqual(acc.length, 1)
    assert.strictEqual(sql(`select confirmation_token_hash from papers where id = ${lit(acc[0].paper_id)}`), crypto.createHash('sha256').update(token).digest('hex'), 'the same private link')
    await page.context().close()
  })

  await check('recovery: an uploaded but genuinely expired, unfinalized submission gets the expiry message and is cleared', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('genuinely-expired')
    await fill(page, { name: 'Genuinely Expired', email, file: pdf })
    await page.route('**/api/submissions/finalize', (route) => route.abort('connectionreset'))
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('We couldn’t reach the server').waitFor({ timeout: 30000 })
    await page.unroute('**/api/submissions/finalize')
    sql(`update submission_acceptances set expires_at = now() - interval '1 hour' where email = ${lit(email)}`)
    await page.reload()
    await page.getByRole('heading', { name: 'Finish your earlier submission' }).waitFor()
    await page.getByRole('button', { name: 'Complete submission' }).click()
    await page.getByText('This submission expired before it was completed').waitFor()
    assert.strictEqual(await page.getByRole('heading', { name: 'Finish your earlier submission' }).count(), 0)
    assert.strictEqual(acceptancesFor(email)[0].status, 'expired')
    assert.strictEqual(acceptancesFor(email)[0].paper_id, null)
    await page.reload()
    assert.strictEqual(await page.getByRole('heading', { name: 'Finish your earlier submission' }).count(), 0, 'not offered again')
    await page.context().close()
  })

  await check('recovery: a temporary failure keeps a working retry, and the retry creates no second paper', async () => {
    const page = await newPage()
    await openForm(page)
    const email = uniq('recovery-retry')
    await fill(page, { name: 'Recovery Retry', email, file: pdf })
    await page.route('**/api/submissions/finalize', (route) => route.abort('connectionreset'))
    await page.getByRole('button', { name: EN.submit }).click()
    await page.getByText('We couldn’t reach the server').waitFor({ timeout: 30000 })
    await page.unroute('**/api/submissions/finalize')
    await page.reload()
    await page.getByRole('heading', { name: 'Finish your earlier submission' }).waitFor()
    // The first recovery attempt meets a temporarily unavailable service.
    await page.route('**/api/submissions/finalize', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ reason: 'database_not_ready' }) }))
    await page.getByRole('button', { name: 'Complete submission' }).click()
    await page.getByText('We couldn’t reach the server').waitFor({ timeout: 30000 })
    assert.ok(await page.getByRole('button', { name: 'Complete submission' }).isEnabled(), 'retry still offered')
    // Rate limited: still recoverable.
    await page.unroute('**/api/submissions/finalize')
    await page.route('**/api/submissions/finalize', (route) => route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ reason: 'rate_limited' }) }))
    await page.getByRole('button', { name: 'Complete submission' }).click()
    await page.getByText('There have been too many attempts').waitFor()
    assert.ok(await page.getByRole('button', { name: 'Complete submission' }).isEnabled())
    await page.unroute('**/api/submissions/finalize')
    await page.getByRole('button', { name: 'Complete submission' }).click()
    await page.waitForURL(/\/confirm\//, { timeout: 30000 })
    assert.strictEqual(Number(sql(`select count(*) from papers where submission_acceptance_id in (select id from submission_acceptances where email = ${lit(email)})`)), 1)
    await page.context().close()
  })

  // ------------------------------------------------------------ confirmation: Facebook and LinkedIn
  await check('confirmation: no Facebook field; LinkedIn validated, private by default; only the submitter can show their own', async () => {
    setPolicy('manual')
    const page = await newPage()
    await openForm(page)
    const email = uniq('linkedin')
    await fill(page, { name: 'Linked Author', email, file: pdf, setting: 'record_abstract' })
    await submitAndWaitForConfirm(page)
    await page.getByRole('heading', { name: 'Add your research details' }).waitFor({ timeout: 20000 })
    assert.strictEqual(await page.getByText(/facebook/i).count(), 0)
    await page.getByRole('button', { name: 'Add a LinkedIn profile (optional)' }).first().click()
    const input = page.getByLabel('LinkedIn profile address (optional) (1)')
    await input.fill('https://facebook.com/someone')
    await page.getByText('Please enter a LinkedIn profile address').first().waitFor()
    const showMine = page.getByLabel('Show my LinkedIn profile on this research’s public record, if it is published')
    assert.ok(await showMine.isDisabled(), 'cannot show an invalid link')
    await input.fill('linkedin.com/in/linked-author')
    assert.strictEqual(await showMine.isChecked(), false, 'private by default')
    await showMine.check()
    await page.getByRole('button', { name: '+ Add a researcher' }).click()
    await page.getByLabel('Researcher 2 full name').fill('Other Person')
    await page.getByRole('button', { name: 'Add a LinkedIn profile (optional)' }).last().click()
    await page.getByLabel('LinkedIn profile address (optional) (2)').fill('https://www.linkedin.com/in/other-person')
    assert.ok(await page.getByText('Only you can choose to show your own profile').isVisible())
    await page.getByRole('button', { name: /^Title/ }).first().click().catch(() => {})
    const title = page.getByLabel(/^Title/).first()
    await title.fill('Synthetic Title')
    await page.screenshot({ path: `${SHOTS}/confirm-linkedin-en-1280.png`, fullPage: true })
    await page.getByRole('button', { name: 'Confirm these details' }).click()
    await page.getByRole('heading', { name: 'Thank you for confirming' }).waitFor({ timeout: 15000 }).catch(async (e) => {
      await page.screenshot({ path: `${SHOTS}/debug-confirm.png`, fullPage: true })
      throw new Error(`not confirmed: ${(await page.locator('[role=alert]').allTextContents()).join(' | ') || e.message}`)
    })
    const paper = paperFor(email)
    const team = authorsOf(paper.id)
    assert.deepStrictEqual(team.map((x) => [x.name, x.linkedin, x.public]), [
      ['Linked Author', 'https://linkedin.com/in/linked-author', true],
      ['Other Person', 'https://www.linkedin.com/in/other-person', false],
    ])
    assert.strictEqual(paper.publication_setting, 'record_abstract', 'independent of the publication permission')
    assert.strictEqual(Number(sql(`select count(*) from researchers r join paper_researchers pr on pr.researcher_id = r.id where pr.paper_id = ${lit(paper.id)} and r.facebook_url is not null`)), 0)
    await page.context().close()
  })

  // ------------------------------------------------------------ layout matrix
  await check('layout: EN and AR at 360, 390, 768, 1280 and 1440 px without horizontal scrolling', async () => {
    for (const locale of ['en', 'ar']) {
      for (const width of [360, 390, 768, 1280, 1440]) {
        const page = await newPage({ locale, width, height: 900 })
        await openForm(page)
        await page.locator('details summary').click()
        await noHorizontalScroll(page)
        if ([360, 1440].includes(width)) await page.screenshot({ path: `${SHOTS}/form-${locale}-${width}.png`, fullPage: true })
        await page.context().close()
      }
    }
  })

  return finish()
}

async function finish() {
  await browser.close()
  // Aborted and fulfilled requests in the failure scenarios log a
  // resource error by design; anything else is a real console error.
  const unexpected = consoleErrors.filter((e) => !/Failed to load resource|net::ERR_CONNECTION_RESET|net::ERR_FAILED|status of 400/.test(e.text))
  if (unexpected.length) {
    console.error('Unexpected console errors:\n' + unexpected.map((e) => `  ${e.url}: ${e.text.replace(/token=[^&\s']+/g, 'token=<redacted>').slice(0, 300)}`).join('\n'))
    failed++
  } else {
    console.log(`ok     no unexpected console errors (${consoleErrors.length} expected resource errors from simulated failures)`)
  }
  fs.rmSync(TMP, { recursive: true, force: true })
  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log(`\nAll browser checks passed (${PHASE}). Screenshots: ${SHOTS}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
