#!/usr/bin/env node
// Optional reader and editorial checks in isolated hosted Postgres.
// Synthetic data only. Never run against a hosted Supabase project.
const assert = require('node:assert')
const crypto = require('node:crypto')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const ROOT = path.join(__dirname, '../..')
const { makePsql, lit } = require('./pg-adapter')
const DB = 'knowledge_test'
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
  run(path.join(ROOT, 'supabase/schema.sql'))
}

const A = crypto.randomUUID()
const V = crypto.randomUUID()
const q = (fn, ...args) => json(`select ${fn}(${args.map((a) => (a === null ? 'null' : typeof a === 'object' ? `${lit(JSON.stringify(a))}::jsonb` : lit(a))).join(', ')})`)
const ok = (fn, ...args) => { const r = q(fn, ...args); assert.ok(r && r.ok !== false, `${fn}: ${JSON.stringify(r)}`); return r }
const record = (pid) => q('public_record', pid)
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
async function main(){
  setup()
  sqlOk(`insert into auth.users(id,email,email_confirmed_at)values(${lit(A)},'admin@example.invalid',now()),(${lit(V)},'vol@example.invalid',now());
    select bootstrap_first_administrator(${lit(A)});
    insert into staff_members(user_id,role,active,created_by)values(${lit(V)},'volunteer',true,${lit(A)});`)
  const id=paper({abstract:'This synthetic study surveyed 40 farms. Water use fell by 12 percent.',abstract_ar:'شملت هذه الدراسة التجريبية 40 مزرعة. انخفض استخدام المياه بنسبة 12 بالمئة.'})
  const tag=n,hash=crypto.createHash('sha256').update('secret-token-'+tag).digest('hex')
  approveLegacy(id)
  const pid=pidOf(id)
  let source, draft, permission
  await check('no implied AI permission for an approved paper',()=>{
    assert.equal(q('knowledge_source',pid),null)
    assert.ok(record(pid))
    permission=q('knowledge_permission',hash,'en',null,null)
    assert.equal(permission.granted,false)
    assert.equal(permission.hash,crypto.createHash('sha256').update(permission.text).digest('hex'))
  })
  await check('bad token, notice mismatch and browser RPC access refused',()=>{
    assert.ok(psql(`select knowledge_permission('${'0'.repeat(64)}','en');`).error)
    assert.ok(psql(`select knowledge_permission(${lit(hash)},'en',true,'wrong');`).error)
    for(const role of ['anon','authenticated']){
      assert.ok(psql(`set role ${role};select knowledge_source(${lit(pid)});`).error)
      assert.ok(psql(`set role ${role};select * from knowledge_permissions;`).error)
    }
  })
  await check('separate grant gives only public abstracts; history is immutable',()=>{
    assert.equal(q('knowledge_permission',hash,'en',true,permission.hash).granted,true)
    source=q('knowledge_source',pid)
    assert.ok(source.hash)
    assert.ok(!JSON.stringify(source).includes('@example.invalid'))
    assert.ok(!JSON.stringify(source).includes('file_path'))
    assert.ok(psql('update knowledge_permissions set granted=false;').error)
    assert.ok(psql('delete from knowledge_permissions;').error)
    assert.ok(psql(`select knowledge_admin(${lit(V)},${lit(id)});`).error)
  })
  await check('draft stays private; explicit administrator publication works',()=>{
    draft=ok('knowledge_save_draft',A,id,source.hash,{headline:'Synthetic water study',headline_ar:'دراسة تجريبية للمياه',body_en:'This study surveyed 40 farms.',body_ar:'شملت الدراسة 40 مزرعة.',evidence:{en:[],ar:[]},is_ai_generated:true})
    assert.equal(q('knowledge_article',pid),null)
    assert.ok(psql(`select knowledge_publish(${lit(V)},${lit(id)},${lit(draft.version_id)},true);`).error)
    ok('knowledge_publish',A,id,draft.version_id,true)
    assert.equal(q('knowledge_article',pid).headline,'Synthetic water study')
    assert.ok(!JSON.stringify(q('knowledge_article',pid)).includes('permission_id'))
  })
  await check('stale version cannot publish; edited draft creates another version',()=>{
    const next=ok('knowledge_save_draft',A,id,source.hash,{headline:'Updated study',headline_ar:'دراسة محدّثة',body_en:'A study of 40 farms.',body_ar:'دراسة عن 40 مزرعة.',is_ai_generated:false})
    assert.ok(psql(`select knowledge_publish(${lit(A)},${lit(id)},${lit(draft.version_id)},true);`).error)
    assert.equal(q('knowledge_article',pid).headline,'Synthetic water study')
    ok('knowledge_publish',A,id,next.version_id,true)
    assert.equal(q('knowledge_article',pid).headline,'Updated study')
    assert.equal(sqlOk('select count(*) from article_versions'),'2')
  })
  await check('withdraw permission hides article and prevents processing, regrant does not republish',()=>{
    q('knowledge_permission',hash,'en',false,permission.hash)
    assert.equal(q('knowledge_source',pid),null);assert.equal(q('knowledge_article',pid),null)
    assert.ok(record(pid),'ordinary paper remains published')
    q('knowledge_permission',hash,'en',true,permission.hash)
    assert.notEqual(q('knowledge_source',pid).hash,source.hash)
    assert.equal(q('knowledge_article',pid),null)
  })
  await check('withdrawing paper also hides knowledge source',()=>{
    assert.equal(decide(id,'withdrawn','Synthetic test').ok,true)
    assert.equal(q('knowledge_source',pid),null)
    assert.equal(q('knowledge_article',pid),null)
  })
  execFileSync('dropdb',['--if-exists',DB])
  if(failed)process.exitCode=1
}
main().catch(e=>{console.error(e);process.exitCode=1})
