#!/usr/bin/env node
//
// The extraction route logic against a REAL, disposable local Postgres
// (never a Supabase project). Run by supabase/tests/run-0011.sh, which
// provides PGHOST/PGPORT/PGUSER.
//
// What this adds over scripts/test-extraction-mode.js (which uses an
// in-memory stand-in): real constraints, real undefined-column errors
// before migration 0011, the real RPCs, and the PRE-M1 PRODUCTION route
// (app/api/extract/route.js at origin/research-platform) executed as-is
// against the migrated schema, to prove the migration is safe to apply
// while that code is still deployed.
//
// The route code talks to the database through the supabase-js query
// builder. A tiny adapter below turns exactly the builder calls the
// route makes into SQL, run through psql. It is a test harness, not a
// PostgREST reimplementation; PostgREST itself is not exercised here.
// No provider is contacted: the provider is the built-in mock, or a
// counted fake, and global fetch is a spy that fails the run if called.

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { PDFDocument } = require('pdf-lib')

const ROOT = path.join(__dirname, '../..')
const { handleExtract, handleManualChoice } = require(path.join(ROOT, 'lib/extraction/extractHandler'))
const { runExtraction } = require(path.join(ROOT, 'lib/extraction/orchestrator'))
const { getProvider } = require(path.join(ROOT, 'lib/ai'))

const BASE_REF = process.env.BASE_REF || 'origin/research-platform'
const DB = 'm1_handler_test'

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

const network = []
global.fetch = async (url) => { network.push(String(url)); throw new Error('network is not allowed in this test') }

// --- psql -----------------------------------------------------------------------
function psql(sql, { db = DB } = {}) {
  try {
    const out = execFileSync('psql', ['-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-d', db, '-c', sql], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { out: out.trim(), error: null }
  } catch (err) {
    const stderr = String(err.stderr || '')
    const m = stderr.match(/ERROR:\s+([0-9A-Z]{5}):\s+(.*)/)
    return { out: null, error: { code: m ? m[1] : 'unknown', message: m ? m[2] : stderr.trim() } }
  }
}
function sqlOk(sql, opts) {
  const r = psql(sql, opts)
  if (r.error) throw new Error(`${r.error.code} ${r.error.message}\n${sql}`)
  return r.out
}
const json = (sql) => JSON.parse(sqlOk(sql) || 'null')

function lit(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

// --- supabase-js builder → SQL ------------------------------------------------
function pgClient(files) {
  function builder(table) {
    const q = { table, op: 'select', cols: '*', filters: [], patch: null, rows: null, returning: null, single: null }
    const where = () =>
      q.filters.length
        ? 'where ' + q.filters.map(([k, c, v]) => (k === 'eq' ? `${c} = ${lit(v)}` : k === 'lt' ? `${c} < ${lit(v)}` : v === null ? `${c} is null` : `${c} is ${lit(v)}`)).join(' and ')
        : ''
    function run() {
      let sql
      if (q.op === 'select') {
        sql = `select coalesce(json_agg(t), '[]') from (select ${q.cols} from ${table} ${where()}) t`
      } else if (q.op === 'update') {
        const set = Object.entries(q.patch).map(([k, v]) => `${k} = ${lit(v)}`).join(', ')
        sql = `with u as (update ${table} set ${set} ${where()} returning ${q.returning || 'id'}) select coalesce(json_agg(u), '[]') from u`
      } else {
        const rows = Array.isArray(q.rows) ? q.rows : [q.rows]
        const cols = Object.keys(rows[0])
        const values = rows.map((r) => `(${cols.map((c) => lit(r[c])).join(', ')})`).join(', ')
        sql = `with i as (insert into ${table} (${cols.join(', ')}) values ${values} returning ${q.returning || 'id'}) select coalesce(json_agg(i), '[]') from i`
      }
      const r = psql(sql)
      if (r.error) return { data: null, error: r.error }
      const rows = JSON.parse(r.out)
      if (q.single === 'maybe') return { data: rows[0] ?? null, error: null }
      if (q.single === 'single') return { data: rows[0] ?? null, error: null }
      return { data: q.op === 'select' || q.returning ? rows : null, error: null }
    }
    const b = {
      select(cols) { if (q.op === 'select') q.cols = cols || '*'; else q.returning = cols || 'id'; return b },
      update(patch) { q.op = 'update'; q.patch = patch; return b },
      insert(rows) { q.op = 'insert'; q.rows = rows; return b },
      eq(c, v) { q.filters.push(['eq', c, v]); return b },
      is(c, v) { q.filters.push(['is', c, v]); return b },
      lt(c, v) { q.filters.push(['lt', c, v]); return b },
      maybeSingle() { q.single = 'maybe'; return b },
      single() { q.single = 'single'; return b },
      then(resolve, reject) { try { resolve(run()) } catch (e) { reject(e) } },
    }
    return b
  }
  return {
    from: builder,
    storage: { from: () => ({ download: async (p) => (files[p] ? { data: new Blob([files[p]]), error: null } : { data: null, error: { message: 'not found' } }) }) },
  }
}

// --- database setup -------------------------------------------------------------
function createPreM1Database() {
  execFileSync('dropdb', ['--if-exists', DB])
  execFileSync('createdb', [DB])
  sqlOk(fs.readFileSync(path.join(__dirname, 'supabase-stubs.sql'), 'utf8'))
  const schema = execFileSync('git', ['show', `${BASE_REF}:supabase/schema.sql`], { cwd: ROOT, encoding: 'utf8' })
  const tmp = path.join(os.tmpdir(), 'm1-pre-schema.sql')
  fs.writeFileSync(tmp, schema)
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', tmp], { stdio: ['ignore', 'ignore', 'pipe'] })
  sqlOk(`insert into researchers (id, full_name, email) values ('00000000-0000-0000-0000-000000000001', 'Synthetic Submitter', 'synthetic@example.invalid')`)
}
function applyMigration() {
  execFileSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-d', DB, '-f', path.join(ROOT, 'supabase/migrations/0011_manual_entry.sql')], { stdio: ['ignore', 'ignore', 'pipe'] })
}

let seq = 0
function seedPaper(over = {}) {
  seq += 1
  const token = `tok-${seq}-${crypto.randomUUID()}`
  const cols = {
    file_path: `${seq}.pdf`, permission_to_process: true, publication_scope: '{abstract_and_citation}',
    submitted_by: '00000000-0000-0000-0000-000000000001', extraction_status: 'pending',
    confirmation_token_hash: crypto.createHash('sha256').update(token).digest('hex'), ...over,
  }
  const id = sqlOk(`insert into papers (${Object.keys(cols).join(', ')}) values (${Object.values(cols).map((v) => (v && typeof v === 'object' ? lit(JSON.stringify(v)) : lit(v))).join(', ')}) returning id`)
  return { id, token }
}
const row = (id) => json(`select to_jsonb(p) from papers p where id = ${lit(id)}`)
const generations = (id) => Number(sqlOk(`select count(*) from ai_generations where paper_id = ${lit(id)}`))

// --- the pre-M1 production route, unmodified apart from module syntax -------------
function loadOldRoute(adminClient) {
  let src = execFileSync('git', ['show', `${BASE_REF}:app/api/extract/route.js`], { cwd: ROOT, encoding: 'utf8' })
  const req = (rel) => `require(${JSON.stringify(path.join(ROOT, rel))})`
  src = src
    .replace("import crypto from 'node:crypto'", "const crypto = require('node:crypto')")
    .replace("import { getSupabaseAdmin } from '../../../lib/supabaseAdminClient'", 'const getSupabaseAdmin = () => globalThis.__oldRouteAdmin')
    .replace("import { runExtraction } from '../../../lib/extraction/orchestrator'", `const { runExtraction } = ${req('lib/extraction/orchestrator')}`)
    .replace("import { decideApplication } from '../../../lib/extraction/applyResult'", `const { decideApplication } = ${req('lib/extraction/applyResult')}`)
    .replace("import { getProvider } from '../../../lib/ai'", `const { getProvider } = ${req('lib/ai')}`)
    .replace("import { extractionAllowed } from '../../../lib/env'", `const { extractionAllowed } = ${req('lib/env')}`)
    .replace('export const maxDuration', 'const maxDuration')
    .replace('export async function POST', 'async function POST')
  assert.ok(!/^\s*(import|export)\s/m.test(src), 'every import/export of the old route was translated')
  src += '\nmodule.exports = { POST }\n'
  const file = path.join(os.tmpdir(), `old-route-${process.pid}.cjs`)
  fs.writeFileSync(file, src)
  globalThis.__oldRouteAdmin = adminClient
  return require(file).POST
}
async function callOld(POST, token) {
  const res = await POST(new Request('http://local/api/extract', { method: 'POST', body: JSON.stringify({ token }) }))
  return { status: res.status, body: await res.json() }
}

const quiet = { log() {}, warn() {}, error() {} }
function counted(real) {
  const s = { runs: 0, providers: 0 }
  s.getProvider = () => { s.providers++; return real?.getProvider ? real.getProvider() : getProvider() }
  s.runExtraction = async (a) => { s.runs++; return real?.runExtraction ? real.runExtraction(a) : runExtraction(a) }
  return s
}
const newCall = (client, token, env, s = counted()) =>
  handleExtract({ token, env, getSupabaseAdmin: () => client, getProvider: s.getProvider, runExtraction: s.runExtraction, log: quiet }).then((r) => ({ ...r, s }))
const choose = (client, token) => handleManualChoice({ token, getSupabaseAdmin: () => client, log: quiet })

async function main() {
  process.env.AI_PROVIDER = 'mock'
  process.env.MOCK_SCENARIO = 'thesis'
  const pdf = await (async () => { const d = await PDFDocument.create(); d.addPage().drawText('Synthetic thesis', { x: 50, y: 700 }); return Buffer.from(await d.save()) })()
  const files = new Proxy({}, { get: () => pdf })
  const client = pgClient(files)

  // ---------------------------------------------------------------- before 0011
  createPreM1Database()
  const oldPOST = loadOldRoute(client)

  await check('before 0011: the new route refuses in every mode, says why, writes nothing', async () => {
    const p = seedPaper()
    const before = row(p.id)
    for (const env of [{ EXTRACTION_MODE: 'manual' }, { EXTRACTION_MODE: 'automatic' }, {}, { EXTRACTION_MODE: 'bogus' }]) {
      const r = await newCall(client, p.token, env)
      assert.strictEqual(r.status, 503, JSON.stringify(r.body))
      assert.strictEqual(r.body.reason, 'database_not_ready')
      assert.strictEqual(r.s.runs + r.s.providers, 0)
    }
    const c = await choose(client, p.token)
    assert.strictEqual(c.status, 503)
    assert.strictEqual(c.body.recorded, false)
    assert.deepStrictEqual(row(p.id), before)
  })

  await check('before 0011: the pre-M1 production route works (baseline)', async () => {
    const p = seedPaper()
    const r = await callOld(oldPOST, p.token)
    assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    assert.strictEqual(row(p.id).extraction_status, 'completed')
  })

  const historical = seedPaper({ extraction_status: 'completed', metadata_confirmed_at: '2026-09-20T10:00:00Z', title: 'Confirmed thesis', year: 2019 })
  sqlOk(`insert into ai_generations (paper_id, generation_type, provider, model_used, status, result_data, notes) values (${lit(historical.id)}, 'metadata_extraction', 'gemini', 'synthetic', 'success', '{}', 'Pass 1')`)
  const historicalBefore = row(historical.id)

  // ---------------------------------------------------------------- apply 0011
  applyMigration()

  await check('after 0011, pre-M1 production code: extraction, the confirmation read and confirm all still work', async () => {
    const p = seedPaper()
    const r = await callOld(oldPOST, p.token)
    assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    const after = row(p.id)
    assert.strictEqual(after.extraction_status, 'completed')
    assert.ok(after.title)
    assert.strictEqual(after.manual_entry_at, null)
    const v = json(`select get_paper_for_confirmation(${lit(p.token)})`)
    assert.strictEqual(v.extraction_status, 'completed')
    assert.ok('manual_entry_source' in v, 'the extra key is present and harmless')
    sqlOk(`set role anon; select confirm_researcher_metadata(${lit(p.token)}, '[{"full_name":"Synthetic Submitter"}]'::jsonb, '{"title":"Kept"}'::jsonb)`)
    assert.strictEqual(row(p.id).title, 'Kept')
  })

  await check('rollback limit, shown: the pre-M1 route ignores a recorded manual decision', async () => {
    // Why the application must not be rolled back below M1 while manual
    // decisions exist without reviewing them first (docs/deployment.md).
    const p = seedPaper({ manual_entry_at: '2026-09-26T00:00:00Z', manual_entry_source: 'researcher' })
    const r = await callOld(oldPOST, p.token)
    assert.strictEqual(r.status, 200)
    assert.strictEqual(row(p.id).extraction_status, 'completed', 'old code extracts it anyway')
  })

  await check('after 0011, manual or missing/invalid mode: decision stored, history kept, no later provider call', async () => {
    for (const env of [{ EXTRACTION_MODE: 'manual' }, {}, { EXTRACTION_MODE: 'autmatic' }]) {
      const pending = seedPaper()
      const failedP = seedPaper({ extraction_status: 'failed', failure_code: 'timeout', extraction_started_at: '2026-01-01T00:00:00Z' })
      for (const p of [pending, failedP]) {
        const r = await newCall(client, p.token, env)
        assert.strictEqual(r.status, 200, JSON.stringify(r.body))
        assert.strictEqual(r.body.recorded, true)
        assert.strictEqual(row(p.id).manual_entry_source, 'mode')
      }
      assert.strictEqual(row(pending.id).extraction_status, 'pending')
      assert.strictEqual(row(failedP.id).extraction_status, 'failed')
      assert.strictEqual(row(failedP.id).failure_code, 'timeout')
      for (const p of [pending, failedP]) {
        const later = await newCall(client, p.token, { EXTRACTION_MODE: 'automatic' })
        assert.strictEqual(later.s.runs + later.s.providers, 0)
      }
    }
  })

  await check('after 0011, researcher choice: persists, blocks retry and stale recovery, keeps history', async () => {
    const stale = seedPaper({ extraction_status: 'processing', extraction_started_at: '2026-01-01T00:00:00Z' })
    const transient = seedPaper({ extraction_status: 'failed', failure_code: 'api_error', extraction_started_at: '2026-01-01T00:00:00Z' })
    for (const p of [stale, transient]) {
      const c = await choose(client, p.token)
      assert.deepStrictEqual(c.body, { recorded: true, manualEntry: 'researcher' })
      const v = json(`select get_paper_for_confirmation(${lit(p.token)})`)
      assert.strictEqual(v.manual_entry_source, 'researcher', 'reopening the link returns the choice')
      const r = await newCall(client, p.token, { EXTRACTION_MODE: 'automatic' })
      assert.strictEqual(r.s.runs + r.s.providers, 0)
    }
    assert.strictEqual(row(stale.id).extraction_status, 'processing', 'not relabelled')
    assert.strictEqual(row(transient.id).failure_code, 'api_error')
  })

  await check('after 0011, race: choice recorded mid-run - result appended, not applied', async () => {
    const p = seedPaper()
    const gensBefore = generations(p.id)
    const s = counted({
      getProvider: () => ({}),
      runExtraction: async (a) => { await choose(client, p.token); return runExtraction({ ...a, provider: getProvider() }) },
    })
    const r = await newCall(client, p.token, { EXTRACTION_MODE: 'automatic' }, s)
    assert.strictEqual(r.status, 200, JSON.stringify(r.body))
    assert.strictEqual(r.body.appliedToPapers, false)
    const after = row(p.id)
    assert.strictEqual(after.title, null)
    assert.strictEqual(after.last_applied_generation_id, null)
    assert.strictEqual(after.manual_entry_source, 'researcher')
    assert.ok(generations(p.id) > gensBefore, 'the run is in the append-only history')
  })

  await check('after 0011, a real write failure is reported as not recorded and sends nothing', async () => {
    sqlOk(`create or replace function block_manual() returns trigger language plpgsql as $$ begin
             if new.manual_entry_at is not null and new.title = 'BlockMe' then raise exception 'simulated write failure'; end if;
             return new; end $$;
           create trigger block_manual before update on papers for each row execute function block_manual();`)
    const p = seedPaper({ title: 'BlockMe' })
    const r = await newCall(client, p.token, { EXTRACTION_MODE: 'manual' })
    assert.strictEqual(r.status, 503)
    assert.strictEqual(r.body.reason, 'manual_not_recorded')
    assert.strictEqual(r.body.recorded, false)
    const c = await choose(client, p.token)
    assert.strictEqual(c.status, 503)
    assert.strictEqual(c.body.recorded, false)
    assert.strictEqual(row(p.id).manual_entry_at, null)
    sqlOk('drop trigger block_manual on papers; drop function block_manual();')
  })

  await check('after 0011: the historical confirmed record and its history are untouched by everything above', async () => {
    for (const env of [{ EXTRACTION_MODE: 'manual' }, { EXTRACTION_MODE: 'automatic' }, {}]) await newCall(client, historical.token, env)
    await choose(client, historical.token)
    const after = row(historical.id)
    for (const k of Object.keys(historicalBefore)) assert.deepStrictEqual(after[k], historicalBefore[k], k)
    assert.strictEqual(after.manual_entry_at, null)
    assert.strictEqual(generations(historical.id), 1)
  })

  assert.strictEqual(network.length, 0, 'no network request was made')
  execFileSync('dropdb', ['--if-exists', DB])
  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll real-database checks passed.')
}

main()
