#!/usr/bin/env node
//
// Tests for EXTRACTION_MODE and the extraction route's server-side rules
// (PHASE_3_PLAN.md M1). Exercises lib/extraction/extractHandler.js - the
// real body of POST /api/extract - against an in-memory stand-in for the
// Supabase client, with the network replaced by a spy.
//
// Run: node scripts/test-extraction-mode.js
// Exits non-zero on failure, so it is usable as a CI step.
//
// Every document here is synthetic. Nothing is sent anywhere: global
// fetch is replaced for the whole run and any call to it is recorded,
// which is how "zero external calls" is proven rather than assumed.

const assert = require('node:assert')
const crypto = require('node:crypto')
const { PDFDocument } = require('pdf-lib')

const { handleExtract, handleManualChoice } = require('../lib/extraction/extractHandler')
const { resolveExtractionMode } = require('../lib/env')
const { runExtraction } = require('../lib/extraction/orchestrator')
const { getProvider } = require('../lib/ai')

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

// --- network spy -------------------------------------------------------------
// Replaces fetch for the whole process. `respond` decides what a call
// returns; by default any call is a test failure waiting to happen, but
// it is still answered so the code under test cannot hang.
const network = { calls: [], respond: null }
global.fetch = async (url, init) => {
  network.calls.push(String(url))
  if (network.respond) return network.respond(url, init)
  return new Response('{}', { status: 500 })
}
function resetNetwork() {
  network.calls = []
  network.respond = null
}
const providerCalls = () => network.calls.filter((u) => u.includes('generativelanguage.googleapis.com'))

// --- in-memory Supabase ------------------------------------------------------
// Supports exactly the query shapes the handler uses. Each awaited
// statement runs synchronously, so a compare-and-swap is atomic here the
// same way a single UPDATE is atomic in Postgres.
//
// migrationApplied: false models a database without migration 0011 the
// way PostgREST reports it: any statement that names manual_entry_* is
// rejected with Postgres' undefined-column error. failUpdate, when set,
// decides whether an update fails (to simulate a write that does not
// persist for any other reason).
const NEW_COLUMNS = ['manual_entry_at', 'manual_entry_source']
const STATUSES = ['pending', 'processing', 'completed', 'partial', 'failed']

function makeDb({ papers = [], migrationApplied = true } = {}) {
  const db = {
    papers: papers.map((p) => ({ ...p })),
    ai_generations: [],
    downloads: [],
    files: {},
    failUpdate: null,
  }
  const undefinedColumn = { code: '42703', message: 'column papers.manual_entry_at does not exist' }

  function builder(table) {
    const q = { table, op: 'select', filters: [], patch: null, rows: null, returning: false, single: null }
    const matches = (row) =>
      q.filters.every(([kind, col, v]) => {
        if (kind === 'eq') return row[col] === v
        if (kind === 'is') return v === null ? row[col] == null : row[col] === v
        if (kind === 'lt') return row[col] != null && row[col] < v
        throw new Error(`unsupported filter ${kind}`)
      })

    function run() {
      const rows = db[q.table]
      const namesNewColumn =
        (q.columns && NEW_COLUMNS.some((c) => q.columns.includes(c))) ||
        q.filters.some(([, col]) => NEW_COLUMNS.includes(col)) ||
        (q.patch && NEW_COLUMNS.some((c) => c in q.patch))
      if (!migrationApplied && q.table === 'papers' && namesNewColumn) return { data: null, error: undefinedColumn }
      if (q.op === 'update') {
        if ('extraction_status' in q.patch && !STATUSES.includes(q.patch.extraction_status)) {
          return { data: null, error: { code: '23514', message: 'violates check constraint "papers_extraction_status_check"' } }
        }
        if (db.failUpdate && db.failUpdate(q.patch)) {
          return { data: null, error: { code: '08006', message: 'connection failure' } }
        }
        const hit = rows.filter(matches)
        for (const r of hit) Object.assign(r, q.patch)
        return { data: q.returning ? hit.map((r) => ({ id: r.id })) : null, error: null }
      }
      if (q.op === 'insert') {
        const list = (Array.isArray(q.rows) ? q.rows : [q.rows]).map((r) => ({ id: crypto.randomUUID(), ...r }))
        rows.push(...list)
        const out = list.map((r) => ({ id: r.id, notes: r.notes }))
        if (q.single === 'single') return { data: out[0], error: null }
        return { data: q.returning ? out : null, error: null }
      }
      const hit = rows.filter(matches).map((r) => ({ ...r }))
      if (q.single === 'maybe') return { data: hit[0] ?? null, error: null }
      return { data: hit, error: null }
    }

    const b = {
      select(cols) { if (q.op !== 'select') q.returning = true; else q.columns = cols || '*'; return b },
      update(patch) { q.op = 'update'; q.patch = patch; return b },
      insert(rows) { q.op = 'insert'; q.rows = rows; return b },
      eq(col, v) { q.filters.push(['eq', col, v]); return b },
      is(col, v) { q.filters.push(['is', col, v]); return b },
      lt(col, v) { q.filters.push(['lt', col, v]); return b },
      maybeSingle() { q.single = 'maybe'; return b },
      single() { q.single = 'single'; return b },
      then(resolve, reject) { try { resolve(run()) } catch (e) { reject(e) } },
    }
    return b
  }

  db.client = {
    from: (table) => builder(table),
    storage: {
      from: () => ({
        download: async (path) => {
          db.downloads.push(path)
          const bytes = db.files[path]
          if (!bytes) return { data: null, error: { message: 'not found' } }
          return { data: new Blob([bytes]), error: null }
        },
      }),
    },
  }
  return db
}

const hash = (t) => crypto.createHash('sha256').update(t).digest('hex')
let seq = 0
function paperRow(overrides = {}) {
  seq += 1
  const token = overrides.token || `tok-${seq}`
  const row = {
    id: `paper-${seq}`,
    file_path: `${seq}.pdf`,
    confirmation_token_hash: hash(token),
    extraction_status: 'pending',
    extraction_started_at: null,
    created_at: new Date().toISOString(),
    metadata_confirmed_at: null,
    failure_code: null,
    last_applied_generation_id: null,
    manual_entry_at: null,
    manual_entry_source: null,
    title: null,
    title_ar: null,
    year: null,
    ...overrides,
  }
  delete row.token
  return { token, row }
}

function quietLog() {
  const lines = []
  const push = (...a) => lines.push(a.join(' '))
  return { lines, log: push, warn: push, error: push }
}

// A counted stand-in for the real provider factory and orchestrator.
function spies(real = {}) {
  const s = { providerRequested: 0, extractionRuns: 0 }
  s.getProvider = () => { s.providerRequested++; return (real.getProvider || getProvider)() }
  s.runExtraction = async (args) => { s.extractionRuns++; return (real.runExtraction || runExtraction)(args) }
  return s
}

async function call(db, token, env, s = spies(), log = quietLog()) {
  const res = await handleExtract({
    token,
    env,
    getSupabaseAdmin: () => db.client,
    getProvider: s.getProvider,
    runExtraction: s.runExtraction,
    log,
  })
  return { ...res, spies: s, log }
}

// The real provider, pointed at the real Gemini endpoint through the spy.
const GEMINI_ENV = { AI_PROVIDER: 'gemini', GEMINI_API_KEY: 'test-key-not-real', GEMINI_MODEL: 'test-model', NODE_ENV: 'production' }
function withProcessEnv(vars, fn) {
  const saved = {}
  for (const k of Object.keys(vars)) { saved[k] = process.env[k]; process.env[k] = vars[k] }
  return Promise.resolve(fn()).finally(() => {
    for (const k of Object.keys(vars)) {
      if (saved[k] === undefined) delete process.env[k]
      else process.env[k] = saved[k]
    }
  })
}

async function choose(db, token, log = quietLog()) {
  return handleManualChoice({ token, getSupabaseAdmin: () => db.client, log })
}

async function syntheticPdf(text) {
  const doc = await PDFDocument.create()
  const page = doc.addPage()
  page.drawText(text, { x: 50, y: 700, size: 12 })
  return Buffer.from(await doc.save())
}

async function main() {
  // --- configuration -----------------------------------------------------------
  await check('mode: only an explicit automatic or manual is honoured; anything else is manual', () => {
    assert.deepStrictEqual(resolveExtractionMode({ EXTRACTION_MODE: 'automatic' }), { mode: 'automatic', reason: 'configured' })
    assert.deepStrictEqual(resolveExtractionMode({ EXTRACTION_MODE: 'manual' }), { mode: 'manual', reason: 'configured' })
    assert.deepStrictEqual(resolveExtractionMode({ EXTRACTION_MODE: '  Automatic ' }), { mode: 'automatic', reason: 'configured' })
    assert.deepStrictEqual(resolveExtractionMode({}), { mode: 'manual', reason: 'missing' })
    assert.deepStrictEqual(resolveExtractionMode({ EXTRACTION_MODE: '' }), { mode: 'manual', reason: 'missing' })
    for (const bad of ['auto', 'external', 'on', 'true', 'gemini', 'automatic,manual', 'disabled']) {
      assert.deepStrictEqual(resolveExtractionMode({ EXTRACTION_MODE: bad }), { mode: 'manual', reason: 'invalid' }, bad)
    }
  })

  // --- manual mode: zero external calls, every entry point ---------------------
  for (const [label, env] of [
    ['EXTRACTION_MODE=manual', { ...GEMINI_ENV, EXTRACTION_MODE: 'manual' }],
    ['EXTRACTION_MODE missing', { ...GEMINI_ENV }],
    ['EXTRACTION_MODE invalid', { ...GEMINI_ENV, EXTRACTION_MODE: 'autmatic' }],
  ]) {
    await check(`manual (${label}): a direct request reads nothing, calls nothing, and durably records the decision`, () =>
      withProcessEnv(GEMINI_ENV, async () => {
        resetNetwork()
        const { token, row } = paperRow()
        const db = makeDb({ papers: [row] })
        db.files[row.file_path] = Buffer.from('%PDF-synthetic')
        const res = await call(db, token, env)
        assert.strictEqual(res.status, 200)
        assert.strictEqual(res.body.mode, 'manual')
        assert.strictEqual(res.body.recorded, true)
        assert.strictEqual(res.body.manualEntry, 'mode')
        assert.strictEqual(network.calls.length, 0, 'no network call of any kind')
        assert.strictEqual(res.spies.providerRequested, 0, 'provider never constructed')
        assert.strictEqual(res.spies.extractionRuns, 0, 'orchestrator never ran')
        assert.strictEqual(db.downloads.length, 0, 'the document was never even read')
        assert.strictEqual(db.ai_generations.length, 0)
        assert.strictEqual(db.papers[0].manual_entry_source, 'mode')
        assert.ok(db.papers[0].manual_entry_at)
        assert.strictEqual(db.papers[0].extraction_status, 'pending', 'no extraction attempt is invented or erased')

        // Later the deployment is fixed to automatic. The paper stays manual.
        const later = await call(db, token, { ...GEMINI_ENV, EXTRACTION_MODE: 'automatic' })
        assert.strictEqual(later.body.alreadyHandled, true)
        assert.strictEqual(later.spies.extractionRuns + later.spies.providerRequested, 0)
        assert.strictEqual(network.calls.length + db.downloads.length, 0, 'still nothing sent after the switch')
        if (label !== 'EXTRACTION_MODE=manual') {
          assert.ok(res.log.lines.some((l) => l.includes('extraction_mode_defaulted')), 'a defaulted mode is logged')
        }
      })
    )
  }

  await check('manual: retries, stale reclaims and repeated requests never reach the provider', () =>
    withProcessEnv(GEMINI_ENV, async () => {
      resetNetwork()
      const old = new Date(Date.now() - 10 * 60_000).toISOString()
      const pending = paperRow()
      const transientFailed = paperRow({ extraction_status: 'failed', failure_code: 'api_error', extraction_started_at: old })
      const stale = paperRow({ extraction_status: 'processing', extraction_started_at: old })
      const db = makeDb({ papers: [pending.row, transientFailed.row, stale.row] })
      // Real files, so a missing guard would get all the way to the provider.
      for (const p of db.papers) db.files[p.file_path] = await syntheticPdf('Synthetic')
      network.respond = () => new Response('{}', { status: 400 })
      const env = { ...GEMINI_ENV, EXTRACTION_MODE: 'manual' }
      const s = spies()
      for (let i = 0; i < 5; i++) {
        for (const p of [pending, transientFailed, stale]) await call(db, p.token, env, s)
      }
      assert.strictEqual(network.calls.length, 0)
      assert.strictEqual(s.providerRequested + s.extractionRuns, 0)
      assert.strictEqual(db.downloads.length, 0)
      assert.deepStrictEqual(db.papers.map((p) => p.extraction_status), ['pending', 'failed', 'processing'],
        'extraction history is left exactly as it was')
      assert.deepStrictEqual(db.papers.map((p) => p.manual_entry_source), ['mode', 'mode', 'mode'],
        'each paper now carries the manual decision')
      assert.strictEqual(db.papers[1].failure_code, 'api_error', 'the earlier failure stays on the record')

      // And after a switch back to automatic, none of them is picked up -
      // not the pending one, not the retryable failure, not the stale claim.
      const auto = spies()
      for (const p of [pending, transientFailed, stale]) await call(db, p.token, { ...GEMINI_ENV, EXTRACTION_MODE: 'automatic' }, auto)
      assert.strictEqual(auto.extractionRuns + auto.providerRequested + network.calls.length + db.downloads.length, 0)
    })
  )

  await check('database behind the code (0011 missing): every entry point refuses, says so, and sends nothing', () =>
    withProcessEnv(GEMINI_ENV, async () => {
      resetNetwork()
      const old = new Date(Date.now() - 10 * 60_000).toISOString()
      const papers = [paperRow(), paperRow({ extraction_status: 'failed', failure_code: 'timeout', extraction_started_at: old }), paperRow({ extraction_status: 'processing', extraction_started_at: old })]
      const db = makeDb({ papers: papers.map((p) => p.row), migrationApplied: false })
      const before = JSON.stringify(db.papers)
      const s = spies()
      for (const env of [{ ...GEMINI_ENV, EXTRACTION_MODE: 'manual' }, { ...GEMINI_ENV, EXTRACTION_MODE: 'automatic' }, { ...GEMINI_ENV }]) {
        for (const p of papers) {
          const res = await call(db, p.token, env, s)
          assert.strictEqual(res.status, 503, JSON.stringify(res.body))
          assert.strictEqual(res.body.reason, 'database_not_ready')
          assert.notStrictEqual(res.body.recorded, true, 'never claims a recorded decision')
        }
      }
      for (const p of papers) {
        const c = await choose(db, p.token)
        assert.strictEqual(c.status, 503)
        assert.strictEqual(c.body.recorded, false)
      }
      assert.strictEqual(s.extractionRuns + s.providerRequested + network.calls.length + db.downloads.length, 0)
      assert.strictEqual(JSON.stringify(db.papers), before, 'nothing was written')
    })
  )

  await check('a failed write of the manual decision is reported as not recorded, and still sends nothing', async () => {
    resetNetwork()
    const { token, row } = paperRow()
    const db = makeDb({ papers: [row] })
    db.failUpdate = (patch) => 'manual_entry_at' in patch
    const log = quietLog()
    const res = await call(db, token, { EXTRACTION_MODE: 'manual' }, spies(), log)
    assert.strictEqual(res.status, 503)
    assert.strictEqual(res.body.reason, 'manual_not_recorded')
    assert.strictEqual(res.body.recorded, false)
    assert.ok(log.lines.some((l) => l.includes('manual_entry_not_recorded')))
    const c = await choose(db, token)
    assert.strictEqual(c.status, 503)
    assert.strictEqual(c.body.recorded, false)
    assert.strictEqual(db.papers[0].manual_entry_at, null)
    assert.strictEqual(res.spies.extractionRuns + network.calls.length + db.downloads.length, 0)
  })

  await check('manual: a deployment without the service key (preview) says it recorded nothing, and sends nothing', async () => {
    resetNetwork()
    const s = spies()
    const res = await handleExtract({
      token: 'anything',
      env: { EXTRACTION_MODE: 'manual', VERCEL_ENV: 'preview' },
      getSupabaseAdmin: () => { throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set.') },
      getProvider: s.getProvider,
      runExtraction: s.runExtraction,
      log: quietLog(),
    })
    assert.strictEqual(res.status, 503)
    assert.strictEqual(res.body.mode, 'manual')
    assert.strictEqual(res.body.recorded, false)
    assert.strictEqual(network.calls.length + s.extractionRuns + s.providerRequested, 0)
  })

  await check('manual: a wrong token or a bare paper id is refused', async () => {
    const { row } = paperRow()
    const db = makeDb({ papers: [row] })
    const miss = await call(db, 'not-the-token', { EXTRACTION_MODE: 'manual' })
    assert.strictEqual(miss.status, 404)
    assert.strictEqual(miss.body.mode, 'manual', 'a bogus token shows the mode, for rollout checks')
    const missAuto = await call(db, 'not-the-token', { EXTRACTION_MODE: 'automatic', AI_PROVIDER: 'mock' })
    assert.strictEqual(missAuto.status, 404)
    assert.strictEqual(missAuto.body.mode, 'automatic')
    assert.strictEqual(missAuto.spies.extractionRuns, 0)
    assert.strictEqual((await call(db, row.id, { EXTRACTION_MODE: 'manual' })).status, 404)
    assert.strictEqual((await call(db, undefined, { EXTRACTION_MODE: 'manual' })).status, 400)
    assert.strictEqual(db.papers[0].extraction_status, 'pending')
  })

  await check('a paper with a recorded manual decision is not picked up in automatic mode', async () => {
    resetNetwork()
    const { token, row } = paperRow({ manual_entry_at: new Date().toISOString(), manual_entry_source: 'researcher' })
    const db = makeDb({ papers: [row] })
    const res = await call(db, token, { EXTRACTION_MODE: 'automatic', AI_PROVIDER: 'mock' })
    assert.strictEqual(res.body.alreadyHandled, true)
    assert.strictEqual(res.spies.extractionRuns, 0)
    assert.strictEqual(db.papers[0].extraction_status, 'pending')
  })

  // --- automatic mode ----------------------------------------------------------
  await check('automatic: controlled fixture extracts, applies and records, with no network', () =>
    withProcessEnv({ AI_PROVIDER: 'mock', MOCK_SCENARIO: 'thesis' }, async () => {
      resetNetwork()
      const { token, row } = paperRow()
      const db = makeDb({ papers: [row] })
      db.files[row.file_path] = await syntheticPdf('Synthetic thesis for tests')
      const res = await call(db, token, { EXTRACTION_MODE: 'automatic', AI_PROVIDER: 'mock', NODE_ENV: 'production' })
      assert.strictEqual(res.status, 200, JSON.stringify(res.body))
      assert.strictEqual(res.body.appliedToPapers, true)
      const p = db.papers[0]
      assert.ok(['completed', 'partial'].includes(p.extraction_status), p.extraction_status)
      assert.ok(p.title, 'an extracted title was applied')
      assert.ok(p.last_applied_generation_id)
      assert.ok(db.ai_generations.length >= 1)
      assert.strictEqual(res.spies.extractionRuns, 1)
      assert.strictEqual(network.calls.length, 0, 'the mock provider makes no request')
    })
  )

  await check('automatic: the preview guard still blocks extraction on a preview', async () => {
    resetNetwork()
    const { token, row } = paperRow()
    const db = makeDb({ papers: [row] })
    const res = await call(db, token, { EXTRACTION_MODE: 'automatic', AI_PROVIDER: 'mock', VERCEL_ENV: 'preview' })
    assert.strictEqual(res.status, 503)
    assert.strictEqual(res.body.reason, 'preview_extraction_disabled')
    assert.strictEqual(res.spies.extractionRuns + db.downloads.length, 0)
    assert.strictEqual(db.papers[0].extraction_status, 'pending')
  })

  await check('automatic: a provider error leaves a retryable failure, and manual mode then sends nothing more', () =>
    withProcessEnv(GEMINI_ENV, async () => {
      resetNetwork()
      network.respond = () => new Response(JSON.stringify({ error: { message: 'bad request' } }), { status: 400 })
      const { token, row } = paperRow()
      const db = makeDb({ papers: [row] })
      db.files[row.file_path] = await syntheticPdf('Synthetic')
      const res = await call(db, token, { ...GEMINI_ENV, EXTRACTION_MODE: 'automatic' })
      assert.strictEqual(res.status, 500)
      assert.strictEqual(db.papers[0].extraction_status, 'failed')
      assert.ok(providerCalls().length >= 1, 'the spy does see a real provider call - so zero elsewhere means zero')
      const attempts = providerCalls().length

      // Now the operator switches to manual, and the researcher presses
      // "Try again" after the cooldown.
      db.papers[0].extraction_started_at = new Date(Date.now() - 60_000).toISOString()
      const retry = await call(db, token, { ...GEMINI_ENV, EXTRACTION_MODE: 'manual' })
      assert.strictEqual(retry.body.mode, 'manual')
      assert.strictEqual(providerCalls().length, attempts, 'no further provider call')
      assert.strictEqual(db.papers[0].extraction_status, 'failed', 'the failure record is kept, not rewritten')
    })
  )

  await check('automatic: a provider timeout is recorded as a retryable failure', () =>
    withProcessEnv({ ...GEMINI_ENV, GEMINI_TIMEOUT_MS: '40' }, async () => {
      resetNetwork()
      network.respond = (url, init) =>
        new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))))
      const { token, row } = paperRow()
      const db = makeDb({ papers: [row] })
      db.files[row.file_path] = await syntheticPdf('Synthetic')
      const res = await call(db, token, { ...GEMINI_ENV, GEMINI_TIMEOUT_MS: '40', EXTRACTION_MODE: 'automatic' })
      assert.strictEqual(res.body.reason, 'timeout')
      assert.strictEqual(db.papers[0].failure_code, 'timeout')
      assert.strictEqual(res.body.status, 'failed')
    })
  )

  // --- human edits always win ----------------------------------------------------
  function extractionReturning(title) {
    return {
      finalResult: { title: { status: 'found', value: title }, document_type: 'thesis' },
      extractionYield: { zeroYield: false, foundCount: 1, totalFields: 10 },
      documentType: 'thesis',
      passesRun: 1,
      extractionStatus: 'completed',
      provider: 'mock',
      model: 'mock',
      generations: [{ pass: 1, provider: 'mock', model: 'mock', result: { title: { status: 'found', value: title } } }],
    }
  }

  await check('a result that arrives after the researcher confirmed does not overwrite them', async () => {
    const { token, row } = paperRow()
    const db = makeDb({ papers: [row] })
    db.files[row.file_path] = Buffer.from('%PDF-synthetic')
    const s = spies({
      getProvider: () => ({}),
      runExtraction: async () => {
        // While the provider "runs", the researcher chooses manual entry,
        // types their own title and confirms.
        Object.assign(db.papers[0], { title: 'Typed by the researcher', metadata_confirmed_at: new Date().toISOString() })
        return extractionReturning('Title the model found')
      },
    })
    const res = await call(db, token, { EXTRACTION_MODE: 'automatic' }, s)
    const p = db.papers[0]
    assert.strictEqual(p.title, 'Typed by the researcher')
    assert.strictEqual(p.last_applied_generation_id, null, 'the applied-result pointer did not move')
    assert.strictEqual(res.body.appliedToPapers, false)
    assert.strictEqual(p.extraction_status, 'completed', 'the run is still recorded honestly')
    assert.ok(db.ai_generations.length >= 1, 'and appended to the history')
  })

  await check('a late failure or not-research result does not move a confirmed record either', async () => {
    for (const outcome of ['throws', 'not_research']) {
      const { token, row } = paperRow()
      const db = makeDb({ papers: [row] })
      db.files[row.file_path] = Buffer.from('%PDF-synthetic')
      const s = spies({
        getProvider: () => ({}),
        runExtraction: async () => {
          Object.assign(db.papers[0], { title: 'Mine', metadata_confirmed_at: new Date().toISOString() })
          if (outcome === 'throws') throw Object.assign(new Error('provider down'), { code: 'api_error' })
          return { ...extractionReturning('x'), documentType: 'not_research' }
        },
      })
      await call(db, token, { EXTRACTION_MODE: 'automatic' }, s)
      assert.strictEqual(db.papers[0].title, 'Mine', outcome)
      assert.strictEqual(db.papers[0].last_applied_generation_id, null, outcome)
    }
  })

  await check('a confirmed paper never starts a provider call, whatever its status', async () => {
    const confirmedAt = new Date().toISOString()
    const old = new Date(Date.now() - 10 * 60_000).toISOString()
    for (const state of [
      { extraction_status: 'pending' },
      { extraction_status: 'failed', failure_code: 'timeout', extraction_started_at: old },
      { extraction_status: 'processing', extraction_started_at: old },
    ]) {
      const { token, row } = paperRow({ ...state, metadata_confirmed_at: confirmedAt, title: 'Confirmed' })
      const db = makeDb({ papers: [row] })
      const before = JSON.stringify(db.papers[0])
      const res = await call(db, token, { EXTRACTION_MODE: 'automatic', AI_PROVIDER: 'mock' })
      assert.strictEqual(res.spies.extractionRuns, 0, state.extraction_status)
      assert.strictEqual(JSON.stringify(db.papers[0]), before, 'the confirmed row is byte-identical')
    }
  })

  await check('existing confirmed and completed records are untouched in either mode', async () => {
    const { token, row } = paperRow({
      extraction_status: 'completed', metadata_confirmed_at: new Date().toISOString(),
      title: 'Confirmed thesis', year: 2019, last_applied_generation_id: 'gen-1',
    })
    const db = makeDb({ papers: [row] })
    const before = JSON.stringify(db.papers[0])
    for (const mode of ['automatic', 'manual', undefined]) {
      const res = await call(db, token, { EXTRACTION_MODE: mode, AI_PROVIDER: 'mock' })
      assert.strictEqual(res.spies.extractionRuns, 0)
    }
    assert.strictEqual(JSON.stringify(db.papers[0]), before)
  })

  // --- duplicates ------------------------------------------------------------------
  await check('two simultaneous requests start exactly one extraction', async () => {
    const { token, row } = paperRow()
    const db = makeDb({ papers: [row] })
    db.files[row.file_path] = Buffer.from('%PDF-synthetic')
    const s = spies({
      getProvider: () => ({}),
      runExtraction: async () => {
        await new Promise((r) => setTimeout(r, 30))
        return extractionReturning('Once')
      },
    })
    const env = { EXTRACTION_MODE: 'automatic' }
    const results = await Promise.all([call(db, token, env, s), call(db, token, env, s), call(db, token, env, s)])
    assert.strictEqual(s.extractionRuns, 1)
    assert.strictEqual(results.filter((r) => r.body.alreadyHandled).length, 2)
    assert.strictEqual(db.papers[0].title, 'Once')
  })

  await check('an interrupted run (killed mid-extraction) is reclaimed once after the stale window, not before', async () => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    const { token, row } = paperRow({ extraction_status: 'processing', extraction_started_at: recent })
    const db = makeDb({ papers: [row] })
    db.files[row.file_path] = Buffer.from('%PDF-synthetic')
    const s = spies({ getProvider: () => ({}), runExtraction: async () => extractionReturning('Recovered') })
    const env = { EXTRACTION_MODE: 'automatic' }
    await call(db, token, env, s)
    assert.strictEqual(s.extractionRuns, 0, 'a live claim is left alone')
    db.papers[0].extraction_started_at = new Date(Date.now() - 7 * 60_000).toISOString()
    await Promise.all([call(db, token, env, s), call(db, token, env, s)])
    assert.strictEqual(s.extractionRuns, 1, 'reclaimed exactly once')
    assert.strictEqual(db.papers[0].title, 'Recovered')
  })

  // --- the researcher's own choice (POST /api/manual-entry) ------------------------
  await check('choice: recorded once, survives reopening, and every extraction entry point respects it', () =>
    withProcessEnv(GEMINI_ENV, async () => {
      resetNetwork()
      const old = new Date(Date.now() - 10 * 60_000).toISOString()
      for (const start of [
        { extraction_status: 'pending' },
        { extraction_status: 'failed', failure_code: 'timeout', extraction_started_at: old, last_applied_generation_id: 'gen-fail' },
        { extraction_status: 'processing', extraction_started_at: old },
      ]) {
        const { token, row } = paperRow(start)
        const db = makeDb({ papers: [row] })
        db.files[row.file_path] = Buffer.from('%PDF-synthetic')
        const first = await choose(db, token)
        assert.strictEqual(first.status, 200)
        assert.deepStrictEqual(first.body, { recorded: true, manualEntry: 'researcher' })
        const at = db.papers[0].manual_entry_at
        // Reopening the link or pressing the button again changes nothing.
        const again = await choose(db, token)
        assert.deepStrictEqual(again.body, { recorded: true, manualEntry: 'researcher' })
        assert.strictEqual(db.papers[0].manual_entry_at, at)
        // Direct call, retry and stale recovery, in automatic mode.
        const s = spies()
        for (let i = 0; i < 3; i++) await call(db, token, { ...GEMINI_ENV, EXTRACTION_MODE: 'automatic' }, s)
        assert.strictEqual(s.extractionRuns + s.providerRequested + network.calls.length + db.downloads.length, 0, start.extraction_status)
        // History is untouched: the attempt that happened is still recorded as it was.
        assert.strictEqual(db.papers[0].extraction_status, start.extraction_status)
        assert.strictEqual(db.papers[0].failure_code, start.failure_code ?? null)
        assert.strictEqual(db.papers[0].last_applied_generation_id, start.last_applied_generation_id ?? null)
      }
    })
  )

  await check('race: manual choice recorded while the provider is running - the late result is kept in history but not applied', async () => {
    const { token, row } = paperRow()
    const db = makeDb({ papers: [row] })
    db.files[row.file_path] = Buffer.from('%PDF-synthetic')
    let choice
    const s = spies({
      getProvider: () => ({}),
      runExtraction: async () => {
        choice = await choose(db, token)
        return extractionReturning('Title the model found')
      },
    })
    const res = await call(db, token, { EXTRACTION_MODE: 'automatic' }, s)
    assert.strictEqual(choice.body.recorded, true)
    assert.strictEqual(s.extractionRuns, 1, 'the request already sent finishes')
    assert.strictEqual(res.body.appliedToPapers, false)
    const p = db.papers[0]
    assert.strictEqual(p.title, null, 'the model title did not become the metadata')
    assert.strictEqual(p.last_applied_generation_id, null)
    assert.strictEqual(p.extraction_status, 'completed', 'the run is recorded honestly')
    assert.ok(db.ai_generations.length >= 1, 'and kept in the append-only history')
    assert.strictEqual(p.manual_entry_source, 'researcher')
  })

  await check('race: choice and claim arriving together never produce an applied result, whichever wins', async () => {
    for (const order of ['choice-first', 'claim-first']) {
      const { token, row } = paperRow()
      const db = makeDb({ papers: [row] })
      db.files[row.file_path] = Buffer.from('%PDF-synthetic')
      const s = spies({
        getProvider: () => ({}),
        runExtraction: async () => { await new Promise((r) => setTimeout(r, 20)); return extractionReturning('Model title') },
      })
      const env = { EXTRACTION_MODE: 'automatic' }
      const [a, b] = order === 'choice-first'
        ? [() => choose(db, token), () => call(db, token, env, s)]
        : [() => call(db, token, env, s), () => choose(db, token)]
      await Promise.all([a(), b()])
      assert.strictEqual(db.papers[0].manual_entry_source, 'researcher', order)
      assert.strictEqual(db.papers[0].title, null, order)
      assert.ok(s.extractionRuns <= 1, order)
      if (order === 'choice-first') assert.strictEqual(s.extractionRuns, 0, 'a recorded choice stops the claim')
    }
  })

  await check('choice: a confirmed record is left byte-identical; tokens are checked', async () => {
    const { token, row } = paperRow({ extraction_status: 'completed', metadata_confirmed_at: new Date().toISOString(), title: 'Mine', last_applied_generation_id: 'g1' })
    const db = makeDb({ papers: [row] })
    const before = JSON.stringify(db.papers[0])
    const res = await choose(db, token)
    assert.deepStrictEqual(res.body, { recorded: false, confirmed: true })
    assert.strictEqual(JSON.stringify(db.papers[0]), before)
    assert.strictEqual((await choose(db, 'wrong')).status, 404)
    assert.strictEqual((await choose(db, row.id)).status, 404, 'a bare paper id is not a credential')
    assert.strictEqual((await choose(db, undefined)).status, 400)
    const preview = await handleManualChoice({ token, getSupabaseAdmin: () => { throw new Error('no key') }, log: quietLog() })
    assert.strictEqual(preview.status, 503)
    assert.strictEqual(preview.body.recorded, false)
  })

  resetNetwork()
  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

main()
