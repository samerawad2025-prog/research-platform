#!/usr/bin/env node
//
// Phase 3 M5 against a REAL, disposable local Postgres: every public read
// (research page, catalogue results and counts, sitemap, document lookup)
// in every review state, plus search, filters and pagination. The review
// actions are the M4 functions, called as the application calls them.
// Synthetic data only; no network. Run by supabase/tests/run-0012.sh.

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '../..')
const { makePsql, lit } = require('./pg-adapter')
const DB = 'm5_public_test'
const BASE_REF = process.env.BASE_REF || 'origin/research-platform'
const { psql, sqlOk, json } = makePsql(DB)

let failed = 0
async function check(name, fn) {
  try { await fn(); console.log(`ok     ${name}`) } catch (err) { console.error(`FAIL   ${name} — ${err.stack || err.message}`); failed++ }
}

function setup() {
  execFileSync('dropdb', ['--if-exists', DB])
  execFileSync('createdb', [DB])
  const run = (file) => execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', file], { stdio: ['ignore', 'ignore', 'pipe'] })
  run(path.join(__dirname, 'supabase-stubs.sql'))
  const tmp = path.join(os.tmpdir(), 'm5-pre-schema.sql')
  fs.writeFileSync(tmp, execFileSync('git', ['show', `${BASE_REF}:supabase/schema.sql`], { cwd: ROOT, encoding: 'utf8' }))
  run(tmp)
  for (const m of ['0011_manual_entry', '0012_submission_acceptance', '0013_linkedin_visibility_declared_authors', '0015_admin_review', '0016_public_research', '0016_public_research']) {
    run(path.join(ROOT, 'supabase/migrations', `${m}.sql`))
  }
}

const A = crypto.randomUUID()
const V = crypto.randomUUID()
const q = (fn, ...args) => json(`select ${fn}(${args.map((a) => (a === null ? 'null' : typeof a === 'object' ? `${lit(JSON.stringify(a))}::jsonb` : lit(a))).join(', ')})`)
const ok = (fn, ...args) => { const r = q(fn, ...args); assert.ok(r && r.ok !== false, `${fn}: ${JSON.stringify(r)}`); return r }
const record = (pid) => q('public_record', pid)
const cat = (f = {}) => q('public_catalogue', f)
const sitemap = () => q('public_sitemap').map((e) => e.public_id)
const doc = (pid) => q('public_document', pid)
const pidOf = (paper) => sqlOk(`select public_id from public_records where paper_id = ${lit(paper)}`) || null
const revision = (paper) => q('admin_review_detail', A, paper).revision
const decide = (paper, d, reason = 'checked', dissemination = null) => q('admin_decide', A, paper, d, reason, revision(paper), dissemination)

let n = 0
// A legacy submission (the simplest real record shape): confirmed, with
// ordered authors, one of whom made LinkedIn public, plus private contacts.
function paper(o = {}) {
  const id = crypto.randomUUID()
  const tag = ++n
  const authors = o.authors || [['Amna Hassan', 'https://www.linkedin.com/in/amna-example', true], ['Omer Ali', 'https://www.linkedin.com/in/omer-private', false]]
  const rids = authors.map(() => crypto.randomUUID())
  let sqlText = ''
  authors.forEach(([name, li, pub], i) => {
    sqlText += `insert into researchers (id, full_name, email, whatsapp_number, linkedin_url, linkedin_public, facebook_url)
      values (${lit(rids[i])}, ${lit(name)}, ${lit(`private${tag}-${i}@example.invalid`)}, '+249900000${tag}${i}', ${lit(li)}, ${pub}, 'https://facebook.com/private${tag}');`
  })
  sqlText += `insert into papers (id, file_path, permission_to_process, publication_scope, submitted_by, extraction_status, metadata_confirmed_at,
      title, title_ar, abstract, abstract_ar, year, university, faculty, degree_type, supervisor_name, document_type, confirmation_token_hash)
    values (${lit(id)}, ${lit(`legacy-${tag}.${o.ext || 'pdf'}`)}, true, ${lit(`{${(o.scope || ['abstract_and_citation']).join(',')}}`)}, ${lit(rids[0])}, 'completed', now(),
      ${o.title === null ? 'null' : lit(o.title || `Synthetic Study ${tag}`)}, ${o.title_ar ? lit(o.title_ar) : 'null'},
      ${o.abstract === null ? 'null' : lit(o.abstract || `A synthetic abstract number ${tag}.`)}, ${o.abstract_ar ? lit(o.abstract_ar) : 'null'},
      ${o.year || 2022}, ${lit(o.university || 'University of Khartoum')}, ${lit(o.faculty || 'Faculty of Science')}, ${lit(o.degree || 'MSc')},
      'Dr Private Supervisor', ${lit(o.type || 'thesis')}, encode(sha256(${lit(`secret-token-${tag}`)}::bytea), 'hex'));`
  rids.forEach((rid, i) => { sqlText += `insert into paper_researchers (paper_id, researcher_id, author_order) values (${lit(id)}, ${lit(rid)}, ${i + 1});` })
  sqlOk(sqlText)
  return id
}
function approveLegacy(id, setting = 'record_abstract', dissemination = null) {
  ok('admin_set_legacy_setting', A, id, setting, 'Old form covered this.')
  const r = decide(id, 'approved', 'ok', dissemination)
  assert.strictEqual(r.ok, true, JSON.stringify(r))
}
function fullTextPaper(o = {}) {
  const id = paper({ ...o, scope: ['full_paper'] })
  const sha = crypto.createHash('sha256').update(`bytes-${id}`).digest('hex')
  ok('admin_register_original', A, id, sha, 1234)
  const prep = ok('admin_prepare_document', A, id, 'original_reviewed', o.ext || 'pdf', null, null, null)
  ok('admin_finalize_document', A, prep.id, sha, 1234)
  approveLegacy(id, 'record_abstract_fulltext', prep.id)
  return { id, version: prep.id }
}
const lift = () => sqlOk(`update release_restrictions set active = false, changed_by = 'synthetic test only', note = 'test' where key = 'fulltext_legal_advice'`)
const restore = () => sqlOk(`update release_restrictions set active = true, changed_by = 'synthetic test restore', note = 'restored' where key = 'fulltext_legal_advice'`)

// Everything a public surface returns, as text, to search for leaks.
function everythingPublic() {
  return JSON.stringify([cat({ limit: 50 }), q('public_sitemap'), ...sitemap().map(record)])
}
// The private values seeded above must never appear.
const PRIVATE = [/@example\.invalid/, /\+2499/, /facebook/i, /omer-private/, /secret-token/, /legacy-\d+\.(pdf|docx)/, /dissemination\//,
  /storage_path/, /confirmation/, /reviewer|note|reason|acceptance|evidence|approval_id|paper_id/]

async function main() {
  setup()
  sqlOk(`insert into auth.users (id, email, email_confirmed_at) values (${lit(A)}, 'admin@example.invalid', now()), (${lit(V)}, 'vol@example.invalid', now());
         select bootstrap_first_administrator(${lit(A)});
         insert into staff_members (user_id, role, active, created_by) values (${lit(V)}, 'volunteer', true, ${lit(A)});`)

  // ------------------------------------------------------------ the state matrix
  const S = {}
  S.eligible = paper({ title: 'Groundwater Salinity in the Gezira Scheme', title_ar: 'ملوحة المياه الجوفية في مشروع الجزيرة', abstract_ar: 'دراسة عن الملوحة وأثرها.' })
  approveLegacy(S.eligible)
  S.private = paper({ title: 'Private Never Reviewed Study' }) // nothing done
  S.pending = paper({ title: 'Pending Legacy Study' }); ok('admin_set_legacy_setting', A, S.pending, 'record_abstract', 'x')
  S.declined = paper({ title: 'Declined Study' }); ok('admin_set_legacy_setting', A, S.declined, 'record_abstract', 'x'); assert.strictEqual(decide(S.declined, 'declined', 'Out of scope.').ok, true)
  S.withdrawn = paper({ title: 'Withdrawn After Approval Study' }); approveLegacy(S.withdrawn)
  S.suspended = paper({ title: 'Suspended By Issue Study' }); approveLegacy(S.suspended)
  S.ineligible = paper({ title: 'Other Institution Study', university: 'Somewhere Else College' })
  S.embargo = paper({ title: 'Embargoed Study' }); approveLegacy(S.embargo)
  S.changed = paper({ title: 'Changed After Approval Study' }); approveLegacy(S.changed)
  const FT = fullTextPaper({ title: 'Full Text Study of Nile Sediments' })
  S.fulltext = FT.id
  const FTW = fullTextPaper({ title: 'Full Text Withdrawn Version Study' })
  S.ftVersionWithdrawn = FTW.id
  const DOCX = fullTextPaper({ title: 'Word Document Study', ext: 'docx' })

  // Make each state what its name says.
  const pids = Object.fromEntries(Object.entries(S).map(([k, v]) => [k, pidOf(v)]))
  assert.strictEqual(decide(S.withdrawn, 'withdrawn', 'Author asked.').ok, true)
  ok('admin_raise_issue', A, S.suspended, 'privacy', 'Phone number on page 3.', true)
  ok('admin_set_embargo', A, S.embargo, '2999-01-01', 'Patent pending.')
  sqlOk(`update papers set title = 'Changed After Approval Study, Revised' where id = ${lit(S.changed)}`)
  ok('admin_withdraw_document', A, FTW.version, 'Wrong copy.')
  // Another institution: created by an administrator, not eligible; the
  // record is mapped to it and can be reviewed but never approved.
  const other = ok('admin_create_institution', A, { slug: 'somewhere-else', name_en: 'Somewhere Else College' })
  ok('admin_set_paper_institution', A, S.ineligible, other.id, null, false)
  ok('admin_set_legacy_setting', A, S.ineligible, 'record_abstract', 'x')
  assert.strictEqual(decide(S.ineligible, 'approved').error, 'preconditions_failed')
  // ... and an eligible, approved record whose institution later loses eligibility.
  S.lostEligibility = paper({ title: 'Institution Later Ineligible Study' })
  const inst2 = ok('admin_create_institution', A, { slug: 'second-eligible', name_en: 'Second College' })
  ok('admin_set_institution_eligibility', A, inst2.id, true, 'test')
  ok('admin_set_paper_institution', A, S.lostEligibility, inst2.id, null, false)
  approveLegacy(S.lostEligibility)
  pids.lostEligibility = pidOf(S.lostEligibility)
  ok('admin_set_institution_eligibility', A, inst2.id, false, 'test withdrawn')

  const hidden = ['private', 'pending', 'declined', 'withdrawn', 'suspended', 'ineligible', 'embargo', 'changed', 'lostEligibility']

  await check('identifiers: random, stable, not the paper id or token; assigned only on approval', async () => {
    assert.strictEqual(pids.private, null); assert.strictEqual(pids.pending, null); assert.strictEqual(pids.ineligible, null)
    for (const k of ['eligible', 'fulltext', 'withdrawn']) {
      assert.match(pids[k], /^[a-hjkmnp-z2-9]{12}$/)
      assert.ok(!S[k].includes(pids[k]))
    }
    // A re-approval keeps the same address.
    ok('admin_decide', A, S.eligible, 'reopen', null, revision(S.eligible), null)
    approveLegacy(S.eligible)
    assert.strictEqual(pidOf(S.eligible), pids.eligible)
    assert.strictEqual(Number(sqlOk('select count(*) from public_records')), Number(sqlOk('select count(distinct paper_id) from review_approvals')))
  })

  await check('an eligible metadata-only record is public on every surface, with an allowlist of fields', async () => {
    const r = record(pids.eligible)
    assert.deepStrictEqual(Object.keys(r).sort(), ['abstract', 'abstract_ar', 'approved_at', 'authors', 'degree_type', 'document_type', 'fulltext', 'institution', 'public_id', 'setting', 'supervisor_name', 'title', 'title_ar', 'unit', 'year'].sort())
    assert.strictEqual(r.title_ar, 'ملوحة المياه الجوفية في مشروع الجزيرة')
    assert.deepStrictEqual(r.authors, [{ name: 'Amna Hassan', linkedin_url: 'https://www.linkedin.com/in/amna-example' }, { name: 'Omer Ali', linkedin_url: null }], 'order kept; LinkedIn only where its owner chose')
    assert.deepStrictEqual(r.institution, { name_en: 'University of Khartoum', name_ar: 'جامعة الخرطوم' })
    assert.deepStrictEqual(r.unit, { name_en: 'Faculty of Science', name_ar: null }, 'the verified unit from the directory seed')
    assert.strictEqual(r.fulltext, null)
    assert.ok(sitemap().includes(pids.eligible))
    assert.ok(cat({ limit: 50 }).items.some((i) => i.public_id === pids.eligible))
    assert.strictEqual(doc(pids.eligible), null, 'no document for a record-and-abstract setting')
  })

  await check('every hidden state is absent from the page, catalogue, counts, sitemap and document lookup', async () => {
    const listed = cat({ limit: 50 }).items.map((i) => i.public_id)
    const map = sitemap()
    for (const k of hidden) {
      const pid = pids[k]
      if (pid) {
        assert.strictEqual(record(pid), null, k)
        assert.strictEqual(doc(pid), null, k)
        assert.ok(!listed.includes(pid), k); assert.ok(!map.includes(pid), k)
      }
      const title = sqlOk(`select title from papers where id = ${lit(S[k])}`)
      assert.strictEqual(cat({ q: title }).total, 0, `${k}: found by searching its own title`)
    }
    // Counts describe public records only.
    const all = cat({ limit: 50 })
    assert.strictEqual(all.total, listed.length)
    const yearSum = all.facets.year.reduce((a, y) => a + y.count, 0)
    assert.strictEqual(yearSum, all.total)
  })

  await check('a suspended approval stays hidden after the issue is resolved, until a fresh approval', async () => {
    for (const i of q('admin_review_detail', A, S.suspended).issues.filter((x) => x.state === 'open')) ok('admin_resolve_issue', A, S.suspended, i.id, 'Page replaced.')
    assert.strictEqual(record(pids.suspended), null)
    assert.ok(!sitemap().includes(pids.suspended))
    approveLegacy(S.suspended)
    assert.ok(record(pids.suspended)); assert.ok(sitemap().includes(pids.suspended))
    assert.strictEqual(pidOf(S.suspended), pids.suspended, 'same address after re-approval')
  })

  await check('full text: hidden while the legal restriction is active; with it lifted (synthetic only) only the approved version is offered', async () => {
    assert.strictEqual(sqlOk(`select active from release_restrictions where key = 'fulltext_legal_advice'`), 't')
    let r = record(pids.fulltext)
    assert.ok(r, 'the record itself is public'); assert.strictEqual(r.fulltext, null); assert.strictEqual(doc(pids.fulltext), null)
    lift()
    try {
      r = record(pids.fulltext)
      assert.deepStrictEqual(r.fulltext, { format: 'pdf', size: 1234 })
      const d = doc(pids.fulltext)
      assert.strictEqual(d.storage_path, sqlOk(`select storage_path from document_versions where id = ${lit(FT.version)}`))
      assert.match(d.storage_path, /^dissemination\//, 'the approved copy, never the submitted original')
      assert.notStrictEqual(d.storage_path, sqlOk(`select file_path from papers where id = ${lit(S.fulltext)}`))
      assert.strictEqual(doc(pids.ftVersionWithdrawn), null, 'a withdrawn version is not served')
      assert.strictEqual(record(pids.ftVersionWithdrawn).fulltext, null, 'and the record says so')
      assert.strictEqual(doc(pidOf(DOCX.id)).format, 'docx')
      // A superseding copy: the new one is served, the old one never again.
      const sha = crypto.createHash('sha256').update('redacted').digest('hex')
      const red = ok('admin_prepare_document', A, S.fulltext, 'redacted_copy', 'pdf', 99, null, 'Signatures removed.')
      ok('admin_finalize_document', A, red.id, sha, 99)
      approveLegacy(S.fulltext, 'record_abstract_fulltext', red.id)
      assert.strictEqual(sqlOk(`select state from document_versions where id = ${lit(FT.version)}`), 'superseded')
      assert.strictEqual(doc(pids.fulltext).storage_path, sqlOk(`select storage_path from document_versions where id = ${lit(red.id)}`))
      // Every hidden state stays without a document too.
      for (const k of hidden) if (pids[k]) assert.strictEqual(doc(pids[k]), null, k)
      // Withdrawal takes the document away at once.
      assert.strictEqual(decide(S.fulltext, 'withdrawn', 'Author request.').ok, true)
      assert.strictEqual(doc(pids.fulltext), null); assert.strictEqual(record(pids.fulltext), null)
    } finally {
      restore()
    }
    assert.strictEqual(doc(pidOf(DOCX.id)), null, 'restored: no full text anywhere')
  })

  await check('no public output carries a private field, contact, token, path, note or internal id', async () => {
    const text = everythingPublic()
    for (const re of PRIVATE) assert.ok(!re.test(text), `leak: ${re}`)
    for (const id of Object.values(S)) assert.ok(!text.includes(id), 'a paper UUID leaked')
    // Supervisor appears only for a thesis, as the work's own metadata.
    assert.strictEqual(record(pids.eligible).supervisor_name, 'Dr Private Supervisor')
  })

  await check('search: English and Arabic, folded conservatively (alef, taa marbuta, harakat, digits), every word required', async () => {
    const p1 = paper({ title: 'Malaria Prevention in Kassala 2019', title_ar: 'الوقاية من الملاريا في كسلا', abstract_ar: 'تتناول الدراسة إستراتيجيات الوقاية.', year: 2019, type: 'article', degree: 'PhD' })
    approveLegacy(p1)
    const pid = pidOf(p1)
    const hit = (qq) => cat({ q: qq }).items.map((i) => i.public_id).includes(pid)
    assert.ok(hit('malaria')); assert.ok(hit('MALARIA kassala')); assert.ok(!hit('malaria khartoum'))
    assert.ok(hit('الملاريا')); assert.ok(hit('الوقايه'), 'taa marbuta')
    assert.ok(hit('استراتيجيات'), 'hamza on alef folded'); assert.ok(hit('الْمَلَارِيَا'), 'harakat ignored')
    assert.ok(hit('Amna'), 'author names are searched')
    assert.ok(!hit('private'), 'private contact details are not searched')
    const r = record(pid)
    assert.strictEqual(r.title_ar, 'الوقاية من الملاريا في كسلا', 'display text unchanged')
    assert.ok(hit('kassala ٢٠١٩'), 'Arabic-Indic digits in a query are folded')
  })

  await check('filters, combined filters, counts and pagination are consistent and bounded', async () => {
    for (let i = 0; i < 7; i++) approveLegacy(paper({ title: `Pagination Study ${i}`, year: 2015 + (i % 3), degree: i % 2 ? 'PhD' : 'MSc', type: i % 2 ? 'article' : 'thesis' }))
    const all = cat({ q: 'pagination', limit: 3 })
    assert.strictEqual(all.total, 7); assert.strictEqual(all.items.length, 3)
    const pages = [1, 2, 3].flatMap((page) => cat({ q: 'pagination', limit: 3, page }).items.map((i) => i.public_id))
    assert.strictEqual(new Set(pages).size, 7, 'no record repeated or skipped across pages')
    assert.deepStrictEqual(cat({ q: 'pagination', limit: 3, page: 3 }).items.length, 1)
    assert.strictEqual(cat({ q: 'pagination', limit: 500 }).limit, 50, 'bounded')
    // Deterministic order: year descending, then title.
    const years = cat({ q: 'pagination', limit: 50 }).items.map((i) => i.year)
    assert.deepStrictEqual(years, [...years].sort((a, b) => b - a))
    const combined = cat({ q: 'pagination', year: 2016, degree: 'PhD' })
    assert.ok(combined.items.every((i) => i.year === 2016 && i.degree_type === 'PhD'))
    // Each facet count equals the result count after choosing it.
    for (const y of all.facets.year) assert.strictEqual(cat({ q: 'pagination', year: y.value }).total, y.count)
    for (const d of all.facets.degree) assert.strictEqual(cat({ q: 'pagination', degree: d.value }).total, d.count)
    for (const t of all.facets.type) assert.strictEqual(cat({ q: 'pagination', type: t.value }).total, t.count)
    assert.strictEqual(cat({ q: 'zzzz-nothing' }).total, 0)
    assert.strictEqual(cat({ type: 'poem' }).error, 'invalid_filter')
    assert.strictEqual(cat({ unit: 'not-a-uuid' }).error, 'invalid_filter')
  })

  await check('browser roles and a volunteer cannot use the public functions directly; administrators get a link only when public', async () => {
    for (const role of ['anon', 'authenticated']) {
      for (const fn of [`public_record('abc')`, `public_catalogue('{}')`, `public_document('abc')`, 'public_sitemap()']) {
        assert.ok(psql(`set role ${role}; select ${fn};`).error, `${role} ${fn}`)
      }
      assert.ok(psql(`set role ${role}; select * from public_records;`).error)
    }
    assert.strictEqual(q('admin_public_link', A, S.eligible).public_id, pids.eligible)
    assert.strictEqual(q('admin_public_link', A, S.withdrawn).public_id, null)
    assert.ok(psql(`select admin_public_link(${lit(V)}, ${lit(S.eligible)})`).error, 'volunteers get no link')
  })

  await check('every later change removes eligibility on every surface at once', async () => {
    const p = paper({ title: 'Later Changes Study' })
    approveLegacy(p)
    const pid = pidOf(p)
    const present = () => !!record(pid) && sitemap().includes(pid) && cat({ q: 'later changes' }).total === 1
    assert.ok(present())
    const steps = [
      ['embargo', () => ok('admin_set_embargo', A, p, '2999-01-01', 'x'), () => ok('admin_set_embargo', A, p, null, null)],
      ['blocking issue', () => ok('admin_raise_issue', A, p, 'rights', 'x', true), null],
    ]
    for (const [name, on, off] of steps) {
      on(); assert.ok(!record(pid) && !sitemap().includes(pid) && cat({ q: 'later changes' }).total === 0, name)
      if (off) { off(); assert.ok(present(), `${name} lifted`) }
    }
  })

  execFileSync('dropdb', ['--if-exists', DB])
  console.log(failed ? `\n${failed} check(s) failed.` : '\nAll M5 real-database checks passed.')
  process.exit(failed ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
