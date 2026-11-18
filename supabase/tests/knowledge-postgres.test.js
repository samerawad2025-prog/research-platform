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
  if(process.env.KNOWLEDGE_UPGRADE === '1'){
    const old=execFileSync('git',['show','00551a440879870bc21a357d9f3449be74ddf380:supabase/schema.sql'],{encoding:'utf8'})
    execFileSync('psql',['-X','-q','-v','ON_ERROR_STOP=1','-d',DB],{input:old,stdio:['pipe','ignore','pipe']})
    run(path.join(ROOT,'supabase/migrations/0021_reader_articles.sql'))
    const before=paper()
    const snapshot=sqlOk(`select to_jsonb(p)::text from papers p where id=${lit(before)}`)
    run(path.join(ROOT,'supabase/migrations/0022_bundled_submission_agreement.sql'))
    assert.equal(sqlOk(`select to_jsonb(p)::text from papers p where id=${lit(before)}`),snapshot)
    assert.equal(sqlOk(`select count(*) from knowledge_permissions where paper_id=${lit(before)}`),'0')
  }else run(path.join(ROOT, 'supabase/schema.sql'))
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

  await check('bundled terms: exact evidence, atomic finalization, no legacy grant, retry and withdrawal',()=>{
    const {AGREEMENTS}=require('../../lib/submission/agreements')
    const fs=require('node:fs')
    sqlOk("update extraction_policy set mode='automatic';")
    for(const language of ['en','ar']){
      const agreement=AGREEMENTS.find(a=>a.versionLabel==='Version 5'&&a.language===language)
      const notice=json("select to_jsonb(n) from knowledge_notices n where version='submission-v5-2026-11-18'")
      const text=fs.readFileSync(path.join(ROOT,agreement.file),'utf8')
      assert.equal(notice['text_'+language],text)
      assert.equal(crypto.createHash('sha256').update(text).digest('hex'),agreement.sha256)
      sqlOk(`update agreement_versions set active=true where id=${lit(agreement.id)};`)
      const token=crypto.randomBytes(32).toString('hex'), tokenHash=crypto.createHash('sha256').update(token).digest('hex')
      const ih=crypto.randomBytes(32).toString('hex')
      const args=[ih,agreement.id,language,agreement.sha256,'author','record_abstract','automatic','Synthetic Bundled','bundle@example.invalid',null,'pdf',123,1800,'automatic',new Date().toISOString(),language==='en'?'automatic':'manual','gemini_api_unpaid']
      const intent=q('create_submission_intent',...args)
      assert.equal(sqlOk('select count(*) from knowledge_permissions where version=\'submission-v5-2026-11-18\''),language==='en'?'0':'1')
      // Force a grant failure. The paper and intent finalization must roll back together.
      sqlOk("create function test_refuse_grant() returns trigger language plpgsql as $test$ begin raise exception 'synthetic grant failure'; end; $test$; create trigger test_refuse_grant before insert on knowledge_permissions for each row execute function test_refuse_grant();")
      assert.ok(psql(`select finalize_submission_intent(${lit(intent.id)},${lit(ih)},123,'${'f'.repeat(64)}',${lit(tokenHash)});`).error)
      assert.equal(sqlOk(`select status from submission_acceptances where id=${lit(intent.id)}`),'open')
      assert.equal(sqlOk(`select count(*) from papers where submission_acceptance_id=${lit(intent.id)}`),'0')
      sqlOk('drop trigger test_refuse_grant on knowledge_permissions; drop function test_refuse_grant();')
      const final=q('finalize_submission_intent',intent.id,ih,123,'f'.repeat(64),tokenHash)
      let events=json(`select jsonb_agg(k) from knowledge_permissions k where paper_id=${lit(final.paper_id)}`)
      assert.equal(events.length,1);assert.equal(events[0].granted,true);assert.equal(events[0].text_sha256,agreement.sha256);assert.equal(events[0].language,language)
      assert.equal(q('get_paper_for_confirmation',token).bundled_knowledge,true)
      assert.equal(q('get_paper_for_confirmation','wrong'),null)
      assert.equal(q('external_ai_permission',final.paper_id).permitted,language==='en')
      q('finalize_submission_intent',intent.id,ih,123,'f'.repeat(64),tokenHash)
      assert.equal(sqlOk(`select count(*) from knowledge_permissions where paper_id=${lit(final.paper_id)}`),'1')
      sqlOk(`update papers set metadata_confirmed_at=now() where id=${lit(final.paper_id)};`)
      const current=q('knowledge_permission',tokenHash,language,null,null)
      assert.equal(current.granted,true)
      q('knowledge_permission',tokenHash,language,false,current.hash)
      q('finalize_submission_intent',intent.id,ih,123,'f'.repeat(64),tokenHash)
      assert.equal(q('knowledge_permission',tokenHash,language,null,null).granted,false,'retry cannot undo withdrawal')
    }
    const legacy=AGREEMENTS.find(a=>a.versionLabel==='Version 4'&&a.language==='en')
    sqlOk(`update agreement_versions set active=true where id=${lit(legacy.id)}`)
    const ih=crypto.randomBytes(32).toString('hex')
    const intent=q('create_submission_intent',ih,legacy.id,'en',legacy.sha256,'author','record_abstract','manual','Synthetic Old','old@example.invalid',null,'pdf',123,1800,'manual',new Date().toISOString(),'manual',null)
    const final=q('finalize_submission_intent',intent.id,ih,123,'e'.repeat(64),'d'.repeat(64))
    assert.equal(sqlOk(`select count(*) from knowledge_permissions where paper_id=${lit(final.paper_id)}`),'0')
    for(const role of ['anon','authenticated','service_role']){
      assert.ok(psql(`set role ${role};select record_bundled_knowledge_permission();`).error)
    }
  })

  execFileSync('dropdb',['--if-exists',DB])
  if(failed)process.exitCode=1
}
main().catch(e=>{console.error(e);process.exitCode=1})
