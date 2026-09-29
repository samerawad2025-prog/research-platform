#!/usr/bin/env node
//
// Phase 3 M4 on the LOCAL Supabase stack: real GoTrue-issued tokens against
// the built application (API tier), then real Chromium (UI tier). Never a
// hosted project; synthetic data only; no AI provider is called. Run by
// supabase/tests/run-admin-e2e.sh. Screenshots: $E2E_SHOTS.

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
const SHOTS = process.env.E2E_SHOTS || '/var/tmp/admin-shots'
if (!/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(APP)) throw new Error('local application only')
const keys = JSON.parse(fs.readFileSync(path.join(SB_DIR, 'keys.json'), 'utf8'))
fs.mkdirSync(SHOTS, { recursive: true })
const svc = createClient(SB, keys.service, { auth: { persistSession: false } })
const anon = () => createClient(SB, keys.anon, { auth: { persistSession: false } })

function sql(text) {
  return execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=localtestpw', 'sb-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8' }).trim()
}
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`

let failed = 0
async function check(name, fn) {
  if (process.env.E2E_ONLY && !new RegExp(process.env.E2E_ONLY).test(name)) return
  try { await fn(); console.log(`ok     ${name}`) } catch (err) { console.error(`FAIL   ${name} — ${err.stack || err.message}`); failed++ }
}

const RUN = crypto.randomBytes(3).toString('hex')
const PW = 'Correct-horse-9'
const people = {}
async function makeUser(key) {
  const email = `${key}-${RUN}@example.invalid`
  const { data, error } = await svc.auth.admin.createUser({ email, password: PW, email_confirm: true })
  assert.ok(!error, error?.message)
  const { data: s, error: e2 } = await anon().auth.signInWithPassword({ email, password: PW })
  assert.ok(!e2, e2?.message)
  people[key] = { id: data.user.id, email, token: s.session.access_token }
}
async function call(who, method, p, body) {
  const res = await fetch(`${APP}/api/admin/${p}`, {
    method,
    headers: { ...(who ? { Authorization: `Bearer ${people[who]?.token || who}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  let json = null
  try { json = await res.json() } catch { json = null }
  return { status: res.status, body: json, headers: res.headers }
}

async function pdfBytes(text) {
  const d = await PDFDocument.create()
  d.addPage().drawText(text, { x: 50, y: 700 })
  return Buffer.from(await d.save())
}
const papers = {}
async function seedPaper(key, title, over = {}) {
  const id = crypto.randomUUID(); const res = crypto.randomUUID()
  const bytes = await pdfBytes(`synthetic ${key} ${RUN}`)
  const file = `legacy-${RUN}-${key}.pdf`
  const up = await svc.storage.from('papers').upload(file, bytes, { contentType: 'application/pdf', upsert: false })
  assert.ok(!up.error, up.error?.message)
  sql(`insert into researchers (id, full_name, email) values (${lit(res)}, ${lit('Synthetic Author ' + key)}, ${lit(key + RUN + '@example.invalid')});
       insert into papers (id, file_path, permission_to_process, publication_scope, submitted_by, extraction_status, metadata_confirmed_at,
                           title, abstract, year, university, faculty, degree_type, supervisor_name, document_type, confirmation_token_hash)
       values (${lit(id)}, ${lit(file)}, true, '{abstract_and_citation}', ${lit(res)}, 'completed', ${over.confirmed === false ? 'null' : 'now()'},
               ${lit(title)}, 'A synthetic abstract for local testing.', 2021, ${lit(over.university || 'University of Khartoum')}, 'Faculty of Science', 'MSc', 'Dr Synthetic', 'thesis',
               encode(sha256(${lit('tok-' + key + RUN)}::bytea), 'hex'));
       insert into paper_researchers (paper_id, researcher_id, author_order) values (${lit(id)}, ${lit(res)}, 1);`)
  papers[key] = { id, file, bytes }
}

async function main() {
  for (const k of ['admin', 'vol', 'vol2', 'plain']) await makeUser(k)
  // Re-runnable on the same stack: earlier runs' staff are switched off first
  // (as the database owner; the change is audited like any other).
  sql(`update staff_members set active = false`)
  sql(`select bootstrap_first_administrator(${lit(people.admin.id)})`)
  sql(`update confidentiality_versions set active = (id = 'volunteer-confidentiality-2026-09-29')`)
  await seedPaper('a', `Alpha synthetic study ${RUN}`)
  await seedPaper('b', `Beta unassigned study ${RUN}`)
  await seedPaper('c', `Gamma other institution ${RUN}`, { university: 'Somewhere Else College' })

  // ------------------------------------------------------------ API tier
  await check('api: no token, a garbage token and an ordinary user are refused', async () => {
    assert.strictEqual((await call(null, 'GET', 'queue')).status, 401)
    assert.strictEqual((await call('not-a-token', 'GET', 'queue')).status, 401)
    for (const p of ['me', 'queue', 'staff', `reviews/${papers.a.id}`]) assert.strictEqual((await call('plain', 'GET', p)).status, 403, p)
    const r = await call('plain', 'POST', `reviews/${papers.a.id}/files/access`, {})
    assert.strictEqual(r.status, 403)
  })
  await check('api: responses are never cached or indexed', async () => {
    const r = await call('admin', 'GET', 'queue')
    assert.match(r.headers.get('cache-control') || '', /no-store/)
    assert.match(r.headers.get('x-robots-tag') || '', /noindex/)
  })
  await check('database: browser roles cannot call the review functions directly', async () => {
    for (const c of [anon(), createClient(SB, keys.authenticated, { auth: { persistSession: false } })]) {
      const r = await c.rpc('admin_queue', { p_actor: people.admin.id, p_filters: {} })
      assert.ok(r.error, 'must be refused')
      assert.ok(!r.data)
      const t = await c.from('review_notes').select('*')
      assert.ok(t.error || (t.data || []).length === 0)
    }
  })
  await check('api: a claimed role in the token changes nothing', async () => {
    // A user whose own metadata says administrator is still not staff.
    await svc.auth.admin.updateUserById(people.plain.id, { user_metadata: { role: 'administrator' }, app_metadata: { role: 'administrator' } })
    const { data } = await anon().auth.signInWithPassword({ email: people.plain.email, password: PW })
    assert.strictEqual((await call(data.session.access_token, 'GET', 'queue')).status, 403)
  })
  await check('api: staff management, first-admin bootstrap is not callable from the app', async () => {
    const add = await call('admin', 'POST', 'staff', { email: people.vol.email, role: 'volunteer' })
    assert.strictEqual(add.status, 200, JSON.stringify(add.body))
    await call('admin', 'POST', 'staff', { email: people.vol2.email, role: 'volunteer' })
    assert.strictEqual((await call('vol', 'GET', 'staff')).status, 403, 'a volunteer cannot list staff')
    assert.strictEqual((await call('vol', 'POST', 'staff', { email: people.plain.email, role: 'administrator' })).status, 403)
    const direct = await svc.rpc('bootstrap_first_administrator', { p_user_id: people.plain.id })
    assert.ok(direct.error, 'not executable even by service_role')
  })
  await check('api: a volunteer needs the acknowledgement AND an assignment', async () => {
    assert.strictEqual((await call('admin', 'POST', `reviews/${papers.a.id}/assignments`, { volunteerId: people.vol.id })).status, 201)
    const q = await call('vol', 'GET', 'queue')
    assert.strictEqual(q.status, 403); assert.strictEqual(q.body.reason, 'confidentiality_required')
    assert.strictEqual((await call('vol', 'GET', `reviews/${papers.a.id}`)).status, 403)
    assert.strictEqual((await call('vol', 'POST', `reviews/${papers.a.id}/files/access`, {})).status, 403, 'no file before the acknowledgement')
    const conf = await call('vol', 'GET', 'confidentiality')
    assert.strictEqual(conf.status, 200)
    assert.strictEqual((await call('vol', 'POST', 'confidentiality/acknowledge', { versionId: 'a-version-the-browser-invented', language: 'en' })).status, 409)
    const ack = await call('vol', 'POST', 'confidentiality/acknowledge', { versionId: conf.body.version.id, language: 'en' })
    assert.strictEqual(ack.status, 200, JSON.stringify(ack.body))
    const q2 = await call('vol', 'GET', 'queue')
    assert.strictEqual(q2.status, 200)
    assert.deepStrictEqual(q2.body.items.map((i) => i.paper_id), [papers.a.id])
    assert.strictEqual((await call('vol', 'GET', `reviews/${papers.b.id}`)).status, 403, 'unassigned')
    assert.strictEqual((await call('vol', 'GET', `reviews/${crypto.randomUUID()}`)).status, 403, 'nonexistent looks the same')
    assert.strictEqual((await call('vol2', 'GET', `reviews/${papers.a.id}`)).status, 403, 'not their assignment (and not acknowledged)')
  })
  await check('api: a volunteer sees no contact details, cannot decide, and notes stay private', async () => {
    const d = await call('vol', 'GET', `reviews/${papers.a.id}`)
    assert.strictEqual(d.status, 200)
    assert.strictEqual(d.body.submitter.email, null)
    assert.ok(!JSON.stringify(d.body).includes(`a${RUN}@example.invalid`))
    assert.strictEqual((await call('vol', 'POST', `reviews/${papers.a.id}/decision`, { decision: 'approved', reason: 'x', expectedRevision: d.body.revision })).status, 403)
    assert.strictEqual((await call('vol', 'GET', 'institutions')).status, 200)
    assert.strictEqual((await call('vol', 'POST', `reviews/${papers.a.id}/notes`, { body: 'volunteer private note' })).status, 201)
    assert.strictEqual((await call('vol', 'POST', `reviews/${papers.a.id}/recommendation`, { recommendation: 'approve', reason: 'looks fine' })).status, 201)
    const ad = await call('admin', 'GET', `reviews/${papers.a.id}`)
    assert.ok(ad.body.notes.some((n) => n.body === 'volunteer private note'))
    assert.strictEqual(ad.body.submitter.email, `a${RUN}@example.invalid`)
    assert.strictEqual(ad.body.review.status, 'pending', 'a recommendation changes no status')
  })
  await check('api: file access is authorized, audited and returns a short-lived URL', async () => {
    const r = await call('vol', 'POST', `reviews/${papers.a.id}/files/access`, {})
    assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    const bytes = Buffer.from(await (await fetch(r.body.url)).arrayBuffer())
    assert.ok(bytes.equals(papers.a.bytes))
    assert.strictEqual((await call('vol', 'POST', `reviews/${papers.b.id}/files/access`, {})).status, 403)
    const ev = (await call('admin', 'GET', `reviews/${papers.a.id}`)).body.events
    assert.ok(ev.some((e) => e.action === 'file_accessed'))
  })
  await check('api: approval needs its preconditions; a non-eligible institution is never approvable', async () => {
    let d = (await call('admin', 'GET', `reviews/${papers.c.id}`)).body
    assert.ok(!d.preconditions.ok)
    const ap = await call('admin', 'POST', `reviews/${papers.c.id}/decision`, { decision: 'approved', reason: 'x', expectedRevision: d.revision })
    assert.strictEqual(ap.status, 422); assert.strictEqual(ap.body.reason, 'preconditions_failed')
    const ok = await call('admin', 'POST', `reviews/${papers.c.id}/decision`, { decision: 'reviewed', reason: 'kept private', expectedRevision: d.revision })
    assert.strictEqual(ok.status, 200, JSON.stringify(ok.body))
  })
  await check('api: legacy record: held until determined, then approved, tied to the reviewed content', async () => {
    let d = (await call('admin', 'GET', `reviews/${papers.a.id}`)).body
    assert.strictEqual(d.evidence.setting, null)
    const set = await call('admin', 'POST', `reviews/${papers.a.id}/legacy-setting`, { setting: 'record_abstract', note: 'old form allowed abstract and citation' })
    assert.strictEqual(set.status, 200, JSON.stringify(set.body))
    d = (await call('admin', 'GET', `reviews/${papers.a.id}`)).body
    assert.ok(d.preconditions.ok, JSON.stringify(d.preconditions))
    const ap = await call('admin', 'POST', `reviews/${papers.a.id}/decision`, { decision: 'approved', reason: 'ok', expectedRevision: d.revision })
    assert.strictEqual(ap.status, 200, JSON.stringify(ap.body))
    d = (await call('admin', 'GET', `reviews/${papers.a.id}`)).body
    assert.ok(d.eligibility.review_approved && d.eligibility.record_public)
    assert.ok(!d.eligibility.fulltext_public)
    // The submitter edits after approval: the approval no longer covers it.
    sql(`update papers set title = title || ' (edited)' where id = ${lit(papers.a.id)}`)
    d = (await call('admin', 'GET', `reviews/${papers.a.id}`)).body
    assert.ok(!d.eligibility.review_approved && !d.eligibility.record_public, 'material change must not inherit the approval')
  })
  await check('api: a stale screen is refused and changes nothing', async () => {
    const d = (await call('admin', 'GET', `reviews/${papers.b.id}`)).body
    sql(`update papers set abstract = 'changed by the submitter' where id = ${lit(papers.b.id)}`)
    const r = await call('admin', 'POST', `reviews/${papers.b.id}/decision`, { decision: 'declined', reason: 'x', expectedRevision: d.revision })
    assert.strictEqual(r.status, 409); assert.strictEqual(r.body.reason, 'stale_revision')
    assert.strictEqual((await call('admin', 'GET', `reviews/${papers.b.id}`)).body.review.status, 'pending')
  })
  await check('api: the audit history is append-only, has actors, and no note text', async () => {
    const ev = (await call('admin', 'GET', `reviews/${papers.a.id}`)).body.events
    assert.ok(ev.length > 3 && ev.every((e) => e.at && e.action))
    assert.ok(!JSON.stringify(ev).includes('volunteer private note'))
    let blocked = false
    try { sql(`update admin_audit_events set action = 'x'`) } catch { blocked = true }
    assert.ok(blocked)
  })

  await check('api: staff lookup: non-administrators get one identical refusal whatever account they name', async () => {
    for (const who of ['plain', 'vol']) {
      const seen = new Set()
      for (const body of [{ email: people.admin.email, role: 'administrator' }, { email: `absent-${RUN}@example.invalid`, role: 'administrator' }, { userId: people.admin.id, role: 'volunteer' }, { userId: crypto.randomUUID(), role: 'volunteer' }]) {
        const r = await call(who, 'POST', 'staff', body)
        seen.add(JSON.stringify([r.status, r.body]))
      }
      assert.strictEqual(seen.size, 1, `${who}: ${[...seen]}`)
      assert.match([...seen][0], /^\[403,/)
    }
    assert.strictEqual((await call('admin', 'POST', 'staff', { email: `absent-${RUN}@example.invalid`, role: 'volunteer' })).body.reason, 'user_not_found')
  })
  await check('api: a blocking issue from the assigned volunteer suspends an approval; resolving it does not restore it (fresh re-approval: admin-postgres.test.js)', async () => {
    await seedPaper('d', `Delta issue study ${RUN}`)
    await call('admin', 'POST', `reviews/${papers.d.id}/legacy-setting`, { setting: 'record_abstract', note: 'old form allowed abstract and citation' })
    let d = (await call('admin', 'GET', `reviews/${papers.d.id}`)).body
    assert.strictEqual((await call('admin', 'POST', `reviews/${papers.d.id}/decision`, { decision: 'approved', reason: 'ok', expectedRevision: d.revision })).status, 200)
    assert.strictEqual((await call('admin', 'POST', `reviews/${papers.d.id}/assignments`, { volunteerId: people.vol.id })).status, 201)
    assert.strictEqual((await call('vol', 'POST', `reviews/${papers.d.id}/issues`, { kind: 'privacy', description: 'Signature on the last page.', blocking: true })).status, 201)
    d = (await call('admin', 'GET', `reviews/${papers.d.id}`)).body
    assert.deepStrictEqual([d.states.approval_recorded, d.states.publication_approved, d.eligibility.record_public], [true, false, false])
    const issue = d.issues.find((i) => i.blocking)
    assert.strictEqual((await call('vol', 'POST', `reviews/${papers.d.id}/issues/${issue.id}/resolve`, { resolution: 'x' })).status, 403)
    assert.strictEqual((await call('admin', 'POST', `reviews/${papers.d.id}/issues/${issue.id}/resolve`, { resolution: 'Page replaced.' })).status, 200)
    d = (await call('admin', 'GET', `reviews/${papers.d.id}`)).body
    assert.deepStrictEqual(d.eligibility.reasons, ['blocking_issue_since_approval'])
  })

  // ------------------------------------------------------------- UI tier
  const browser = await chromium.launch()
  const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
  async function open(ctxOpts, lang) {
    const ctx = await browser.newContext({ ...ctxOpts, locale: lang === 'ar' ? 'ar' : 'en-GB' })
    await ctx.addCookies([{ name: 'sarp_lang', value: lang, url: APP }])
    return { ctx, page: await ctx.newPage() }
  }
  async function signIn(page, who) {
    await page.goto(`${APP}/admin`)
    await page.locator('input[type=email]').fill(people[who].email)
    await page.locator('input[type=password]').fill(PW)
    await page.locator('button[type=submit]').click()
  }

  await check('ui: signed-out visitors see only a sign-in form; no data is requested', async () => {
    const { ctx, page } = await open({ viewport: { width: 390, height: 800 } }, 'en')
    await page.goto(`${APP}/admin`)
    await page.locator('input[type=email]').waitFor()
    assert.strictEqual(await page.locator('text=Review queue').count(), 0)
    assert.ok((await overflow(page)) <= 0)
    assert.match((await page.locator('meta[name=robots]').getAttribute('content')) || '', /noindex/)
    await page.screenshot({ path: path.join(SHOTS, 'signin-390-en.png') })
    await ctx.close()
  })
  await check('ui: a wrong password shows one plain message', async () => {
    const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } }, 'en')
    await page.goto(`${APP}/admin`)
    await page.locator('input[type=email]').fill(people.admin.email)
    await page.locator('input[type=password]').fill('wrong-password-1')
    await page.locator('button[type=submit]').click()
    await page.locator('[data-admin-area] [role=alert]').waitFor()
    assert.match(await page.locator('[data-admin-area] [role=alert]').innerText(), /not accepted/)
    await ctx.close()
  })
  await check('ui: an ordinary signed-in user sees the no-access page', async () => {
    const { ctx, page } = await open({ viewport: { width: 1280, height: 800 } }, 'en')
    await signIn(page, 'plain')
    await page.locator('text=No review access').waitFor()
    await ctx.close()
  })
  await check('ui: volunteer (Arabic, phone): gate, keyboard, then only the assigned submission', async () => {
    // vol acknowledged in the API tier; a fresh volunteer shows the gate.
    await call('admin', 'POST', 'staff', { email: people.vol2.email, role: 'volunteer' })
    const { ctx, page } = await open({ viewport: { width: 360, height: 780 } }, 'ar')
    await signIn(page, 'vol2')
    await page.locator('#conf-h').waitFor()
    assert.strictEqual(await page.locator('html').getAttribute('dir'), 'rtl')
    assert.ok((await overflow(page)) <= 0, 'no horizontal scroll on the gate')
    await page.screenshot({ path: path.join(SHOTS, 'gate-360-ar.png') })
    // The text region is reachable and the agree button works by keyboard.
    await page.locator('[role=region][tabindex="0"]').focus()
    await page.keyboard.press('Tab'); await page.keyboard.press('Tab')
    const focused = await page.evaluate(() => document.activeElement?.textContent || '')
    assert.ok(focused.length > 0)
    await page.locator('button', { hasText: 'أوافق' }).click()
    await page.locator('text=قائمة المراجعة').first().waitFor()
    assert.strictEqual(await page.locator('[data-admin-area] li a').count(), 0, 'nothing assigned yet')
    await page.screenshot({ path: path.join(SHOTS, 'queue-empty-360-ar.png') })
    await ctx.close()
  })
  await check('ui: administrator queue: filters, states, English and Arabic, several widths', async () => {
    for (const lang of ['en', 'ar']) {
      for (const w of [360, 390, 768, 1280, 1440]) {
        const { ctx, page } = await open({ viewport: { width: w, height: 900 } }, lang)
        await signIn(page, 'admin')
        await page.locator('[data-admin-area] li a').first().waitFor()
        assert.ok((await page.locator('[data-admin-area] li a').count()) >= 3)
        assert.ok((await overflow(page)) <= 0, `overflow at ${w} ${lang}`)
        if (w === 390 || w === 1280) await page.screenshot({ path: path.join(SHOTS, `queue-${w}-${lang}.png`), fullPage: true })
        await ctx.close()
      }
    }
    const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, 'en')
    await signIn(page, 'admin')
    await page.locator('[data-admin-area] li a').first().waitFor()
    await page.locator('select').first().selectOption('reviewed')
    await page.locator('input[type=search]').fill(RUN)
    await page.locator('button', { hasText: 'Apply filters' }).click()
    await page.locator('text=Showing 1 of 1').waitFor()
    assert.match(await page.locator('[data-admin-area] ul li').first().innerText(), /Gamma/)
    await ctx.close()
  })
  await check('ui: review page: states, checklist, notes, decision reasons, stale refusal, history', async () => {
    const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, 'en')
    await signIn(page, 'admin')
    await page.locator('[data-admin-area] li a', { hasText: `Beta unassigned study ${RUN}` }).click()
    await page.locator('#st-h').waitFor()
    for (const label of ['Submitted', 'Confirmed by the submitter', 'Reviewed', 'Approved for publication']) assert.ok(await page.locator(`[data-section=st-h] >> text=${label}`).count() >= 1, label)
    assert.ok((await overflow(page)) <= 0)
    await page.screenshot({ path: path.join(SHOTS, 'review-1280-en.png'), fullPage: true })
    // A decline needs a reason, and the note says the submitter is not told.
    await page.locator('[data-section=dc-h] select').selectOption('declined')
    assert.ok(await page.locator('[data-section=dc-h] button', { hasText: 'Record decision' }).first().isDisabled())
    // A stale screen: the record changes underneath, then the decision is refused.
    sql(`update papers set abstract = 'changed again while the screen was open' where id = ${lit(papers.b.id)}`)
    await page.locator('[data-section=dc-h] textarea').fill('test reason')
    await page.locator('[data-section=dc-h] button', { hasText: 'Record decision' }).click()
    await page.locator('[data-section=dc-h] [role=alert]').waitFor()
    assert.match(await page.locator('[data-section=dc-h] [role=alert]').innerText(), /changed while you were looking/)
    // Reloaded: decide again on the fresh view.
    await page.locator('[data-section=dc-h] button', { hasText: 'Record decision' }).click()
    await page.locator('[data-section=dc-h] [role=status]').waitFor()
    assert.match(await page.locator('[data-section=dc-h]').innerText(), /NOT been told/)
    assert.match(await page.locator('[data-section=hi-h]').innerText(), /Decision: declined/)
    await ctx.close()
  })
  await check('ui: review page in Arabic on a phone: RTL, no overflow, all sections', async () => {
    const { ctx, page } = await open({ viewport: { width: 390, height: 844 } }, 'ar')
    await signIn(page, 'admin')
    await page.locator('[data-admin-area] li a').first().waitFor()
    await page.locator('[data-admin-area] li a', { hasText: `Alpha synthetic study ${RUN}` }).click()
    await page.locator('#st-h').waitFor()
    assert.strictEqual(await page.locator('html').getAttribute('dir'), 'rtl')
    assert.ok((await overflow(page)) <= 0)
    for (const id of ['#md-h', '#ev-h', '#ck-h', '#dup-h', '#dm-h', '#is-h', '#nt-h', '#bl-h', '#dc-h', '#in-h', '#hi-h']) assert.ok(await page.locator(id).count() === 1, id)
    await page.screenshot({ path: path.join(SHOTS, 'review-390-ar.png'), fullPage: true })
    await ctx.close()
  })
  await check('ui: settings page is for administrators; a volunteer is told so', async () => {
    const { ctx, page } = await open({ viewport: { width: 1280, height: 900 } }, 'en')
    await signIn(page, 'admin')
    await page.locator('[data-admin-area] nav').waitFor()
    await page.goto(`${APP}/admin/settings`)
    await page.locator('#staff-h').waitFor()
    assert.ok((await page.locator('text=University of Khartoum').count()) >= 1)
    await page.screenshot({ path: path.join(SHOTS, 'settings-1280-en.png'), fullPage: true })
    await ctx.close()
    const v = await open({ viewport: { width: 1280, height: 900 } }, 'en')
    await signIn(v.page, 'vol')
    await v.page.locator('[data-admin-area] nav').waitFor()
    await v.page.goto(`${APP}/admin/settings`)
    await v.page.locator('[data-admin-area] [role=alert]').waitFor()
    await v.ctx.close()
  })
  await check('ui: the review page tells a suspended approval on record apart from one in effect', async () => {
    const { ctx, page } = await open({ viewport: { width: 390, height: 844 } }, 'en')
    await signIn(page, 'admin')
    await page.locator('[data-admin-area] nav').waitFor()
    await page.goto(`${APP}/admin/review/${papers.d.id}`)
    await page.locator('#st-h').waitFor()
    const states = await page.locator('[data-section=st-h]').innerText()
    assert.match(states, /An approval is on record\s+Yes/)
    assert.match(states, /Not in effect/)
    assert.match(await page.locator('[data-section=ap-h]').innerText(), /suspended by a blocking issue/)
    assert.match(await page.locator('[data-section=is-h]').innerText(), /must approve again/)
    assert.ok((await overflow(page)) <= 0)
    await page.screenshot({ path: path.join(SHOTS, 'review-suspended-390-en.png'), fullPage: true })
    await ctx.close()
  })
  await browser.close()
}

main().then(() => { console.log(failed ? `\n${failed} FAILED` : '\nall admin e2e checks passed'); process.exit(failed ? 1 : 0) }, (e) => { console.error(e); process.exit(1) })
