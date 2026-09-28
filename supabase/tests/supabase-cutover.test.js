#!/usr/bin/env node
//
// Migration 0014 (closing the legacy anonymous submission path) against the
// LOCAL Supabase stack: real PostgREST and Storage API, real grants and
// storage policies. Applies 0014 to the local database - run it after
// supabase-local.test.js and the before-cutover browser test, or on a fresh
// stack. Never a hosted project.

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { createClient } = require('@supabase/supabase-js')
const { PDFDocument } = require('pdf-lib')

const ROOT = path.join(__dirname, '../..')
const { handleTerms, handleCreateIntent, handleFinalize } = require(path.join(ROOT, 'lib/submission/acceptanceHandlers'))
const SB_DIR = process.env.SB_DIR || '/var/tmp/sb'
const URL = 'http://127.0.0.1:54321'
const keys = JSON.parse(fs.readFileSync(path.join(SB_DIR, 'keys.json'), 'utf8'))
const opts = { auth: { persistSession: false } }
const service = createClient(URL, keys.service, opts)
const anon = createClient(URL, keys.anon, opts)
const authed = createClient(URL, keys.authenticated, opts)
const MIGRATION = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0014_close_legacy_submission_path.sql'), 'utf8')

function psql(text) {
  try {
    return { out: execFileSync('docker', ['exec', '-i', '-e', 'PGPASSWORD=localtestpw', 'sb-db', 'psql', '-h', 'localhost', '-U', 'supabase_admin', '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: text, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim(), error: null }
  } catch (e) {
    return { out: null, error: String(e.stderr || e.message) }
  }
}
const sql = (t) => { const r = psql(t); if (r.error) throw new Error(r.error); return r.out }

let failed = 0
async function check(name, fn) {
  try {
    await fn()
    console.log(`ok     ${name}`)
  } catch (err) {
    console.error(`FAIL   ${name} — ${err.stack || err.message}`)
    failed++
  }
}

const SECRET = crypto.randomBytes(32).toString('hex')
const ENV = { SUBMISSION_ACCEPTANCE_FLOW: 'enabled', SUBMISSION_TOKEN_SECRET: SECRET, EXTRACTION_MODE: 'manual' }
const quiet = { log() {}, warn() {}, error() {} }
async function pdf() {
  const d = await PDFDocument.create()
  d.addPage().drawText('cutover', { x: 50, y: 700 })
  return Buffer.from(await d.save())
}
const legacyArgs = { p_full_name: 'Legacy', p_email: 'legacy@example.invalid', p_file_path: 'x.pdf', p_permission_to_process: true, p_publication_scope: ['abstract_and_citation'], p_whatsapp_number: null }

async function signedSubmission(role = 'author') {
  sql(`delete from submission_rate_limits; update agreement_versions set active = true;`)
  const terms = await handleTerms({ env: ENV, supabase: service, clientKey: 'k' })
  const bytes = await pdf()
  const r = await handleCreateIntent({
    body: { offerToken: terms.body.offer.token, agreementId: 'submission-terms-2026-09-25-en', accepted: true, publicationSetting: 'record_abstract', claimedRole: role, fullName: 'Cutover', email: 'cutover@example.invalid', ...(role === 'authorized_depositor' ? { authors: ['A. Author'] } : {}), file: { name: 'a.pdf', size: bytes.length, type: 'application/pdf' } },
    env: ENV, supabase: service, storage: service.storage.from('papers'), clientKey: 'k', log: quiet,
  })
  assert.strictEqual(r.status, 201, JSON.stringify(r.body))
  const up = await anon.storage.from('papers').uploadToSignedUrl(r.body.upload.path, r.body.upload.token, new Blob([bytes], { type: 'application/pdf' }))
  assert.strictEqual(up.error, null, 'the browser (anon key) uploads with the signed link')
  const f = await handleFinalize({ body: { intentId: r.body.intentId, intentToken: r.body.intentToken }, env: ENV, supabase: service, storage: service.storage.from('papers'), clientKey: 'k', log: quiet })
  assert.strictEqual(f.status, 200, JSON.stringify(f.body))
  return f.body.confirmationToken
}

async function main() {
  await check('before 0014: the legacy path is open (the state production is in today)', async () => {
    const up = await anon.storage.from('papers').upload(`${crypto.randomUUID()}.pdf`, new Blob([await pdf()], { type: 'application/pdf' }))
    assert.strictEqual(up.error, null)
    assert.strictEqual(sql(`select has_function_privilege('anon', 'submit_paper(text,text,text,boolean,text[],text)', 'execute')`), 't')
  })

  await check('0014 refuses to run while a stray browser-write storage policy would remain, and changes nothing', async () => {
    sql(`create policy "stray upload" on storage.objects for insert to public with check (bucket_id = 'papers')`)
    const r = psql(MIGRATION)
    assert.ok(r.error && /storage policies still allow browser writes/.test(r.error), r.error)
    assert.strictEqual(sql(`select count(*) from pg_policies where policyname = 'anon can upload research files'`), '1', 'rolled back')
    assert.strictEqual(sql(`select has_function_privilege('anon', 'submit_paper(text,text,text,boolean,text[],text)', 'execute')`), 't', 'rolled back')
    sql(`drop policy "stray upload" on storage.objects`)
  })

  await check('0014 applies (twice), closing every submit_paper overload including one granted only to PUBLIC', async () => {
    sql(`create or replace function public.submit_paper(p text) returns void language sql as 'select null'; grant execute on function public.submit_paper(text) to public;`)
    assert.strictEqual(sql(`select has_function_privilege('anon', 'submit_paper(text)', 'execute')`), 't', 'inherited through PUBLIC')
    sql(MIGRATION)
    sql(MIGRATION)
    for (const role of ['anon', 'authenticated']) {
      assert.strictEqual(sql(`select bool_or(has_function_privilege('${role}', p.oid, 'execute')) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = 'submit_paper'`), 'f', role)
    }
    sql(`drop function public.submit_paper(text)`)
  })

  await check('after 0014: anonymous and authenticated direct upload and submit_paper are refused through the real APIs', async () => {
    for (const [who, client] of [['anon', anon], ['authenticated', authed]]) {
      const up = await client.storage.from('papers').upload(`${crypto.randomUUID()}.pdf`, new Blob([await pdf()], { type: 'application/pdf' }))
      assert.ok(up.error, `${who} uploaded directly`)
      const rpc = await client.rpc('submit_paper', legacyArgs)
      assert.ok(rpc.error, `${who} called submit_paper`)
    }
  })

  await check('after 0014: the signed flow still works end to end, for an author and a depositor', async () => {
    const token = await signedSubmission('author')
    const view = await anon.rpc('get_paper_for_confirmation', { p_token: token })
    assert.strictEqual(view.error, null)
    assert.strictEqual(view.data.researchers[0].full_name, 'Cutover')
    const conf = await anon.rpc('confirm_researcher_metadata', { p_token: token, p_researchers: [{ researcher_id: view.data.researchers[0].researcher_id, full_name: 'Cutover' }], p_corrections: { title: 'T' } })
    assert.strictEqual(conf.error, null, 'confirmation still works with the token')
    const dep = await signedSubmission('authorized_depositor')
    const depView = await anon.rpc('get_paper_for_confirmation', { p_token: dep })
    assert.deepStrictEqual(depView.data.researchers.map((r) => r.full_name), ['A. Author'])
  })

  await check('after 0014: a bare paper id still reads nothing; the private bucket stays private', async () => {
    const id = sql(`select id from papers order by created_at desc limit 1`)
    const r = await anon.rpc('get_paper_for_confirmation', { p_token: id })
    assert.strictEqual(r.data, null)
    const path = sql(`select file_path from papers where file_path like 'intents/%' order by created_at desc limit 1`)
    assert.ok((await anon.storage.from('papers').download(path)).error)
  })

  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll cutover checks passed on the local Supabase stack.')
}

main()
