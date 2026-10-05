#!/usr/bin/env node
//
// Phase 3 M4 against a REAL, disposable local Postgres (never a Supabase
// project): roles, boundaries, approval preconditions, revision safety,
// audit, institutions, duplicates, legacy handling. The functions are
// called the way the application calls them (as service_role, with the
// acting user as p_actor); the application layer itself is tested in
// scripts/test-admin-handlers.js and supabase/tests/admin-local.test.js.
// Synthetic data only; no network. Run by supabase/tests/run-0012.sh.

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')
const { PDFDocument } = require('pdf-lib')

const ROOT = path.join(__dirname, '../..')
const { makePsql, lit, pgClient, fakeStorage } = require('./pg-adapter')
const { handleTerms, handleCreateIntent, handleFinalize } = require(path.join(ROOT, 'lib/submission/acceptanceHandlers'))
const { handleAdmin } = require(path.join(ROOT, 'lib/admin/handlers'))

const DB = 'm4_admin_test'
const BASE_REF = process.env.BASE_REF || 'origin/research-platform'
const { psql, sqlOk, json } = makePsql(DB)

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

function setup() {
  execFileSync('dropdb', ['--if-exists', DB])
  execFileSync('createdb', [DB])
  const run = (file) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  run(path.join(__dirname, 'supabase-stubs.sql'))
  const tmp = path.join(os.tmpdir(), 'm4-pre-schema.sql')
  fs.writeFileSync(tmp, execFileSync('git', ['show', `${BASE_REF}:supabase/schema.sql`], { cwd: ROOT, encoding: 'utf8' }))
  run(tmp)
  for (const m of ['0011_manual_entry', '0012_submission_acceptance', '0013_linkedin_visibility_declared_authors', '0015_admin_review', '0018_ai_processing_agreement', '0019_gemini_free_tier_agreement', '0020_free_tier_full_document_agreement']) {
    run(path.join(ROOT, 'supabase/migrations', `${m}.sql`))
  }
  run(path.join(ROOT, 'supabase/migrations/0015_admin_review.sql')) // idempotent
}

const uid = () => crypto.randomUUID()
const A = uid() // administrator (bootstrap)
const A2 = uid() // second administrator
const V1 = uid()
const V2 = uid()
const U = uid() // an ordinary authenticated user, not staff
const GHOST = uid() // not even in auth.users
const UNCONFIRMED = uid()

const storage = fakeStorage()
const supabase = pgClient({ psql }, { storage })
const rpc = async (name, args) => supabase.rpc(name, args)
// Success unwrapped, or the error code an application would map.
async function call(name, args) {
  const { data, error } = await rpc(name, args)
  if (error) return { error: (/admin:([a-z_]+)/.exec(error.message) || [])[1] || error.message }
  return data
}
const ok = async (name, args) => {
  const r = await call(name, args)
  assert.ok(!r?.error && r?.ok !== false, `${name}: ${JSON.stringify(r)}`)
  return r
}

let n = 0
async function pdf(text) {
  const d = await PDFDocument.create()
  d.addPage().drawText(text || `synthetic ${++n}`, { x: 50, y: 700 })
  return Buffer.from(await d.save())
}

// A real new-path submission, taken through the acceptance flow and then
// confirmed by its submitter with the private link, like production.
async function newPathPaper(o = {}) {
  const role = o.role || 'author'
  const bytes = o.bytes || (await pdf())
  const terms = await handleTerms({ env: ENV, supabase, clientKey: `k${++n}` })
  const r = await handleCreateIntent({
    body: {
      offerToken: terms.body.offer.token, agreementId: 'submission-terms-2026-09-25-en', accepted: true,
      publicationSetting: o.setting || 'record_abstract', claimedRole: role, processingChoice: 'manual',
      fullName: o.fullName || 'Synthetic Submitter', email: o.email || `s${n}@example.invalid`,
      ...(role === 'authorized_depositor' ? { authors: o.authors || ['Declared Author One', 'Declared Author Two'] } : {}),
      file: { name: 'a.pdf', size: bytes.length, type: 'application/pdf' },
    },
    env: ENV, supabase, storage, clientKey: `k${++n}`, log: quiet,
  })
  assert.strictEqual(r.status, 201, JSON.stringify(r.body))
  storage.uploadWithToken(r.body.upload.path, r.body.upload.token, bytes)
  const f = await handleFinalize({ body: { intentId: r.body.intentId, intentToken: r.body.intentToken }, env: ENV, supabase, storage, clientKey: `k${++n}`, log: quiet })
  assert.strictEqual(f.status, 200, JSON.stringify(f.body))
  const token = f.body.confirmationToken
  const paperId = sqlOk(`select id from papers where submission_acceptance_id = ${lit(r.body.intentId)}`)
  if (o.confirm !== false) confirmMetadata(token, o.meta || {}, o.researchers)
  return { paperId, token, bytes, path: r.body.upload.path }
}

const GOOD_META = () => ({
  title: 'Mobile Banking and Financial Inclusion in Khartoum State', abstract: 'A study of how small enterprises adopt mobile banking.',
  year: '2023', university: 'University of Khartoum', faculty: 'Management Studies', degree_type: 'Bachelor', supervisor_name: 'Dr. Example',
})
function confirmMetadata(token, meta, researchers) {
  const view = json(`select get_paper_for_confirmation(${lit(token)})`)
  const list = researchers || view.researchers.map((x) => ({ researcher_id: x.researcher_id, full_name: x.full_name, author_order: x.author_order }))
  const merged = { ...GOOD_META(), ...meta }
  for (const k of Object.keys(merged)) if (merged[k] === undefined) delete merged[k]
  json(`select confirm_researcher_metadata(${lit(token)}, ${lit(list)}, ${lit(merged)})`)
}

// A record from before the acceptance flow: no acceptance, only the old
// checkboxes. Confirmed, with the same good metadata.
let legacyN = 0
function legacyPaper(scope, meta = {}) {
  const id = uid()
  const res = uid()
  const m = { ...GOOD_META(), ...meta }
  sqlOk(`insert into researchers (id, full_name, email) values (${lit(res)}, 'Legacy Author ${++legacyN}', 'legacy${legacyN}@example.invalid');
         insert into papers (id, file_path, permission_to_process, publication_scope, submitted_by, extraction_status, metadata_confirmed_at,
                             title, abstract, year, university, faculty, degree_type, supervisor_name, document_type, confirmation_token_hash)
         values (${lit(id)}, 'legacy-${legacyN}.pdf', true, ${lit(`{${scope.join(',')}}`)}, ${lit(res)}, 'completed', now(),
                 ${lit(m.title)}, ${lit(m.abstract)}, ${m.year ? Number(m.year) : 'null'}, ${lit(m.university)}, ${lit(m.faculty)}, ${lit(m.degree_type)}, ${lit(m.supervisor_name)}, 'thesis',
                 encode(sha256(${lit('legacy-token-' + legacyN)}::bytea), 'hex'));
         insert into paper_researchers (paper_id, researcher_id, author_order) values (${lit(id)}, ${lit(res)}, 1);`)
  return id
}

const detail = (actor, paper) => call('admin_review_detail', { p_actor: actor, p_paper: paper })
const decide = (paper, decision, over = {}) => call('admin_decide', { p_actor: A, p_paper: paper, p_decision: decision, p_reason: over.reason ?? 'checked', p_expected_revision: over.revision, p_dissemination: over.dissemination ?? null })
async function approve(paper, over = {}) {
  const d = await detail(A, paper)
  return decide(paper, 'approved', { ...over, revision: over.revision ?? d.revision })
}
const eligibility = (paper) => json(`select publication_eligibility(${lit(paper)})`)
const events = (paper) => json(`select coalesce(json_agg(e order by id), '[]') from (select * from admin_audit_events where paper_id = ${lit(paper)}) e`)

async function main() {
  setup()
  sqlOk(`update agreement_versions set active = true`)
  for (const [id, email, confirmed] of [[A, 'admin@example.invalid', true], [A2, 'admin2@example.invalid', true], [V1, 'vol1@example.invalid', true], [V2, 'vol2@example.invalid', true],
                                          [U, 'user@example.invalid', true], [UNCONFIRMED, 'unconfirmed@example.invalid', false]]) {
    sqlOk(`insert into auth.users (id, email, email_confirmed_at) values (${lit(id)}, ${lit(email)}, ${confirmed ? 'now()' : 'null'})`)
  }
  const allPapers = () => json(`select coalesce(json_agg(to_jsonb(p) order by id), '[]') from papers p`)

  // ------------------------------------------------------------ bootstrap and roles
  await check('seed: one eligible institution (University of Khartoum) with its 21 directory units, no Arabic invented, full text restricted, nothing active', async () => {
    assert.deepStrictEqual(json(`select json_agg(slug) from institutions where public_collection_eligible`), ['university-of-khartoum'])
    assert.strictEqual(Number(sqlOk('select count(*) from institutions')), 1)
    // The 21 units of the official directory as recorded in the founder's review.
    const units = json(`select json_agg(json_build_object('kind', kind, 'name_en', name_en, 'name_ar', name_ar, 'inst', institution_id, 'v', verification, 'src', source_url, 'on', source_retrieved_on) order by name_en) from academic_units`)
    const uofk = sqlOk(`select id from institutions where slug = 'university-of-khartoum'`)
    assert.strictEqual(units.length, 21)
    assert.ok(units.every((u) => u.inst === uofk && u.name_ar === null && u.v === 'verified' && u.src === 'https://uofk.edu/index.php/faculties' && u.on === '2026-09-30'))
    assert.deepStrictEqual(units.filter((u) => u.kind === 'school').map((u) => u.name_en), ['School of Management Studies'])
    assert.strictEqual(new Set(units.map((u) => u.name_en.toLowerCase())).size, 21)
    assert.strictEqual(sqlOk(`select active from release_restrictions where key = 'fulltext_legal_advice'`), 't')
    assert.strictEqual(Number(sqlOk('select count(*) from confidentiality_versions where active')), 0)
    assert.strictEqual(Number(sqlOk('select count(*) from staff_members')), 0, 'no privileged account exists until someone creates one')
    const aliases = json(`select json_agg(alias order by alias) from institution_aliases`)
    assert.ok(aliases.includes('جامعة الخرطوم') && aliases.includes('University of Khartoum'))
  })

  await check('bootstrap: the first administrator needs a confirmed Auth user id, only the owner can run it, and it works once', async () => {
    for (const role of ['anon', 'authenticated', 'service_role']) {
      assert.ok(psql(`set role ${role}; select bootstrap_first_administrator(${lit(A)})`).error, `${role} could bootstrap`)
    }
    assert.ok(psql(`select bootstrap_first_administrator(${lit(GHOST)})`).error, 'an id that is not an Auth user')
    assert.ok(psql(`select bootstrap_first_administrator(${lit(UNCONFIRMED)})`).error, 'an unconfirmed account')
    sqlOk(`select bootstrap_first_administrator(${lit(A)})`)
    assert.strictEqual(sqlOk(`select role || ':' || active from staff_members where user_id = ${lit(A)}`), 'administrator:true')
    const second = psql(`select bootstrap_first_administrator(${lit(A2)})`)
    assert.ok(second.error && /already exists/.test(second.error.message))
    const ev = json(`select json_agg(e) from admin_audit_events e where action = 'staff_insert'`)
    assert.ok(ev[0].actor_role.startsWith('database:'), 'a manual SQL grant is audited as the database role')
  })

  await check('staff: only an administrator can add staff, only for a confirmed Auth user, and the last administrator cannot be removed', async () => {
    assert.strictEqual((await call('admin_set_staff', { p_actor: U, p_user: V1, p_role: 'volunteer', p_active: true })).error, 'forbidden')
    assert.strictEqual((await call('admin_set_staff', { p_actor: A, p_user: GHOST, p_role: 'volunteer', p_active: true })).error, 'user_not_found')
    assert.strictEqual((await call('admin_set_staff', { p_actor: A, p_user: UNCONFIRMED, p_role: 'volunteer', p_active: true })).error, 'user_unconfirmed')
    assert.strictEqual((await call('admin_set_staff', { p_actor: A, p_user: V1, p_role: 'owner', p_active: true })).error, 'invalid_input')
    await ok('admin_set_staff', { p_actor: A, p_user: V1, p_role: 'volunteer', p_active: true })
    await ok('admin_set_staff', { p_actor: A, p_user: V2, p_role: 'volunteer', p_active: true })
    await ok('admin_set_staff', { p_actor: A, p_user: A2, p_role: 'administrator', p_active: true })
    assert.strictEqual((await call('admin_set_staff', { p_actor: V1, p_user: V2, p_role: 'administrator', p_active: true })).error, 'forbidden', 'a volunteer cannot promote anyone')
    assert.strictEqual((await call('admin_set_staff', { p_actor: V1, p_user: V1, p_role: 'administrator', p_active: true })).error, 'forbidden', 'nor themselves')
    // With two administrators, one may deactivate the other; the last cannot go.
    await ok('admin_set_staff', { p_actor: A, p_user: A2, p_role: 'administrator', p_active: false })
    const last = await call('admin_set_staff', { p_actor: A, p_user: A, p_role: 'administrator', p_active: false })
    assert.strictEqual(last.error, 'last_administrator')
    assert.strictEqual(sqlOk(`select active from staff_members where user_id = ${lit(A)}`), 't', 'unchanged')
    await ok('admin_set_staff', { p_actor: A, p_user: A2, p_role: 'administrator', p_active: true })
    const audited = json(`select json_agg(e order by id) from admin_audit_events e where action like 'staff_%'`)
    assert.ok(audited.some((e) => e.actor_id === A && e.detail.user_id === V1), 'the acting administrator is on the event')
    // A deactivated administrator has no authority.
    await ok('admin_set_staff', { p_actor: A, p_user: A2, p_role: 'administrator', p_active: false })
    assert.strictEqual((await call('admin_queue', { p_actor: A2 })).error, 'forbidden')
    await ok('admin_set_staff', { p_actor: A, p_user: A2, p_role: 'administrator', p_active: true })
  })

  const P1 = await newPathPaper({ fullName: 'Sara Ahmed', email: 'sara@example.invalid', meta: { title: 'Alpha Study of Small Enterprise Finance', year: '2023' } })
  const P2 = await newPathPaper({ meta: { title: 'Beta Analysis of Rural Credit Markets', year: '2022' } })

  await check('every API function refuses a user who is not staff, an unknown user and no user', async () => {
    const calls = [
      ['admin_context', { p_actor: U }], ['admin_queue', { p_actor: U }], ['admin_review_detail', { p_actor: U, p_paper: P1.paperId }],
      ['admin_decide', { p_actor: U, p_paper: P1.paperId, p_decision: 'declined', p_reason: 'x', p_expected_revision: 'x' }],
      ['admin_add_note', { p_actor: U, p_paper: P1.paperId, p_body: 'x' }], ['admin_recommend', { p_actor: U, p_paper: P1.paperId, p_recommendation: 'hold', p_reason: 'x' }],
      ['admin_raise_issue', { p_actor: U, p_paper: P1.paperId, p_kind: 'other', p_description: 'x', p_blocking: true }],
      ['admin_assign', { p_actor: U, p_paper: P1.paperId, p_volunteer: V1 }], ['admin_list_staff', { p_actor: U }],
      ['admin_set_paper_institution', { p_actor: U, p_paper: P1.paperId, p_institution: null, p_unit: null, p_none: true }],
      ['admin_set_legacy_setting', { p_actor: U, p_paper: P1.paperId, p_setting: 'hold', p_note: 'x' }],
      ['admin_record_authority', { p_actor: U, p_paper: P1.paperId, p_verified: true, p_note: 'x' }],
      ['admin_set_embargo', { p_actor: U, p_paper: P1.paperId, p_until: '2030-01-01', p_note: 'x' }],
      ['admin_list_institutions', { p_actor: U }], ['admin_create_institution', { p_actor: U, p: { slug: 'x-y', name_en: 'X' } }],
      ['admin_register_original', { p_actor: U, p_paper: P1.paperId, p_sha256: 'a'.repeat(64), p_size: 10 }],
      ['admin_document_access', { p_actor: U, p_paper: P1.paperId, p_version: null }], ['admin_eligibility_preview', { p_actor: U, p_paper: P1.paperId }],
      ['admin_acknowledge_confidentiality', { p_actor: U, p_language: 'en', p_sha256: 'a'.repeat(64) }],
    ]
    for (const actor of [U, GHOST, null]) {
      for (const [fn, args] of calls) {
        const res = await call(fn, { ...args, p_actor: actor })
        assert.strictEqual(res.error, 'forbidden', `${fn} as ${actor === null ? 'nobody' : actor === U ? 'a non-staff user' : 'an unknown user'}: ${JSON.stringify(res)}`)
      }
    }
    assert.strictEqual(Number(sqlOk('select count(*) from review_notes')), 0)
    assert.strictEqual(Number(sqlOk(`select count(*) from admin_audit_events where action in ('note_added','decision:declined','volunteer_assigned')`)), 0, 'nothing was written')
  })

  await check('anon and authenticated (the browser roles) can run no function and read no table of the review layer', async () => {
    const fns = json(`select json_agg(p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and (p.proname like 'admin\\_%' or p.proname like 'review\\_%' or p.proname in ('publication_eligibility', 'normalize_name_text', 'token_jaccard', 'title_tokens', 'bootstrap_first_administrator'))`)
    assert.ok(fns.length >= 40, `found ${fns.length} functions`)
    for (const role of ['anon', 'authenticated']) {
      for (const f of fns) {
        assert.strictEqual(sqlOk(`select has_function_privilege('${role}', '${f}', 'execute')`), 'f', `${role} can execute ${f}`)
      }
      for (const t of ['staff_members', 'confidentiality_versions', 'confidentiality_acknowledgements', 'review_assignments', 'institutions', 'institution_aliases',
                       'academic_units', 'academic_unit_aliases', 'release_restrictions', 'paper_reviews', 'review_notes', 'review_issues', 'document_versions',
                       'review_approvals', 'admin_audit_events']) {
        assert.ok(psql(`set role ${role}; select * from ${t} limit 1`).error, `${role} could read ${t}`)
        assert.ok(psql(`set role ${role}; delete from ${t}`).error, `${role} could delete from ${t}`)
      }
    }
    // Internal helpers are not even callable by the server role; only the API is.
    for (const f of ['admin_log(uuid, uuid, text, text, jsonb)', 'admin_require_role(uuid, text[])', 'admin_ensure_review(uuid)', 'review_revision(uuid)', 'bootstrap_first_administrator(uuid)']) {
      assert.strictEqual(sqlOk(`select has_function_privilege('service_role', '${f}', 'execute')`), 'f', `service_role can execute ${f}`)
    }
    assert.strictEqual(sqlOk(`select has_function_privilege('service_role', 'admin_decide(uuid, uuid, text, text, text, uuid)', 'execute')`), 't')
    assert.strictEqual(sqlOk(`select has_function_privilege('service_role', 'publication_eligibility(uuid)', 'execute')`), 't')
  })

  // ------------------------------------------------------------ volunteers
  await check('volunteer: nothing until the founder activates a confidentiality text, the volunteer acknowledges it, and the submission is assigned', async () => {
    assert.strictEqual((await call('admin_queue', { p_actor: V1 })).error, 'confidentiality_required')
    await ok('admin_assign', { p_actor: A, p_paper: P1.paperId, p_volunteer: V1 })
    assert.strictEqual((await detail(V1, P1.paperId)).error, 'confidentiality_required', 'assigned, but no text is active')
    const noVersion = await call('admin_acknowledge_confidentiality', { p_actor: V1, p_language: 'en', p_sha256: 'a'.repeat(64) })
    assert.strictEqual(noVersion.error, 'no_active_version')
    // The founder activates the version (SQL editor; audited by nothing here, it is a manual step).
    sqlOk(`update confidentiality_versions set active = true where id = 'volunteer-confidentiality-2026-09-29'`)
    assert.strictEqual((await call('admin_acknowledge_confidentiality', { p_actor: V1, p_language: 'en', p_sha256: 'b'.repeat(64) })).error, 'text_mismatch')
    assert.strictEqual((await call('admin_acknowledge_confidentiality', { p_actor: V1, p_language: 'fr', p_sha256: 'b'.repeat(64) })).error, 'text_mismatch')
    assert.strictEqual((await detail(V1, P1.paperId)).error, 'confidentiality_required', 'a wrong acknowledgement grants nothing')
    const enHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'docs/legal/volunteer-confidentiality.en.md'))).digest('hex')
    const arHash = crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'docs/legal/volunteer-confidentiality.ar.md'))).digest('hex')
    assert.strictEqual(sqlOk(`select sha256_en || sha256_ar from confidentiality_versions where active`), enHash + arHash, 'the seeded hashes are the hashes of the files')
    await ok('admin_acknowledge_confidentiality', { p_actor: V1, p_language: 'en', p_sha256: enHash })
    await ok('admin_acknowledge_confidentiality', { p_actor: V2, p_language: 'ar', p_sha256: arHash })
    const rec = json(`select to_jsonb(a) from confidentiality_acknowledgements a where user_id = ${lit(V1)}`)
    assert.strictEqual(rec.version_id, 'volunteer-confidentiality-2026-09-29')
    assert.strictEqual(rec.text_sha256, enHash)
    assert.ok(rec.acknowledged_at, 'the date is recorded')
    assert.ok(psql(`update confidentiality_acknowledgements set language = 'ar'`).error, 'append-only')
    assert.ok((await detail(V1, P1.paperId)).revision)
  })

  await check('volunteer: only assigned submissions, no contact details, no unrelated private submission, no path to a file of another', async () => {
    const d = await detail(V1, P1.paperId)
    assert.strictEqual(d.viewer_role, 'volunteer')
    assert.strictEqual(d.submitter.name, null); assert.strictEqual(d.submitter.email, null); assert.strictEqual(d.submitter.whatsapp_number, null)
    assert.strictEqual(d.assignments, null)
    // An author's name is part of the record; the submitter's email and number are not.
    assert.ok(!JSON.stringify(d).includes('sara@example.invalid'), 'the submitter\'s contact details are nowhere in a volunteer\'s view')
    assert.ok(d.authors.some((x) => x.name === 'Sara Ahmed'), 'listed as an author, as she declared')
    assert.strictEqual(d.submitter.claimed_role, 'author', 'the claimed role and acceptance evidence are shown')
    assert.strictEqual(d.acceptance.agreement_language, 'en')
    // An unassigned submission and a nonexistent one look the same.
    assert.strictEqual((await detail(V1, P2.paperId)).error, 'forbidden')
    assert.strictEqual((await detail(V1, uid())).error, 'forbidden')
    assert.strictEqual((await call('admin_document_access', { p_actor: V1, p_paper: P2.paperId, p_version: null })).error, 'forbidden')
    assert.strictEqual((await call('admin_add_note', { p_actor: V1, p_paper: P2.paperId, p_body: 'x' })).error, 'forbidden')
    // V2 acknowledged but has no assignment.
    assert.strictEqual((await detail(V2, P1.paperId)).error, 'forbidden')
    const q1 = await call('admin_queue', { p_actor: V1 })
    assert.deepStrictEqual(q1.items.map((i) => i.paper_id), [P1.paperId])
    assert.strictEqual((await call('admin_queue', { p_actor: V2 })).items.length, 0)
    assert.strictEqual((await call('admin_queue', { p_actor: V1, p_filters: { mine: false } })).items.length, 1, 'a volunteer cannot widen the queue')
    const qa = await call('admin_queue', { p_actor: A })
    assert.ok(qa.items.length >= 2)
    // Administrators see the contact details; an unknown paper is a plain not_found for them.
    const da = await detail(A, P1.paperId)
    assert.strictEqual(da.submitter.email, 'sara@example.invalid')
    assert.strictEqual((await detail(A, uid())).error, 'not_found')
  })

  await check('volunteer: can prepare a recommendation, notes, issues and document proposals, but cannot decide, assign, map, verify, embargo or change institutions', async () => {
    const forbidden = [
      ['admin_decide', { p_actor: V1, p_paper: P1.paperId, p_decision: 'approved', p_reason: 'x', p_expected_revision: (await detail(V1, P1.paperId)).revision }],
      ['admin_decide', { p_actor: V1, p_paper: P1.paperId, p_decision: 'withdrawn', p_reason: 'x', p_expected_revision: null }],
      ['admin_assign', { p_actor: V1, p_paper: P1.paperId, p_volunteer: V1 }], ['admin_unassign', { p_actor: V1, p_paper: P1.paperId, p_volunteer: V1 }],
      ['admin_set_paper_institution', { p_actor: V1, p_paper: P1.paperId, p_institution: null, p_unit: null, p_none: true }],
      ['admin_set_legacy_setting', { p_actor: V1, p_paper: P1.paperId, p_setting: 'hold', p_note: 'x' }],
      ['admin_record_authority', { p_actor: V1, p_paper: P1.paperId, p_verified: true, p_note: 'x' }],
      ['admin_set_embargo', { p_actor: V1, p_paper: P1.paperId, p_until: '2030-01-01', p_note: 'x' }],
      ['admin_create_institution', { p_actor: V1, p: { slug: 'v-inst', name_en: 'V' } }],
      ['admin_set_institution_eligibility', { p_actor: V1, p_institution: sqlOk(`select id from institutions limit 1`), p_eligible: true, p_note: 'x' }],
      ['admin_add_institution_alias', { p_actor: V1, p_institution: sqlOk(`select id from institutions limit 1`), p_alias: 'x', p_language: 'en' }],
      ['admin_list_staff', { p_actor: V1 }], ['admin_eligibility_preview', { p_actor: V1, p_paper: P1.paperId }],
      ['admin_withdraw_document', { p_actor: V1, p_version: uid(), p_reason: 'x' }],
      ['admin_resolve_issue', { p_actor: V1, p_paper: P1.paperId, p_issue: uid(), p_resolution: 'x' }],
    ]
    for (const [fn, args] of forbidden) assert.strictEqual((await call(fn, args)).error, 'forbidden', fn)
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(P1.paperId)}`), 'pending', 'status unchanged')
    await ok('admin_add_note', { p_actor: V1, p_paper: P1.paperId, p_body: 'PRIVATE volunteer note: abstract looks thin.' })
    await ok('admin_recommend', { p_actor: V1, p_paper: P1.paperId, p_recommendation: 'needs_changes', p_reason: 'Abstract is short.' })
    await ok('admin_raise_issue', { p_actor: V1, p_paper: P1.paperId, p_kind: 'metadata', p_description: 'Check the year.', p_blocking: false })
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(P1.paperId)}`), 'pending', 'a recommendation never changes the status')
    assert.strictEqual((await call('admin_recommend', { p_actor: V1, p_paper: P1.paperId, p_recommendation: 'publish-now', p_reason: 'x' })).error, 'invalid_input')
    // The note body is private: it is in review_notes, not in the audit log.
    const log = JSON.stringify(events(P1.paperId))
    assert.ok(!log.includes('PRIVATE volunteer note'), 'note text is not copied into the audit log')
    assert.ok(log.includes('note_added') && log.includes('recommendation'))
    // The administrator sees the note and the recommendation.
    const da = await detail(A, P1.paperId)
    assert.ok(da.notes.some((x) => x.body.startsWith('PRIVATE volunteer note') && x.author_role === 'volunteer'))
  })

  await check('volunteer: ending an assignment ends access; duplicates on other submissions are counted, not named', async () => {
    const twin = await newPathPaper({ bytes: P1.bytes, meta: { title: 'Alpha Study of Small Enterprise Finance', year: '2023' } })
    const dV = await detail(V1, P1.paperId)
    assert.strictEqual(dV.duplicates.items.length, 0)
    assert.ok(dV.duplicates.hidden_count >= 1, 'the twin exists but is not assigned to this volunteer')
    assert.ok(!JSON.stringify(dV).includes(twin.paperId), 'its id never appears')
    const dA = await detail(A, P1.paperId)
    const hit = dA.duplicates.items.find((x) => x.paper_id === twin.paperId)
    assert.ok(hit && hit.kind === 'same_file' && hit.score === 1)
    await ok('admin_assign', { p_actor: A, p_paper: twin.paperId, p_volunteer: V1 })
    assert.ok((await detail(V1, P1.paperId)).duplicates.items.some((x) => x.paper_id === twin.paperId), 'visible once also assigned')
    await ok('admin_unassign', { p_actor: A, p_paper: twin.paperId, p_volunteer: V1 })
    await ok('admin_unassign', { p_actor: A, p_paper: P1.paperId, p_volunteer: V1 })
    assert.strictEqual((await detail(V1, P1.paperId)).error, 'forbidden')
    await ok('admin_assign', { p_actor: A, p_paper: P1.paperId, p_volunteer: V1 })
  })

  // ------------------------------------------------------------ minimum metadata
  await check('minimum metadata: one title, one author, a year, one abstract, confirmed; Arabic-only and English-only both pass; nothing is filled in', async () => {
    const mk = async (meta, researchers) => (await newPathPaper({ meta, researchers })).paperId
    const missing = async (id) => json(`select review_metadata_check(${lit(id)})`)
    const arabicOnly = await mk({ title: undefined, abstract: undefined })
    sqlOk(`update papers set title = null, title_ar = 'دراسة عن التمويل الأصغر في الخرطوم', abstract = null, abstract_ar = 'ملخص عن الدراسة' where id = ${lit(arabicOnly)}`)
    assert.deepStrictEqual(await missing(arabicOnly), { ok: true, missing: [], advisory: (await missing(arabicOnly)).advisory })
    assert.ok((await missing(arabicOnly)).advisory.includes('document_type'), 'advisory, not blocking')
    const englishOnly = await mk({})
    assert.strictEqual((await missing(englishOnly)).ok, true)
    for (const [label, sql, expected] of [
      ['no title', `title = null, title_ar = '  '`, 'title'], ['no abstract', `abstract = null, abstract_ar = ''`, 'abstract'],
      ['no year', `year = null`, 'year'], ['year out of range', `year = 1800`, 'year'], ['not research', `document_type = 'not_research'`, 'document_type_not_research'],
      ['not confirmed', `metadata_confirmed_at = null`, 'confirmed'],
    ]) {
      const id = await mk({})
      sqlOk(`update papers set ${sql} where id = ${lit(id)}`)
      const r = await missing(id)
      assert.strictEqual(r.ok, false, label)
      assert.ok(r.missing.includes(expected), `${label}: ${JSON.stringify(r)}`)
    }
    const noAuthor = await mk({})
    sqlOk(`delete from paper_reviews where paper_id = ${lit(noAuthor)}; delete from paper_researchers where paper_id = ${lit(noAuthor)}`)
    assert.ok((await missing(noAuthor)).missing.includes('authors'))
    const thesis = await mk({ supervisor_name: '', degree_type: '' })
    sqlOk(`update papers set document_type = 'thesis', supervisor_name = null, degree_type = null where id = ${lit(thesis)}`)
    assert.strictEqual((await missing(thesis)).ok, true, 'supervisor and degree are advisory')
    assert.deepStrictEqual((await missing(thesis)).advisory.filter((x) => ['supervisor_name', 'degree_type'].includes(x)).sort(), ['degree_type', 'supervisor_name'])
  })

  // ------------------------------------------------------------ institutions
  await check('institution mapping: exact alias only; ambiguity, partial text and other institutions are left for a reviewer; a reviewer\'s choice is never overwritten', async () => {
    const exact = (await newPathPaper({ meta: { university: 'university of khartoum' } })).paperId
    const arabic = (await newPathPaper({ meta: { university: 'جامعة الخرطوم' } })).paperId
    const partial = (await newPathPaper({ meta: { university: 'University of Khartoum, School of Management Studies' } })).paperId
    const other = (await newPathPaper({ meta: { university: 'Some Other University' } })).paperId
    const none = (await newPathPaper({ meta: { university: undefined } })).paperId
    await call('admin_queue', { p_actor: A })
    const inst = (id) => json(`select review_institution_state(${lit(id)})`)
    assert.strictEqual(inst(exact).basis, 'alias_exact'); assert.strictEqual(inst(exact).name_en, 'University of Khartoum')
    assert.strictEqual(inst(arabic).basis, 'alias_exact', 'the Arabic name matches')
    for (const id of [partial, other, none]) assert.strictEqual(inst(id).institution_id, null, 'left for a reviewer')
    // A second institution that shares an alias makes that text ambiguous.
    const b = await ok('admin_create_institution', { p_actor: A, p: { slug: 'khartoum-college', name_en: 'Khartoum College', kind: 'other' } })
    assert.strictEqual(sqlOk(`select public_collection_eligible from institutions where id = ${lit(b.id)}`), 'f', 'a new institution is never eligible')
    await ok('admin_add_institution_alias', { p_actor: A, p_institution: b.id, p_alias: 'UofK', p_language: 'en' })
    const shared = (await newPathPaper({ meta: { university: 'UofK' } })).paperId
    await call('admin_queue', { p_actor: A })
    assert.strictEqual(inst(shared).institution_id, null, 'an alias two institutions share is not auto-assigned to either')
    // A reviewer resolves it, and a later run never overwrites the choice.
    await ok('admin_set_paper_institution', { p_actor: A, p_paper: shared, p_institution: sqlOk(`select id from institutions where slug = 'university-of-khartoum'`), p_unit: null })
    await ok('admin_set_paper_institution', { p_actor: A, p_paper: exact, p_institution: b.id, p_unit: null })
    await call('admin_queue', { p_actor: A })
    assert.strictEqual(inst(exact).name_en, 'Khartoum College'); assert.strictEqual(inst(exact).basis, 'reviewer')
    await ok('admin_set_paper_institution', { p_actor: A, p_paper: none, p_institution: null, p_unit: null, p_none: true })
    assert.strictEqual(inst(none).basis, 'reviewer_none', 'independent researcher: recorded, never eligible')
    const filtered = await call('admin_queue', { p_actor: A, p_filters: { institution: 'unresolved' } })
    assert.ok(filtered.items.every((i) => i.institution.id === null))
    assert.ok(filtered.items.some((i) => i.paper_id === partial))
    const byInst = await call('admin_queue', { p_actor: A, p_filters: { institution: b.id } })
    assert.deepStrictEqual(byInst.items.map((i) => i.paper_id), [exact])
    // Free text is never altered.
    assert.strictEqual(sqlOk(`select university from papers where id = ${lit(partial)}`), 'University of Khartoum, School of Management Studies')
  })

  await check('academic units: entered by a person, unverified until a source page and date are recorded, never auto-matched while unverified, always within their institution', async () => {
    const uofk = sqlOk(`select id from institutions where slug = 'university-of-khartoum'`)
    const other = sqlOk(`select id from institutions where slug = 'khartoum-college'`)
    const unit = await ok('admin_add_unit', { p_actor: A, p: { institution_id: uofk, kind: 'faculty', name_en: 'Test Faculty of Examples' } })
    assert.strictEqual(sqlOk(`select verification from academic_units where id = ${lit(unit.id)}`), 'unverified')
    assert.strictEqual((await call('admin_add_unit', { p_actor: A, p: { institution_id: uofk, kind: 'faculty' } })).error, 'invalid_input', 'a name in some language is required')
    const p = (await newPathPaper({ meta: { faculty: 'test faculty of examples' } })).paperId
    await call('admin_queue', { p_actor: A })
    assert.strictEqual(json(`select review_institution_state(${lit(p)})`).unit_id, null, 'unverified: not matched')
    for (const bad of [['http://insecure.example/x', '2026-09-01'], ['https://example.invalid/faculties', '2999-01-01'], ['not a url', '2026-09-01']]) {
      assert.strictEqual((await call('admin_verify_unit', { p_actor: A, p_unit: unit.id, p_source_url: bad[0], p_retrieved_on: bad[1], p_note: null })).error, 'invalid_input', bad[0])
    }
    assert.strictEqual((await call('admin_verify_unit', { p_actor: V1, p_unit: unit.id, p_source_url: 'https://example.invalid/faculties', p_retrieved_on: '2026-09-01', p_note: null })).error, 'forbidden')
    await ok('admin_verify_unit', { p_actor: A, p_unit: unit.id, p_source_url: 'https://example.invalid/faculties', p_retrieved_on: '2026-09-01', p_note: 'compared with the page' })
    const row = json(`select to_jsonb(u) from academic_units u where id = ${lit(unit.id)}`)
    assert.strictEqual(row.verification, 'verified'); assert.strictEqual(row.source_url, 'https://example.invalid/faculties'); assert.strictEqual(row.source_retrieved_on, '2026-09-01'); assert.strictEqual(row.verified_by, A)
    const p2 = (await newPathPaper({ meta: { faculty: 'Test Faculty of Examples' } })).paperId
    await call('admin_queue', { p_actor: A })
    assert.strictEqual(json(`select review_institution_state(${lit(p2)})`).unit_id, unit.id, 'verified and exact: matched')
    assert.ok(psql(`insert into academic_units (institution_id, name_en, source_kind, verification) values (${lit(uofk)}, 'X', 'reviewer_entered', 'verified')`).error, 'verified requires a source and a date')
    // A unit of one institution cannot be attached to a paper mapped to another.
    assert.strictEqual((await call('admin_set_paper_institution', { p_actor: A, p_paper: p2, p_institution: other, p_unit: unit.id })).error, 'invalid_input')
    assert.strictEqual(json(`select review_institution_state(${lit(p2)})`).unit_id, unit.id, 'unchanged')
    assert.ok(psql(`update paper_reviews set institution_id = ${lit(other)} where paper_id = ${lit(p2)}`).error, 'even directly, the composite key holds')
  })

  // ------------------------------------------------------------ approval
  await check('approval: succeeds with confirmed metadata, an eligible institution, supported permission and no blocking issue; records what was reviewed', async () => {
    const paper = (await newPathPaper({ fullName: 'Nadia Omer', email: 'nadia@example.invalid', meta: { title: 'Gamma Study of Trade Networks in Omdurman' } })).paperId
    const d = await detail(A, paper)
    assert.deepStrictEqual(d.states, { submitted: true, confirmed: true, confirmed_at: d.states.confirmed_at, reviewed: false, approval_recorded: false, publication_approved: false })
    assert.strictEqual(d.preconditions.ok, true, JSON.stringify(d.preconditions))
    assert.strictEqual(d.evidence.basis, 'acceptance'); assert.strictEqual(d.evidence.setting, 'record_abstract')
    assert.strictEqual(d.evidence.claimed_identity_verified_by_acceptance, false, 'acceptance never verifies identity')
    assert.strictEqual(d.evidence.authority_verified_by_reviewer, false)
    const r = await decide(paper, 'approved', { revision: d.revision, reason: 'Checked against the document.' })
    assert.strictEqual(r.ok, true, JSON.stringify(r))
    const row = json(`select to_jsonb(a) from review_approvals a where paper_id = ${lit(paper)}`)
    assert.strictEqual(row.approved_by, A); assert.strictEqual(row.publication_setting, 'record_abstract'); assert.strictEqual(row.setting_basis, 'acceptance')
    assert.strictEqual(row.content_fingerprint, sqlOk(`select review_content_fingerprint(${lit(paper)})`)); assert.strictEqual(row.revision, d.revision)
    assert.strictEqual(row.snapshot.metadata.title, 'Gamma Study of Trade Networks in Omdurman'); assert.strictEqual(row.snapshot.evidence.claimed_role, 'author')
    assert.strictEqual(row.authority_verified, false)
    assert.ok(!JSON.stringify(row.snapshot).includes('nadia@example.invalid'), 'no contact detail in the snapshot')
    const after = await detail(A, paper)
    assert.strictEqual(after.states.publication_approved, true); assert.strictEqual(after.review.status, 'approved')
    const el = eligibility(paper)
    assert.strictEqual(el.review_approved, true); assert.strictEqual(el.record_public, true); assert.strictEqual(el.abstract_public, true); assert.strictEqual(el.fulltext_public, false)
    assert.ok(el.fulltext_reasons.includes('setting_is_record_abstract'))
    const ev = events(paper).find((e) => e.action === 'decision:approved')
    assert.strictEqual(ev.actor_id, A); assert.strictEqual(ev.actor_role, 'administrator'); assert.ok(ev.created_at); assert.strictEqual(ev.detail.approval_id, r.approval_id)
    // Approval created no public object: nothing in the database is public.
    assert.strictEqual(sqlOk(`select count(*) from information_schema.tables where table_schema = 'public' and table_name ~ 'public_'`), '0')
  })

  await check('approval is refused, with the failing conditions named, for each missing precondition', async () => {
    const fresh = async (o = {}) => (await newPathPaper(o)).paperId
    const refusal = async (paper, over = {}) => {
      const d = await detail(A, paper)
      const r = await decide(paper, 'approved', { revision: d.revision, ...over })
      assert.strictEqual(r.ok, false, JSON.stringify(r))
      assert.strictEqual(r.error, 'preconditions_failed')
      return r.failures.map((f) => f.code)
    }
    // unconfirmed
    const unconfirmed = await fresh({ confirm: false })
    assert.ok((await refusal(unconfirmed)).includes('metadata_not_confirmed'))
    // incomplete metadata
    const noAbstract = await fresh({ meta: { abstract: '' } })
    sqlOk(`update papers set abstract = null where id = ${lit(noAbstract)}`)
    const codes = await refusal(noAbstract)
    assert.ok(codes.includes('metadata_incomplete'))
    // institution unresolved / ineligible
    const unresolved = await fresh({ meta: { university: 'Nowhere Institute' } })
    assert.ok((await refusal(unresolved)).includes('institution_unresolved'))
    const college = sqlOk(`select id from institutions where slug = 'khartoum-college'`)
    await ok('admin_set_paper_institution', { p_actor: A, p_paper: unresolved, p_institution: college, p_unit: null })
    assert.ok((await refusal(unresolved)).includes('institution_not_eligible'))
    // a blocking issue
    const blocked = await fresh({ meta: { title: 'Delta Blocking Issue Study' } })
    const issue = await ok('admin_raise_issue', { p_actor: A, p_paper: blocked, p_kind: 'rights', p_description: 'Co-author permission unclear.', p_blocking: true })
    assert.deepStrictEqual(await refusal(blocked), ['blocking_issue_open'])
    await ok('admin_raise_issue', { p_actor: A, p_paper: blocked, p_kind: 'other', p_description: 'Just a remark.', p_blocking: false })
    await ok('admin_resolve_issue', { p_actor: A, p_paper: blocked, p_issue: issue.id, p_resolution: 'Confirmed by email.' })
    assert.strictEqual((await approve(blocked)).ok, true, 'a non-blocking issue does not stop approval; the resolved one no longer does')
    // depositor authority
    const depositor = await fresh({ role: 'authorized_depositor', meta: { title: 'Epsilon Deposited Study' } })
    assert.deepStrictEqual(await refusal(depositor), ['authority_unverified'])
    assert.strictEqual((await call('admin_record_authority', { p_actor: A, p_paper: depositor, p_verified: true, p_note: '' })).error, 'invalid_input', 'verification needs a note')
    await ok('admin_record_authority', { p_actor: A, p_paper: depositor, p_verified: true, p_note: 'Authorization letter seen from the supervisor.' })
    assert.strictEqual((await approve(depositor)).ok, true)
    assert.strictEqual(eligibility(depositor).review_approved, true)
    await ok('admin_record_authority', { p_actor: A, p_paper: depositor, p_verified: false, p_note: null })
    assert.ok(eligibility(depositor).reasons.includes('authority_unverified'), 'withdrawing the verification withdraws eligibility')
    assert.strictEqual(eligibility(depositor).record_public, false)
    // permission evidence: an acceptance whose agreement is unknown
    const badAgreement = await fresh({ meta: { title: 'Zeta Unknown Agreement Study' } })
    sqlOk(`update agreement_versions set content_sha256 = '${'f'.repeat(64)}' where id = 'submission-terms-2026-09-25-en'`)
    assert.ok((await refusal(badAgreement)).includes('permission_not_supported'))
    sqlOk(`update agreement_versions set content_sha256 = '77376e5ef87f47395475525dea70a4716b7e9d2a9c4b30003612f2d172e676da' where id = 'submission-terms-2026-09-25-en'`)
    // unknown decision, missing reason, unknown paper
    assert.strictEqual((await call('admin_decide', { p_actor: A, p_paper: badAgreement, p_decision: 'publish', p_reason: 'x', p_expected_revision: 'x' })).error, 'invalid_input')
    const d = await detail(A, badAgreement)
    assert.strictEqual((await decide(badAgreement, 'declined', { revision: d.revision, reason: '   ' })).error, 'reason_required')
    assert.strictEqual((await call('admin_decide', { p_actor: A, p_paper: uid(), p_decision: 'declined', p_reason: 'x', p_expected_revision: 'x' })).error, 'not_found')
    // nothing in this test was approved by accident
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(unconfirmed)}`), 'pending')
  })

  await check('non-eligible institutions can be reviewed privately but never approved or made public; eligibility is a separate, audited, reversible fact', async () => {
    const paper = (await newPathPaper({ meta: { title: 'Eta Study From Another University', university: 'Another University' } })).paperId
    const college = sqlOk(`select id from institutions where slug = 'khartoum-college'`)
    await ok('admin_set_paper_institution', { p_actor: A, p_paper: paper, p_institution: college, p_unit: null })
    assert.strictEqual((await approve(paper)).error, 'preconditions_failed')
    const d = await detail(A, paper)
    assert.strictEqual((await decide(paper, 'reviewed', { revision: d.revision, reason: 'Checked; held privately.' })).ok, true)
    assert.strictEqual(eligibility(paper).record_public, false)
    assert.deepStrictEqual(eligibility(paper).reasons, ['not_approved'])
    assert.strictEqual((await detail(A, paper)).states.reviewed, true)
    // Making the institution eligible does not approve or publish anything.
    assert.strictEqual((await call('admin_set_institution_eligibility', { p_actor: A, p_institution: college, p_eligible: true, p_note: '' })).error, 'invalid_input')
    await ok('admin_set_institution_eligibility', { p_actor: A, p_institution: college, p_eligible: true, p_note: 'Test only.' })
    assert.strictEqual(eligibility(paper).record_public, false, 'eligible institution, but the record is not approved')
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(paper)}`), 'reviewed')
    assert.strictEqual((await approve(paper)).ok, true)
    assert.strictEqual(eligibility(paper).record_public, true)
    // Losing eligibility later removes eligibility without touching the decision.
    await ok('admin_set_institution_eligibility', { p_actor: A, p_institution: college, p_eligible: false, p_note: 'Test over.' })
    const el = eligibility(paper)
    assert.strictEqual(el.review_approved, true); assert.strictEqual(el.record_public, false); assert.ok(el.reasons.includes('institution_not_eligible'))
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(paper)}`), 'approved')
    const audit = json(`select json_agg(e order by id) from admin_audit_events e where action = 'institution_eligibility' and detail->>'slug' = 'khartoum-college'`)
    assert.deepStrictEqual(audit.map((e) => [e.detail.eligible, e.actor_id]), [[false, A], [true, A], [false, A]], 'creation, and each change, with the acting administrator')
    assert.strictEqual(json(`select json_agg(slug) from institutions where public_collection_eligible`)[0], 'university-of-khartoum')
  })

  // ------------------------------------------------------------ legacy
  await check('legacy records: no acceptance, no retroactive permission; undetermined is held; a determination is capped by the old checkboxes and never expands them', async () => {
    const before = allPapers()
    const acceptancesBefore = Number(sqlOk('select count(*) from submission_acceptances'))
    const full = legacyPaper(['full_paper'], { title: 'Legacy Full Paper Study' })
    const abs = legacyPaper(['abstract_and_citation'], { title: 'Legacy Abstract Study' })
    const art = legacyPaper(['metadata_and_article'], { title: 'Legacy Article Study' })
    const empty = legacyPaper([], { title: 'Legacy Empty Scope Study' })
    for (const id of [full, abs, art, empty]) {
      const d = await detail(A, id)
      assert.strictEqual(d.evidence.basis, 'legacy'); assert.deepStrictEqual(d.evidence.problems, ['legacy_permission_undetermined'])
      assert.strictEqual(d.submitter.claimed_role, null, 'a role the submitter never gave is not invented')
      assert.strictEqual(d.acceptance.legacy, true)
      const r = await decide(id, 'approved', { revision: d.revision })
      assert.strictEqual(r.error, 'preconditions_failed'); assert.ok(r.failures.some((f) => f.code === 'permission_not_supported'))
    }
    const set = (id, setting) => call('admin_set_legacy_setting', { p_actor: A, p_paper: id, p_setting: setting, p_note: 'Read the old form text.' })
    assert.strictEqual((await set(abs, 'record_abstract_fulltext')).error, 'legacy_grant_does_not_cover_full_text')
    assert.strictEqual((await set(art, 'record_abstract_fulltext')).error, 'legacy_grant_does_not_cover_full_text', 'permission for an article never implies the original text')
    assert.strictEqual((await set(empty, 'record_abstract')).error, 'legacy_grant_empty')
    assert.strictEqual((await call('admin_set_legacy_setting', { p_actor: A, p_paper: full, p_setting: 'record_abstract', p_note: '' })).error, 'invalid_input')
    assert.strictEqual((await set(abs, 'record_abstract')).ok, true)
    assert.strictEqual((await set(art, 'record_abstract')).ok, true)
    assert.strictEqual((await set(full, 'hold')).ok, true)
    assert.deepStrictEqual((await detail(A, full)).evidence.problems, ['legacy_held_for_authorization'])
    assert.strictEqual((await approve(full)).error, 'preconditions_failed', 'held records cannot be approved')
    assert.strictEqual((await approve(abs)).ok, true)
    assert.strictEqual(eligibility(abs).setting, 'record_abstract'); assert.strictEqual(eligibility(abs).record_public, true)
    assert.strictEqual(sqlOk(`select setting_basis from review_approvals where paper_id = ${lit(abs)}`), 'legacy_determination')
    const modern = (await newPathPaper({})).paperId
    const notLegacy = await call('admin_set_legacy_setting', { p_actor: A, p_paper: modern, p_setting: 'record_abstract', p_note: 'x' })
    assert.deepStrictEqual([notLegacy.ok, notLegacy.error], [false, 'not_a_legacy_record'], 'not for a record that has an acceptance')
    // Nothing above changed a legacy row or invented an acceptance.
    const after = allPapers()
    for (const b of before) assert.deepStrictEqual(after.find((x) => x.id === b.id), b, `paper ${b.id} changed`)
    assert.strictEqual(Number(sqlOk('select count(*) from submission_acceptances')) - acceptancesBefore, 1, 'only the one new-path paper made in this check has an acceptance')
    for (const id of [full, abs, art, empty]) assert.strictEqual(sqlOk(`select submission_acceptance_id is null from papers where id = ${lit(id)}`), 't')
    // A determination is a review fact: changing it changes the revision.
    assert.notStrictEqual((await detail(A, art)).revision, (await detail(A, empty)).revision)
  })

  // ------------------------------------------------------------ documents and full text
  const fullTextPaper = async (o = {}) => (await newPathPaper({ setting: 'record_abstract_fulltext', meta: { title: o.title || 'Theta Full Text Study of Regional Trade' } }))
  const originalId = async (paper, bytes) => {
    const sha = crypto.createHash('sha256').update(bytes).digest('hex')
    return (await ok('admin_register_original', { p_actor: A, p_paper: paper, p_sha256: sha, p_size: bytes.length })).id
  }

  await check('full text: approval needs a specific reviewed document version; the approval names its hash; a full-text approval without one is refused', async () => {
    const ft = await fullTextPaper()
    let d = await detail(A, ft.paperId)
    assert.ok(d.preconditions.failures.some((f) => f.code === 'dissemination_copy_required'))
    let r = await decide(ft.paperId, 'approved', { revision: d.revision })
    assert.strictEqual(r.error, 'preconditions_failed'); assert.ok(r.failures.some((f) => f.code === 'dissemination_copy_required'))
    // The original must be registered with its real hash first.
    assert.strictEqual((await call('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'original_reviewed', p_extension: 'pdf', p_declared_size: null, p_note: null, p_redaction_note: null })).error, 'original_not_registered')
    const wrongHash = await call('admin_register_original', { p_actor: A, p_paper: ft.paperId, p_sha256: 'c'.repeat(64), p_size: ft.bytes.length })
    assert.deepStrictEqual([wrongHash.ok, wrongHash.error], [false, 'hash_mismatch'], 'a hash that is not the accepted document\'s is refused')
    const orig = await originalId(ft.paperId, ft.bytes)
    assert.strictEqual(await originalId(ft.paperId, ft.bytes), orig, 'registering again is idempotent')
    // Designate the reviewed original: prepared at its own private path, finalized with the same hash.
    const prep = await ok('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'original_reviewed', p_extension: 'pdf', p_declared_size: null, p_note: null, p_redaction_note: null })
    assert.match(prep.storage_path, new RegExp(`^dissemination/${ft.paperId}/[0-9a-f-]{36}\\.pdf$`))
    assert.notStrictEqual(prep.storage_path, prep.original_storage_path, 'a separate object')
    assert.strictEqual((await call('admin_finalize_document', { p_actor: A, p_version: prep.id, p_sha256: 'd'.repeat(64), p_size: ft.bytes.length })).error, 'hash_mismatch', 'a copy claimed to be the reviewed original must hash the same')
    const sha = crypto.createHash('sha256').update(ft.bytes).digest('hex')
    assert.strictEqual((await call('admin_finalize_document', { p_actor: A, p_version: prep.id, p_sha256: sha, p_size: ft.bytes.length + 1 })).error, 'size_mismatch')
    await ok('admin_finalize_document', { p_actor: A, p_version: prep.id, p_sha256: sha, p_size: ft.bytes.length })
    assert.strictEqual((await call('admin_finalize_document', { p_actor: A, p_version: prep.id, p_sha256: sha, p_size: ft.bytes.length })).already, true, 'a retried finalization changes nothing')
    d = await detail(A, ft.paperId)
    r = await decide(ft.paperId, 'approved', { revision: d.revision, dissemination: prep.id })
    assert.strictEqual(r.ok, true, JSON.stringify(r))
    const ap = json(`select to_jsonb(a) from review_approvals a where paper_id = ${lit(ft.paperId)}`)
    assert.strictEqual(ap.dissemination_version_id, prep.id); assert.strictEqual(ap.dissemination_sha256, sha); assert.strictEqual(ap.snapshot.dissemination.origin, 'original_reviewed')
    assert.strictEqual(sqlOk(`select state from document_versions where id = ${lit(prep.id)}`), 'approved')
    const vers = (await detail(A, ft.paperId)).documents.versions
    assert.strictEqual(vers[0].provenance_note, 'the original, reviewed and designated without change'); assert.strictEqual(vers[0].derived_from, orig)
    assert.ok(!JSON.stringify(await detail(A, ft.paperId)).includes(prep.storage_path), 'no storage path is shown to a screen')
    // The reviewed version is what full text refers to; a version of ANOTHER paper never qualifies.
    const other = await fullTextPaper({ title: 'Iota Other Full Text Study' })
    await originalId(other.paperId, other.bytes)
    const otherPrep = await ok('admin_prepare_document', { p_actor: A, p_paper: other.paperId, p_origin: 'original_reviewed', p_extension: 'pdf', p_declared_size: null, p_note: null, p_redaction_note: null })
    await ok('admin_finalize_document', { p_actor: A, p_version: otherPrep.id, p_sha256: crypto.createHash('sha256').update(other.bytes).digest('hex'), p_size: other.bytes.length })
    const d2 = await detail(A, ft.paperId)
    const wrong = await decide(ft.paperId, 'approved', { revision: d2.revision, dissemination: otherPrep.id })
    assert.ok(wrong.failures.some((f) => f.code === 'dissemination_copy_invalid'))
    // A copy is not accepted for a record-and-abstract submission.
    const ra = (await newPathPaper({ meta: { title: 'Kappa Record Only Study' } })).paperId
    const dra = await detail(A, ra)
    assert.ok((await decide(ra, 'approved', { revision: dra.revision, dissemination: prep.id })).failures.some((f) => f.code === 'dissemination_copy_not_applicable'))
  })

  await check('full text stays restricted after approval: the legal condition is a separate release restriction that Approve cannot lift; only the owner\'s deliberate, audited edit does', async () => {
    const ft = await fullTextPaper({ title: 'Lambda Restricted Full Text Study' })
    await originalId(ft.paperId, ft.bytes)
    const prep = await ok('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'original_reviewed', p_extension: 'pdf', p_declared_size: null, p_note: null, p_redaction_note: null })
    await ok('admin_finalize_document', { p_actor: A, p_version: prep.id, p_sha256: crypto.createHash('sha256').update(ft.bytes).digest('hex'), p_size: ft.bytes.length })
    assert.strictEqual((await approve(ft.paperId, { dissemination: prep.id })).ok, true)
    let el = eligibility(ft.paperId)
    assert.strictEqual(el.record_public, true, 'the record and abstract are eligible')
    assert.strictEqual(el.fulltext_public, false)
    assert.deepStrictEqual(el.fulltext_reasons, ['fulltext_legal_condition_pending'])
    assert.strictEqual(el.restrictions.fulltext_legal_condition_active, true)
    // No application function can lift it.
    const fnSql = sqlOk(`select string_agg(prosrc, ' ') from pg_proc where proname like 'admin\\_%'`)
    assert.ok(!/release_restrictions/.test(fnSql), 'no admin function touches release_restrictions')
    for (const actor of [A, A2]) assert.ok(!(await call('admin_context', { p_actor: actor })).release_restrictions)
    // A missing restriction row counts as restricted, not as lifted.
    assert.strictEqual(sqlOk(`begin; delete from release_restrictions where key = 'fulltext_legal_advice'; select publication_eligibility(${lit(ft.paperId)})->>'fulltext_public'; rollback;`), 'false')
    assert.strictEqual(sqlOk(`select count(*) from release_restrictions where key = 'fulltext_legal_advice'`), '1')
    // The founder's deliberate edit (SQL editor), audited whoever makes it.
    sqlOk(`update release_restrictions set active = false, changed_by = 'founder, advice ref TEST-1', note = 'Test advice recorded.', changed_at = now() where key = 'fulltext_legal_advice'`)
    el = eligibility(ft.paperId)
    assert.strictEqual(el.fulltext_public, true); assert.strictEqual(el.dissemination_version_id, prep.id)
    const ev = json(`select json_agg(e order by id) from admin_audit_events e where action = 'release_restriction_update'`)
    assert.ok(ev.length >= 1 && ev[ev.length - 1].detail.active === false && ev[ev.length - 1].detail.was_active === true && ev[ev.length - 1].actor_role.startsWith('database:'))
    // Withdrawing the approved copy takes the full text away and leaves the record.
    await ok('admin_withdraw_document', { p_actor: A, p_version: prep.id, p_reason: 'Wrong copy.' })
    el = eligibility(ft.paperId)
    assert.strictEqual(el.record_public, true); assert.strictEqual(el.fulltext_public, false); assert.deepStrictEqual(el.fulltext_reasons, ['dissemination_copy_not_approved'])
    sqlOk(`update release_restrictions set active = true, changed_by = 'test restore', note = 'restored' where key = 'fulltext_legal_advice'`)
  })

  await check('blocking issues: raising one suspends an approval at once (record and full text), a resolution never revives it, a fresh approval is required; the old approval stays as evidence', async () => {
    const resolveAll = async (paper) => {
      for (const i of (await detail(A, paper)).issues.filter((x) => x.state === 'open')) await ok('admin_resolve_issue', { p_actor: A, p_paper: paper, p_issue: i.id, p_resolution: 'Checked and fixed.' })
    }
    // Metadata-only record, issue raised by an administrator.
    const ra = (await newPathPaper({ meta: { title: 'Sigma Blocking Issue Record Study' } })).paperId
    assert.strictEqual((await approve(ra)).ok, true)
    const first = sqlOk(`select id from review_approvals where paper_id = ${lit(ra)}`)
    assert.strictEqual(eligibility(ra).record_public, true)
    // A non-blocking issue changes nothing.
    const nb = await ok('admin_raise_issue', { p_actor: A, p_paper: ra, p_kind: 'other', p_description: 'Typo in the abstract.', p_blocking: false })
    assert.strictEqual(nb.suspends_approval_id, null)
    assert.strictEqual(eligibility(ra).record_public, true, 'a non-blocking issue leaves eligibility alone')
    const raised = await ok('admin_raise_issue', { p_actor: A, p_paper: ra, p_kind: 'privacy', p_description: 'Participant phone numbers on page 4.', p_blocking: true })
    assert.strictEqual(raised.suspends_approval_id, first)
    let el = eligibility(ra)
    assert.deepStrictEqual([el.review_approved, el.record_public, el.abstract_public, el.fulltext_public], [false, false, false, false])
    assert.ok(el.reasons.includes('blocking_issue_open') && el.reasons.includes('blocking_issue_since_approval'))
    let d = await detail(A, ra)
    assert.strictEqual(d.review.status, 'approved', 'the recorded decision is history, not changed')
    assert.deepStrictEqual([d.states.approval_recorded, d.states.publication_approved], [true, false], 'history and current eligibility are distinct')
    assert.strictEqual(d.approvals[0].id, first); assert.strictEqual(d.approvals[0].suspended_by_issue, true)
    await resolveAll(ra)
    el = eligibility(ra)
    assert.strictEqual(el.record_public, false, 'resolution does not revive the suspended approval')
    assert.deepStrictEqual(el.reasons, ['blocking_issue_since_approval'])
    assert.strictEqual((await approve(ra)).ok, true, 'a fresh administrator approval')
    el = eligibility(ra)
    assert.strictEqual(el.record_public, true)
    assert.notStrictEqual(el.approval_id, first)
    assert.strictEqual(Number(sqlOk(`select count(*) from review_approvals where paper_id = ${lit(ra)}`)), 2, 'the earlier approval is kept as evidence')
    assert.ok(psql(`delete from review_approvals where id = ${lit(first)}`).error, 'and cannot be removed')

    // Full text, issue raised by the assigned volunteer.
    const ft = await fullTextPaper({ title: 'Tau Blocking Issue Full Text Study' })
    await originalId(ft.paperId, ft.bytes)
    const prep = await ok('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'original_reviewed', p_extension: 'pdf', p_declared_size: null, p_note: null, p_redaction_note: null })
    await ok('admin_finalize_document', { p_actor: A, p_version: prep.id, p_sha256: crypto.createHash('sha256').update(ft.bytes).digest('hex'), p_size: ft.bytes.length })
    assert.strictEqual((await approve(ft.paperId, { dissemination: prep.id })).ok, true)
    sqlOk(`update release_restrictions set active = false, changed_by = 'test', note = 'test' where key = 'fulltext_legal_advice'`)
    try {
      assert.strictEqual(eligibility(ft.paperId).fulltext_public, true)
      assert.strictEqual((await call('admin_raise_issue', { p_actor: V1, p_paper: ft.paperId, p_kind: 'rights', p_description: 'x', p_blocking: true })).error, 'forbidden', 'not assigned')
      await ok('admin_assign', { p_actor: A, p_paper: ft.paperId, p_volunteer: V1 })
      const vi = await ok('admin_raise_issue', { p_actor: V1, p_paper: ft.paperId, p_kind: 'rights', p_description: 'Co-author has not agreed.', p_blocking: true })
      assert.ok(vi.suspends_approval_id)
      el = eligibility(ft.paperId)
      assert.deepStrictEqual([el.record_public, el.fulltext_public], [false, false])
      assert.strictEqual(el.dissemination_version_id, null)
      assert.strictEqual((await call('admin_resolve_issue', { p_actor: V1, p_paper: ft.paperId, p_issue: vi.id, p_resolution: 'x' })).error, 'forbidden', 'only an administrator resolves')
      await resolveAll(ft.paperId)
      assert.strictEqual(eligibility(ft.paperId).fulltext_public, false)
      assert.strictEqual((await approve(ft.paperId, { dissemination: prep.id })).ok, true)
      assert.deepStrictEqual([eligibility(ft.paperId).record_public, eligibility(ft.paperId).fulltext_public], [true, true])
      const ev = json(`select json_agg(e.detail) from admin_audit_events e where paper_id = ${lit(ft.paperId)} and action = 'issue_raised'`)
      assert.ok(ev.some((x) => x.suspends_approval_id === vi.suspends_approval_id))
    } finally {
      sqlOk(`update release_restrictions set active = true, changed_by = 'test restore', note = 'restored' where key = 'fulltext_legal_advice'`)
    }

    // An open blocking issue raised BEFORE approval still refuses it.
    const pre = (await newPathPaper({ meta: { title: 'Upsilon Early Issue Study' } })).paperId
    await ok('admin_raise_issue', { p_actor: A, p_paper: pre, p_kind: 'rights', p_description: 'Check permission.', p_blocking: true })
    assert.ok((await approve(pre)).failures.some((f) => f.code === 'blocking_issue_open'))
  })

  await check('concurrency: a blocking issue raised during an approval is never overlooked, in either order', async () => {
    const run = (sql) => new Promise((resolve) => {
      const c = spawn('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''; c.stdout.on('data', (b) => (out += b)); c.stderr.on('data', (b) => (out += b)); c.on('close', () => resolve(out))
    })
    // Approval holds the lock first; the issue waits, then suspends it.
    const p = (await newPathPaper({ meta: { title: 'Phi Concurrent Issue Study' } })).paperId
    let rev = (await detail(A, p)).revision
    const approveTx = run(`begin; select admin_decide(${lit(A)}, ${lit(p)}, 'approved', 'concurrent', ${lit(rev)}, null); select pg_sleep(1.2); commit;`)
    await new Promise((r) => setTimeout(r, 400))
    const issueTx = run(`select admin_raise_issue(${lit(A2)}, ${lit(p)}, 'privacy', 'Raised during the approval.', true)`)
    const [aOut, iOut] = await Promise.all([approveTx, issueTx])
    assert.ok(!/ERROR/.test(aOut + iOut), aOut + iOut)
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(p)}`), 'approved')
    assert.strictEqual(sqlOk(`select suspends_approval_id is not null from review_issues where paper_id = ${lit(p)}`), 't', 'the issue saw the approval it followed')
    assert.strictEqual(eligibility(p).record_public, false)
    // The issue holds the lock first; the approval waits, then sees it.
    const q = (await newPathPaper({ meta: { title: 'Chi Concurrent Issue Study' } })).paperId
    rev = (await detail(A, q)).revision
    const issueFirst = run(`begin; select admin_raise_issue(${lit(A2)}, ${lit(q)}, 'rights', 'Raised first.', true); select pg_sleep(1.2); commit;`)
    await new Promise((r) => setTimeout(r, 400))
    const approveAfter = run(`select admin_decide(${lit(A)}, ${lit(q)}, 'approved', 'after', ${lit(rev)}, null)`)
    const [, out] = await Promise.all([issueFirst, approveAfter])
    assert.match(out, /stale_revision|preconditions_failed/)
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(q)}`), 'pending')
    assert.strictEqual(eligibility(q).record_public, false)
  })

  await check('the UofK unit seed is repeatable, owned by UofK only, English only, and never touches existing units or reviewer mappings', async () => {
    const uofk = sqlOk(`select id from institutions where slug = 'university-of-khartoum'`)
    const count = () => Number(sqlOk(`select count(*) from academic_units where source_url = 'https://uofk.edu/index.php/faculties'`))
    assert.strictEqual(count(), 21)
    // Rerun the whole migration: nothing is duplicated or changed.
    const before = sqlOk(`select md5(string_agg(to_jsonb(u)::text, '' order by id)) from academic_units u`)
    execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', path.join(ROOT, 'supabase/migrations/0015_admin_review.sql')], { stdio: ['ignore', 'ignore', 'pipe'] })
    assert.strictEqual(sqlOk(`select md5(string_agg(to_jsonb(u)::text, '' order by id)) from academic_units u`), before)
    assert.strictEqual(count(), 21)
    // Clear matches map automatically; anything ambiguous or partial stays for a reviewer.
    const sci = sqlOk(`select id from academic_units where institution_id = ${lit(uofk)} and name_en = 'Faculty of Science'`)
    const exact = (await newPathPaper({ meta: { faculty: '  faculty of  SCIENCE ' } })).paperId
    const partial = (await newPathPaper({ meta: { faculty: 'Science' } })).paperId
    const legacyAmbiguous = legacyPaper(['abstract_and_citation'], { faculty: 'Faculty of Medicine and Pharmacy' })
    await call('admin_queue', { p_actor: A })
    assert.strictEqual(json(`select review_institution_state(${lit(exact)})`).unit_id, sci)
    assert.strictEqual(json(`select review_institution_state(${lit(partial)})`).unit_id, null)
    assert.strictEqual(json(`select review_institution_state(${lit(legacyAmbiguous)})`).unit_id, null)
    assert.strictEqual(sqlOk(`select faculty from papers where id = ${lit(legacyAmbiguous)}`), 'Faculty of Medicine and Pharmacy', 'submitted text preserved')
    // A reviewer's mapping survives a rerun of the seed.
    const law = sqlOk(`select id from academic_units where institution_id = ${lit(uofk)} and name_en = 'Faculty of Law'`)
    await ok('admin_set_paper_institution', { p_actor: A, p_paper: exact, p_institution: uofk, p_unit: law })
    execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', path.join(ROOT, 'supabase/migrations/0015_admin_review.sql')], { stdio: ['ignore', 'ignore', 'pipe'] })
    await call('admin_queue', { p_actor: A })
    assert.strictEqual(json(`select review_institution_state(${lit(exact)})`).unit_id, law)
  })

  await check('redacted copies: need a redaction note, keep their provenance and hash, supersede an earlier approved copy; the original is kept', async () => {
    const ft = await fullTextPaper({ title: 'Mu Redacted Copy Study' })
    const orig = await originalId(ft.paperId, ft.bytes)
    assert.strictEqual((await call('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'redacted_copy', p_extension: 'pdf', p_declared_size: 1000, p_note: null, p_redaction_note: '' })).error, 'invalid_input')
    assert.strictEqual((await call('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'redacted_copy', p_extension: 'exe', p_declared_size: 1000, p_note: null, p_redaction_note: 'x' })).error, 'invalid_input')
    const redacted = await pdf('redacted version')
    const make = async () => {
      const prep = await ok('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'redacted_copy', p_extension: 'pdf', p_declared_size: redacted.length, p_note: 'Signature page removed', p_redaction_note: 'Removed page 3 (signatures) and the acknowledgements contact numbers.' })
      await ok('admin_finalize_document', { p_actor: A, p_version: prep.id, p_sha256: crypto.createHash('sha256').update(redacted).digest('hex'), p_size: redacted.length })
      return prep.id
    }
    const v1 = await make()
    assert.strictEqual((await approve(ft.paperId, { dissemination: v1 })).ok, true)
    const v2 = await make()
    assert.strictEqual((await approve(ft.paperId, { dissemination: v2 })).ok, true, 're-approval with a newer copy')
    assert.deepStrictEqual(json(`select json_agg(state order by created_at) from document_versions where paper_id = ${lit(ft.paperId)} and kind = 'dissemination'`), ['superseded', 'approved'])
    assert.strictEqual(sqlOk(`select count(*) from document_versions where paper_id = ${lit(ft.paperId)} and kind = 'original' and state = 'recorded'`), '1')
    const row = json(`select to_jsonb(d) from document_versions d where id = ${lit(v2)}`)
    assert.strictEqual(row.derived_from, orig); assert.strictEqual(row.origin, 'redacted_copy'); assert.match(row.redaction_note, /signatures/)
    assert.strictEqual(eligibility(ft.paperId).approval_id, sqlOk(`select id from review_approvals where paper_id = ${lit(ft.paperId)} order by approved_at desc limit 1`), 'eligibility follows the latest approval')
    assert.strictEqual(sqlOk(`select count(*) from review_approvals where paper_id = ${lit(ft.paperId)}`), '2', 'both approvals are kept')
    // A volunteer may propose a copy for an assigned paper but never approve one.
    await ok('admin_assign', { p_actor: A, p_paper: ft.paperId, p_volunteer: V1 })
    const vp = await ok('admin_prepare_document', { p_actor: V1, p_paper: ft.paperId, p_origin: 'redacted_copy', p_extension: 'pdf', p_declared_size: redacted.length, p_note: null, p_redaction_note: 'Removed a table with participant names.' })
    await ok('admin_finalize_document', { p_actor: V1, p_version: vp.id, p_sha256: crypto.createHash('sha256').update(await pdf('volunteer copy')).digest('hex'), p_size: redacted.length })
    assert.strictEqual(sqlOk(`select state from document_versions where id = ${lit(vp.id)}`), 'proposed')
    assert.strictEqual((await call('admin_decide', { p_actor: V1, p_paper: ft.paperId, p_decision: 'approved', p_reason: 'x', p_expected_revision: (await detail(V1, ft.paperId)).revision, p_dissemination: vp.id })).error, 'forbidden')
    await ok('admin_unassign', { p_actor: A, p_paper: ft.paperId, p_volunteer: V1 })
  })

  await check('file access: the path comes from the database, only for permitted staff, and every request is logged', async () => {
    const ft = await fullTextPaper({ title: 'Nu File Access Study' })
    await originalId(ft.paperId, ft.bytes)
    const a1 = await ok('admin_document_access', { p_actor: A, p_paper: ft.paperId, p_version: null })
    assert.strictEqual(a1.storage_path, ft.path)
    assert.strictEqual((await call('admin_document_access', { p_actor: V2, p_paper: ft.paperId, p_version: null })).error, 'forbidden')
    assert.strictEqual((await call('admin_document_access', { p_actor: A, p_paper: ft.paperId, p_version: uid() })).error, 'not_found')
    const pending = await ok('admin_prepare_document', { p_actor: A, p_paper: ft.paperId, p_origin: 'redacted_copy', p_extension: 'pdf', p_declared_size: 500, p_note: null, p_redaction_note: 'x' })
    assert.strictEqual((await call('admin_document_access', { p_actor: A, p_paper: ft.paperId, p_version: pending.id })).error, 'not_found', 'nothing uploaded yet')
    assert.ok(events(ft.paperId).filter((e) => e.action === 'file_accessed').length === 1)
    assert.strictEqual(events(ft.paperId).find((e) => e.action === 'file_accessed').actor_id, A)
  })

  // ------------------------------------------------------------ revisions, later changes and concurrency
  await check('later changes do not inherit an approval: a changed title, author, or abstract removes eligibility at once; unrelated changes do not; re-approval needs the new revision', async () => {
    const p = await newPathPaper({ meta: { title: 'Xi Study That Will Change' } })
    const first = await approve(p.paperId)
    assert.strictEqual(first.ok, true)
    assert.strictEqual(eligibility(p.paperId).record_public, true)
    // Not material: LinkedIn and its visibility.
    const view = json(`select get_paper_for_confirmation(${lit(p.token)})`)
    json(`select confirm_researcher_metadata(${lit(p.token)}, ${lit(view.researchers.map((x) => ({ researcher_id: x.researcher_id, full_name: x.full_name, author_order: x.author_order, linkedin_url: 'https://www.linkedin.com/in/xi-author', linkedin_public: true })))}, null)`)
    assert.strictEqual(eligibility(p.paperId).record_public, true, 'LinkedIn is not part of what was approved')
    // Material: the title.
    confirmMetadata(p.token, { title: 'Xi Study That Has Changed' })
    let el = eligibility(p.paperId)
    assert.strictEqual(el.review_approved, false); assert.strictEqual(el.record_public, false); assert.ok(el.reasons.includes('content_changed_since_approval'))
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(p.paperId)}`), 'approved', 'the recorded decision is history, not silently rewritten')
    // Noticed and logged once, with the fields.
    const d1 = await detail(A, p.paperId)
    assert.strictEqual(d1.states.publication_approved, false)
    await detail(A, p.paperId)
    const changes = events(p.paperId).filter((e) => e.action === 'content_changed')
    assert.strictEqual(changes.length, 1, 'once')
    assert.strictEqual(changes[0].actor_role, 'submitter'); assert.ok(changes[0].detail.fields_changed_since_approval.includes('title')); assert.strictEqual(changes[0].detail.approval_still_valid, false)
    // A stale screen from before the change cannot approve the new content.
    const stale = await decide(p.paperId, 'approved', { revision: first.revision })
    assert.strictEqual(stale.error, 'stale_revision')
    assert.strictEqual((await approve(p.paperId)).ok, true, 're-approval on the current revision')
    assert.strictEqual(eligibility(p.paperId).record_public, true)
    assert.strictEqual(sqlOk(`select count(*) from review_approvals where paper_id = ${lit(p.paperId)}`), '2')
    // Authors and the abstract are material too.
    const v2 = json(`select get_paper_for_confirmation(${lit(p.token)})`)
    confirmMetadata(p.token, {}, [...v2.researchers.map((x) => ({ researcher_id: x.researcher_id, full_name: x.full_name, author_order: x.author_order })), { full_name: 'Added Coauthor', author_order: 2 }])
    assert.ok(eligibility(p.paperId).reasons.includes('content_changed_since_approval'), 'an added author')
    await approve(p.paperId)
    confirmMetadata(p.token, { abstract: 'A different abstract.' }, json(`select get_paper_for_confirmation(${lit(p.token)})`).researchers.map((x) => ({ researcher_id: x.researcher_id, full_name: x.full_name, author_order: x.author_order })))
    assert.ok(eligibility(p.paperId).reasons.includes('content_changed_since_approval'), 'a changed abstract')
    await approve(p.paperId)
    // Reordering authors changes what a citation would say.
    const v3 = json(`select get_paper_for_confirmation(${lit(p.token)})`).researchers
    confirmMetadata(p.token, {}, [{ researcher_id: v3[1].researcher_id, full_name: v3[1].full_name, author_order: 1 }, { researcher_id: v3[0].researcher_id, full_name: v3[0].full_name, author_order: 2 }])
    assert.ok(eligibility(p.paperId).reasons.includes('content_changed_since_approval'), 'author order')
  })

  await check('stale admin screens and concurrent decisions cannot approve a different revision', async () => {
    const p = await newPathPaper({ meta: { title: 'Omicron Concurrency Study' } })
    const r1 = (await detail(A, p.paperId)).revision
    // Another administrator declines first.
    assert.strictEqual((await call('admin_decide', { p_actor: A2, p_paper: p.paperId, p_decision: 'declined', p_reason: 'Out of scope.', p_expected_revision: r1 })).ok, true)
    const stale = await call('admin_decide', { p_actor: A, p_paper: p.paperId, p_decision: 'approved', p_reason: 'x', p_expected_revision: r1 })
    assert.strictEqual(stale.error, 'stale_revision'); assert.ok(stale.revision && stale.revision !== r1)
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(p.paperId)}`), 'declined')
    // Any review-owned change moves the revision too.
    const r2 = (await detail(A, p.paperId)).revision
    await ok('admin_raise_issue', { p_actor: A, p_paper: p.paperId, p_kind: 'other', p_description: 'new', p_blocking: false })
    assert.notStrictEqual((await detail(A, p.paperId)).revision, r2)
    // Reopen, then a genuinely concurrent approval and submitter edit: whichever order, the approval never covers content it did not see.
    await decide(p.paperId, 'reopen', { revision: (await detail(A, p.paperId)).revision, reason: null })
    const rev = (await detail(A, p.paperId)).revision
    const run = (sql) => new Promise((resolve) => {
      const c = spawn('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-c', sql], { stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''; c.stdout.on('data', (b) => (out += b)); c.stderr.on('data', (b) => (out += b)); c.on('close', () => resolve(out))
    })
    const approveTx = run(`begin; select admin_decide(${lit(A)}, ${lit(p.paperId)}, 'approved', 'concurrent', ${lit(rev)}, null); select pg_sleep(1.2); commit;`)
    await new Promise((r) => setTimeout(r, 400))
    const editTx = run(`select confirm_researcher_metadata(${lit(p.token)}, ${lit(json(`select get_paper_for_confirmation(${lit(p.token)})`).researchers.map((x) => ({ researcher_id: x.researcher_id, full_name: x.full_name, author_order: x.author_order })))}, ${lit({ title: 'Omicron Concurrency Study, Revised' })})`)
    const [, editOut] = await Promise.all([approveTx, editTx])
    assert.ok(!/ERROR/.test(editOut), editOut)
    const el = eligibility(p.paperId)
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(p.paperId)}`), 'approved', 'the approval landed first')
    assert.strictEqual(el.record_public, false, 'but it does not cover the edit that followed')
    assert.ok(el.reasons.includes('content_changed_since_approval'))
    // The other order: the edit lands first, the approval from the old screen is refused.
    const p2 = await newPathPaper({ meta: { title: 'Pi Concurrency Study' } })
    const revOld = (await detail(A, p2.paperId)).revision
    confirmMetadata(p2.token, { title: 'Pi Concurrency Study, Revised' })
    assert.strictEqual((await call('admin_decide', { p_actor: A, p_paper: p2.paperId, p_decision: 'approved', p_reason: 'x', p_expected_revision: revOld })).error, 'stale_revision')
    assert.strictEqual(sqlOk(`select status from paper_reviews where paper_id = ${lit(p2.paperId)}`), 'pending')
  })

  await check('withdrawal and embargo are restrictions apart from the decision: withdrawal works from a stale screen, blocks re-approval until reopened; embargo delays', async () => {
    const p = (await newPathPaper({ meta: { title: 'Rho Withdrawal Study' } })).paperId
    await approve(p)
    assert.strictEqual(eligibility(p).record_public, true)
    await ok('admin_set_embargo', { p_actor: A, p_paper: p, p_until: '2999-01-01', p_note: 'Journal embargo until then.' })
    let el = eligibility(p)
    assert.strictEqual(el.review_approved, true, 'the decision stands'); assert.strictEqual(el.record_public, false); assert.ok(el.reasons.includes('embargo')); assert.strictEqual(el.restrictions.embargo_active, true)
    assert.strictEqual((await call('admin_set_embargo', { p_actor: A, p_paper: p, p_until: '2999-01-01', p_note: '' })).error, 'invalid_input')
    await ok('admin_set_embargo', { p_actor: A, p_paper: p, p_until: '2020-01-01', p_note: 'Ended.' })
    assert.strictEqual(eligibility(p).record_public, true, 'a past embargo no longer restricts')
    await ok('admin_set_embargo', { p_actor: A, p_paper: p, p_until: null, p_note: null })
    // Withdrawal: with a reason, from any screen.
    const w = await call('admin_decide', { p_actor: A, p_paper: p, p_decision: 'withdrawn', p_reason: '', p_expected_revision: 'stale' })
    assert.strictEqual(w.error, 'reason_required')
    const w2 = await call('admin_decide', { p_actor: A, p_paper: p, p_decision: 'withdrawn', p_reason: 'Author asked to withdraw.', p_expected_revision: 'a stale screen' })
    assert.strictEqual(w2.ok, true)
    el = eligibility(p)
    assert.strictEqual(el.record_public, false); assert.ok(el.reasons.includes('withdrawn')); assert.strictEqual(el.restrictions.withdrawn, true)
    const d = await detail(A, p)
    assert.strictEqual(d.review.withdrawn_reason, 'Author asked to withdraw.')
    const re = await decide(p, 'approved', { revision: d.revision })
    assert.ok(re.failures.some((f) => f.code === 'withdrawn_reopen_first'))
    assert.strictEqual((await decide(p, 'reopen', { revision: d.revision, reason: 'Author changed their mind.' })).status, 'pending')
    assert.strictEqual((await approve(p)).ok, true)
    assert.strictEqual(eligibility(p).record_public, true, 'reopened, re-reviewed and approved again')
    assert.strictEqual((await decide(p, 'reopen', { revision: (await detail(A, p)).revision })).status, 'pending')
    assert.strictEqual((await decide(p, 'reopen', { revision: (await detail(A, p)).revision })).error, 'already_pending')
  })

  await check('needs-changes and decline record the reason and say nothing was sent to the submitter', async () => {
    const p = (await newPathPaper({ meta: { title: 'Sigma Needs Changes Study' } })).paperId
    const d = await detail(A, p)
    const r = await decide(p, 'needs_changes', { revision: d.revision, reason: 'Please add the abstract in Arabic if the paper has one.' })
    assert.strictEqual(r.ok, true)
    const ev = events(p).find((e) => e.action === 'decision:needs_changes')
    assert.strictEqual(ev.detail.submitter_notified, false, 'no notification exists, so none is claimed')
    assert.strictEqual(ev.detail.reason, 'Please add the abstract in Arabic if the paper has one.')
    assert.strictEqual((await detail(A, p)).review.status_reason, 'Please add the abstract in Arabic if the paper has one.')
    assert.strictEqual(sqlOk(`select count(*) from information_schema.tables where table_name ilike '%notification%' or table_name ilike '%outbox%'`), '0')
    const d2 = await detail(A, p)
    assert.strictEqual((await decide(p, 'declined', { revision: d2.revision, reason: 'Not a research document.' })).ok, true)
    assert.strictEqual(eligibility(p).record_public, false)
  })

  // ------------------------------------------------------------ audit
  await check('every decision and material action leaves an append-only event with actor, action and time; the log cannot be changed by anyone', async () => {
    const p = (await newPathPaper({ meta: { title: 'Tau Audit Study' } })).paperId
    await ok('admin_assign', { p_actor: A, p_paper: p, p_volunteer: V2 })
    await ok('admin_add_note', { p_actor: A, p_paper: p, p_body: 'Admin note.' })
    await ok('admin_recommend', { p_actor: V2, p_paper: p, p_recommendation: 'approve', p_reason: 'Looks fine.' })
    await ok('admin_raise_issue', { p_actor: V2, p_paper: p, p_kind: 'privacy', p_description: 'Page 4 lists a phone number.', p_blocking: true })
    await ok('admin_set_embargo', { p_actor: A, p_paper: p, p_until: null, p_note: null })
    await ok('admin_record_authority', { p_actor: A, p_paper: p, p_verified: true, p_note: 'Seen.' })
    await ok('admin_set_paper_institution', { p_actor: A, p_paper: p, p_institution: sqlOk(`select id from institutions where slug = 'university-of-khartoum'`), p_unit: null })
    await ok('admin_document_access', { p_actor: V2, p_paper: p, p_version: null })
    await decide(p, 'needs_changes', { revision: (await detail(A, p)).revision, reason: 'Remove the phone number.' })
    await ok('admin_unassign', { p_actor: A, p_paper: p, p_volunteer: V2 })
    const ev = events(p)
    const seen = ev.map((e) => e.action)
    for (const a of ['volunteer_assigned', 'note_added', 'recommendation', 'issue_raised', 'embargo_set', 'authority_verified', 'institution_mapped', 'file_accessed', 'decision:needs_changes', 'volunteer_unassigned']) {
      assert.ok(seen.includes(a), `${a} is logged: ${seen.join(', ')}`)
    }
    for (const e of ev) { assert.ok(e.created_at, 'a time'); assert.ok(e.actor_role, 'a role'); assert.ok(e.actor_id || ['submitter'].includes(e.actor_role) || e.actor_role.startsWith('database'), `${e.action} has an actor`) }
    assert.strictEqual(ev.find((e) => e.action === 'file_accessed').actor_id, V2); assert.strictEqual(ev.find((e) => e.action === 'file_accessed').actor_role, 'volunteer')
    assert.strictEqual(ev.find((e) => e.action === 'recommendation').actor_role, 'volunteer')
    const ids = ev.map((e) => Number(e.id)); assert.deepStrictEqual(ids, [...ids].sort((a, b) => a - b))
    for (const sql of ['update admin_audit_events set action = \'x\'', 'delete from admin_audit_events', 'truncate admin_audit_events',
                        'update review_notes set body = \'x\'', 'delete from review_notes', 'update review_approvals set snapshot = \'{}\'', 'delete from review_approvals']) {
      const r = psql(sql)
      assert.ok(r.error && /append-only/.test(r.error.message), `${sql}: ${JSON.stringify(r.error)}`)
    }
    for (const role of ['anon', 'authenticated', 'service_role']) assert.ok(psql(`set role ${role}; delete from admin_audit_events`).error, role)
    // The detail a reviewer sees carries the history, newest first, and an administrator sees who.
    const d = await detail(A, p)
    assert.ok(d.events.length >= ev.length && d.events[0].id > d.events[d.events.length - 1].id)
    assert.ok(d.events.some((e) => e.actor_email === 'vol2@example.invalid'))
    assert.ok(!(await detail(V2, p)).events, undefined)
  })

  await check('duplicate flags are advisory: an exact file or a near-identical title is shown, but nothing is merged, rejected, hidden or labelled', async () => {
    const orig = await newPathPaper({ meta: { title: 'Upsilon Consumer Behaviour in Sudan’s Retail Sector', year: '2021' } })
    const same = await newPathPaper({ bytes: orig.bytes, meta: { title: 'A Completely Different Title', year: '2015' } })
    const similar = await newPathPaper({ meta: { title: 'Upsilon: consumer behaviour in Sudan\'s retail sector', year: '2022' } })
    const farYear = await newPathPaper({ meta: { title: 'Upsilon Consumer Behaviour in Sudan’s Retail Sector', year: '2005' } })
    const different = await newPathPaper({ meta: { title: 'Phi Groundwater Policy in Darfur', year: '2021' } })
    const arA = await newPathPaper({ meta: { title: 'أثر التمويل الأصغر على المشروعات الصغيرة', abstract: undefined, year: '2020' } })
    sqlOk(`update papers set abstract = 'x' where id = ${lit(arA.paperId)}`)
    const arB = await newPathPaper({ meta: { title: 'اثر التمويل الاصغر على المشروعات الصغيرة', year: '2020' } })
    const d = await detail(A, orig.paperId)
    const hits = Object.fromEntries(d.duplicates.items.map((x) => [x.paper_id, x]))
    assert.strictEqual(hits[same.paperId].kind, 'same_file'); assert.strictEqual(hits[same.paperId].score, 1)
    assert.strictEqual(hits[similar.paperId].kind, 'similar_title')
    assert.ok(!hits[farYear.paperId], 'a distant year is not offered')
    assert.ok(!hits[different.paperId], 'a different title is not offered')
    const dA = await detail(A, arA.paperId)
    assert.ok(dA.duplicates.items.some((x) => x.paper_id === arB.paperId), 'Arabic spelling variants (alef forms) still match')
    // Nothing changed anywhere: no status, no approval, no note, no issue.
    for (const id of [orig.paperId, same.paperId, similar.paperId]) {
      assert.strictEqual(sqlOk(`select coalesce((select status from paper_reviews where paper_id = ${lit(id)}), 'pending')`), 'pending')
      assert.strictEqual(sqlOk(`select count(*) from review_issues where paper_id = ${lit(id)}`), '0')
    }
    // An approval is possible with duplicates present unless a reviewer raises a blocking issue.
    assert.strictEqual((await approve(orig.paperId)).ok, true)
    const q = await call('admin_queue', { p_actor: A, p_filters: { q: 'Upsilon' } })
    assert.ok(q.items.some((i) => i.paper_id === same.paperId || i.exact_duplicates >= 1), 'the queue counts exact duplicates')
    assert.strictEqual(sqlOk(`select normalize_name_text('  إبراهيم — الخرطوم!! ')`), 'ابراهيم الخرطوم')
    assert.strictEqual(sqlOk(`select token_jaccard(title_tokens('a b c d'), title_tokens('a b c e'))`), '0.60000000000000000000')
  })

  // ------------------------------------------------------------ queue
  await check('queue: filters by status, institution, confirmation and text; states are distinct; pages are bounded', async () => {
    const all = await call('admin_queue', { p_actor: A, p_filters: { limit: 500 } })
    assert.strictEqual(all.limit, 100, 'the page size is capped')
    assert.strictEqual(all.total, Number(sqlOk('select count(*) from papers')))
    for (const it of all.items) {
      assert.deepStrictEqual(Object.keys(it.states).sort(), ['confirmed', 'publication_approved', 'reviewed', 'submitted'])
      assert.ok(['pending', 'needs_changes', 'reviewed', 'approved', 'declined', 'withdrawn'].includes(it.status))
    }
    const approved = await call('admin_queue', { p_actor: A, p_filters: { status: 'approved' } })
    assert.ok(approved.items.length >= 3 && approved.items.every((i) => i.status === 'approved'))
    assert.ok(approved.items.some((i) => !i.states.publication_approved), 'an approved record whose content changed is no longer publication-approved')
    const unconf = await call('admin_queue', { p_actor: A, p_filters: { confirmed: 'no' } })
    assert.ok(unconf.items.length >= 1 && unconf.items.every((i) => i.states.confirmed === false))
    const pending = await call('admin_queue', { p_actor: A, p_filters: { status: 'pending', limit: 2, offset: 1 } })
    assert.ok(pending.items.length <= 2)
    assert.strictEqual((await call('admin_queue', { p_actor: A, p_filters: { status: 'published' } })).error, 'invalid_input')
    const byText = await call('admin_queue', { p_actor: A, p_filters: { q: 'Withdrawal Study' } })
    assert.deepStrictEqual(byText.items.map((i) => i.title), ['Rho Withdrawal Study'])
    assert.strictEqual(byText.items[0].claimed_role, 'author'); assert.strictEqual(byText.items[0].evidence_basis, 'acceptance')
  })

  await check('the review layer touches no submission, extraction or confirmation behaviour and creates nothing public', async () => {
    // papers.status (the old column) is not used by review; nothing was published.
    assert.strictEqual(sqlOk(`select count(*) from papers where status <> 'submitted'`), '0')
    assert.strictEqual(sqlOk(`select count(*) from articles`), '0')
    // The old anonymous functions behave as before.
    assert.ok(json(`set role anon; select submit_paper('Old', 'old@example.invalid', 'uuid-old.pdf', true, array['abstract_and_citation'], null)`).paper_id)
    assert.ok(psql(`set role anon; select publication_eligibility('${uid()}')`).error, 'the eligibility rule is server-side only')
  })


  // ------------------------------------------------------------ the application layer on the same database
  const TOK = { A: 'token-admin-'.padEnd(40, 'a'), A2: 'token-admin2-'.padEnd(40, 'b'), V1: 'token-vol1-'.padEnd(40, 'c'), V2: 'token-vol2-'.padEnd(40, 'd'), U: 'token-user-'.padEnd(40, 'e') }
  const who = { [TOK.A]: A, [TOK.A2]: A2, [TOK.V1]: V1, [TOK.V2]: V2, [TOK.U]: U }
  const getUser = async (t) => (who[t] ? { data: { user: { id: who[t] } }, error: null } : { data: null, error: { message: 'invalid JWT' } })
  const api = (method, segments, { token, body, query } = {}) =>
    handleAdmin({ method, segments, query: query || {}, body, token, supabase, storage, env: { ADMIN_REVIEW: 'enabled' }, getUser, root: ROOT, log: quiet })

  await check('API: unauthenticated is 401, a signed-in non-staff user is 403 everywhere, staff get only what their role and assignment allow', async () => {
    const p = (await newPathPaper({ meta: { title: 'Psi API Boundary Study' } })).paperId
    assert.strictEqual((await api('GET', ['queue'])).status, 401)
    assert.strictEqual((await api('GET', ['queue'], { token: 'not-a-known-token'.padEnd(40, 'x') })).status, 401)
    for (const [m, seg, body] of [['GET', ['queue']], ['GET', ['reviews', p]], ['GET', ['staff']], ['GET', ['institutions']], ['GET', ['me']],
                                  ['POST', ['reviews', p, 'notes'], { body: 'x' }], ['POST', ['reviews', p, 'files', 'access'], {}]]) {
      assert.strictEqual((await api(m, seg, { token: TOK.U, body })).status, 403, `${m} ${seg.join('/')}`)
    }
    assert.strictEqual((await api('GET', ['queue'], { token: TOK.A })).status, 200)
    assert.strictEqual((await api('GET', ['staff'], { token: TOK.V1 })).status, 403, 'a volunteer cannot list staff')
    assert.strictEqual((await api('POST', ['reviews', p, 'decision'], { token: TOK.V1, body: { decision: 'declined', reason: 'x', expectedRevision: 'x' } })).status, 403)
    assert.strictEqual((await api('GET', ['reviews', p], { token: TOK.V1 })).status, 403, 'not assigned')
    assert.strictEqual((await api('POST', ['reviews', p, 'assignments'], { token: TOK.A, body: { volunteerId: V1 } })).status, 201)
    const own = await api('GET', ['reviews', p], { token: TOK.V1 })
    assert.strictEqual(own.status, 200); assert.strictEqual(own.body.submitter.email, null)
    const me = await api('GET', ['me'], { token: TOK.V1 })
    assert.deepStrictEqual([me.body.role, me.body.acknowledged], ['volunteer', true])
    assert.strictEqual((await api('POST', ['reviews', p, 'notes'], { token: TOK.V1, body: { body: 'From the API.' } })).status, 201)
    const dec = await api('POST', ['reviews', p, 'decision'], { token: TOK.A, body: { decision: 'reviewed', reason: 'Fine.', expectedRevision: (await api('GET', ['reviews', p], { token: TOK.A })).body.revision } })
    assert.strictEqual(dec.status, 200); assert.strictEqual(dec.body.status, 'reviewed')
    const stale = await api('POST', ['reviews', p, 'decision'], { token: TOK.A, body: { decision: 'declined', reason: 'x', expectedRevision: 'a stale revision' } })
    assert.strictEqual(stale.status, 409); assert.strictEqual(stale.body.reason, 'stale_revision')
    const noReason = await api('POST', ['reviews', p, 'decision'], { token: TOK.A, body: { decision: 'declined', reason: '', expectedRevision: (await api('GET', ['reviews', p], { token: TOK.A })).body.revision } })
    assert.strictEqual(noReason.status, 400)
    // Approval refused: a 422 that names what is missing.
    const un = (await newPathPaper({ confirm: false })).paperId
    const refused = await api('POST', ['reviews', un, 'decision'], { token: TOK.A, body: { decision: 'approved', expectedRevision: (await api('GET', ['reviews', un], { token: TOK.A })).body.revision } })
    assert.strictEqual(refused.status, 422); assert.ok(refused.body.failures.some((f) => f.code === 'metadata_not_confirmed'))
    assert.strictEqual((await api('POST', ['reviews', p, 'assignments', V1, 'end'], { token: TOK.A, body: {} })).status, 200)
    assert.strictEqual((await api('GET', ['reviews', p], { token: TOK.V1 })).status, 403, 'access ends with the assignment')
    assert.strictEqual((await api('GET', ['eligibility'.padEnd(11), p])).status, 401)
  })

  await check('API documents: a legacy original is hashed once from private storage; the designated copy is a separate object; an approval names it; a redacted upload is verified', async () => {
    const legacy = legacyPaper(['full_paper'], { title: 'Omega Legacy Full Text Study' })
    const bytes = await pdf('legacy original')
    const legacyPath = sqlOk(`select file_path from papers where id = ${lit(legacy)}`)
    storage.objects.set(legacyPath, bytes)
    assert.strictEqual((await api('POST', ['reviews', legacy, 'legacy-setting'], { token: TOK.A, body: { setting: 'record_abstract_fulltext', note: 'The old form said full paper.' } })).status, 200)
    const designated = await api('POST', ['reviews', legacy, 'documents'], { token: TOK.A, body: { origin: 'original_reviewed' } })
    assert.strictEqual(designated.status, 201, JSON.stringify(designated.body))
    const orig = json(`select to_jsonb(d) from document_versions d where paper_id = ${lit(legacy)} and kind = 'original'`)
    assert.strictEqual(orig.sha256, crypto.createHash('sha256').update(bytes).digest('hex'), 'hashed from the stored file, not trusted from anywhere')
    assert.strictEqual(orig.storage_path, legacyPath)
    const copy = json(`select to_jsonb(d) from document_versions d where id = ${lit(designated.body.versionId)}`)
    assert.notStrictEqual(copy.storage_path, legacyPath); assert.ok(storage.objects.has(copy.storage_path)); assert.deepStrictEqual(storage.objects.get(copy.storage_path), bytes)
    assert.strictEqual(copy.state, 'proposed')
    const rev = (await api('GET', ['reviews', legacy], { token: TOK.A })).body.revision
    const approved = await api('POST', ['reviews', legacy, 'decision'], { token: TOK.A, body: { decision: 'approved', expectedRevision: rev, disseminationVersionId: designated.body.versionId } })
    assert.strictEqual(approved.status, 200, JSON.stringify(approved.body))
    assert.strictEqual(eligibility(legacy).record_public, true)
    assert.strictEqual(eligibility(legacy).fulltext_public, false, 'the legal condition still holds')
    // If the stored original changed after it was recorded, a new designation is refused.
    storage.objects.set(legacyPath, await pdf('tampered original'))
    const tampered = await api('POST', ['reviews', legacy, 'documents'], { token: TOK.A, body: { origin: 'original_reviewed' } })
    assert.strictEqual(tampered.status, 409); assert.strictEqual(tampered.body.reason, 'original_changed')
    storage.objects.set(legacyPath, bytes)

    // A redacted copy: a private, server-chosen path; verified when finalized.
    const p = (await newPathPaper({ setting: 'record_abstract_fulltext', meta: { title: 'Alpha-Two Redaction Flow Study' } }))
    const red = await pdf('redacted content')
    const start = await api('POST', ['reviews', p.paperId, 'documents'], { token: TOK.A, body: { origin: 'redacted_copy', redactionNote: 'Removed signatures.', file: { name: 'r.pdf', size: red.length, type: 'application/pdf' } } })
    assert.strictEqual(start.status, 201, JSON.stringify(start.body))
    assert.match(start.body.upload.path, new RegExp(`^dissemination/${p.paperId}/`))
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'documents', start.body.versionId, 'finalize'], { token: TOK.A, body: {} })).body.reason, 'upload_missing')
    assert.strictEqual(storage.uploadWithToken(start.body.upload.path, start.body.upload.token, Buffer.from('%PDF-1.4 but the wrong size')).error, null)
    const wrongSize = await api('POST', ['reviews', p.paperId, 'documents', start.body.versionId, 'finalize'], { token: TOK.A, body: {} })
    assert.strictEqual(wrongSize.status, 422); assert.strictEqual(wrongSize.body.reason, 'object_size_mismatch')
    assert.ok(!storage.objects.has(start.body.upload.path), 'the bad object was removed, so the same upload link can be used again')
    const notPdf = Buffer.alloc(red.length, 0x41)
    storage.uploadWithToken(start.body.upload.path, start.body.upload.token, notPdf)
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'documents', start.body.versionId, 'finalize'], { token: TOK.A, body: {} })).body.reason, 'object_type_invalid')
    storage.uploadWithToken(start.body.upload.path, start.body.upload.token, red)
    const fin = await api('POST', ['reviews', p.paperId, 'documents', start.body.versionId, 'finalize'], { token: TOK.A, body: {} })
    assert.strictEqual(fin.status, 200, JSON.stringify(fin.body))
    assert.strictEqual(sqlOk(`select sha256 from document_versions where id = ${lit(start.body.versionId)}`), crypto.createHash('sha256').update(red).digest('hex'))
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'documents', start.body.versionId, 'finalize'], { token: TOK.A, body: {} })).body.alreadyFinalized, true, 'retrying is safe')
    // Bad requests never create anything.
    const before = sqlOk('select count(*) from document_versions')
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'documents'], { token: TOK.A, body: { origin: 'redacted_copy', redactionNote: 'x', file: { name: 'r.exe', size: 5, type: 'application/pdf' } } })).status, 400)
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'documents'], { token: TOK.V2, body: { origin: 'original_reviewed' } })).status, 403)
    assert.strictEqual(sqlOk('select count(*) from document_versions'), before)
  })

  await check('API file access: a short-lived link only for staff allowed on that submission, logged with who and which document', async () => {
    const p = await newPathPaper({ meta: { title: 'Beta-Two File Access Study' } })
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'files', 'access'], { body: {} })).status, 401)
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'files', 'access'], { token: TOK.U, body: {} })).status, 403)
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'files', 'access'], { token: TOK.V2, body: {} })).status, 403, 'acknowledged but not assigned')
    const r = await api('POST', ['reviews', p.paperId, 'files', 'access'], { token: TOK.A, body: {} })
    assert.strictEqual(r.status, 200); assert.match(r.body.url, /token=t60$/); assert.strictEqual(r.body.expiresIn, 60)
    assert.deepStrictEqual(Object.keys(r.body).sort(), ['expiresIn', 'url'], 'a link and its lifetime; no separate path field')
    await api('POST', ['reviews', p.paperId, 'assignments'], { token: TOK.A, body: { volunteerId: V2 } })
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'files', 'access'], { token: TOK.V2, body: {} })).status, 200)
    const logged = events(p.paperId).filter((e) => e.action === 'file_accessed')
    assert.deepStrictEqual(logged.map((e) => [e.actor_id, e.actor_role]), [[A, 'administrator'], [V2, 'volunteer']])
    // A missing object is a 502, still logged, and reveals nothing.
    storage.objects.delete(p.path)
    assert.strictEqual((await api('POST', ['reviews', p.paperId, 'files', 'access'], { token: TOK.A, body: {} })).status, 502)
  })

  execFileSync('dropdb', ['--if-exists', DB])
  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll M4 real-database checks passed.')
}

main()
