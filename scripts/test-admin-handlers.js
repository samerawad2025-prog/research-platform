#!/usr/bin/env node
//
// Phase 3 M4 checks that need no database or network (CI): the admin
// API's authentication, validation, error mapping, file handling and logs,
// and static guards on migration 0015. The database rules themselves
// (roles, assignment, approval, revisions, audit) are tested against a real
// Postgres in supabase/tests/admin-postgres.test.js (run-0012.sh), and the
// API against real Supabase Auth in supabase/tests/admin-local.test.js.
//
// Run: node scripts/test-admin-handlers.js

const assert = require('node:assert')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')

const { handleAdmin, ROUTES } = require('../lib/admin/handlers')
const { VERSIONS, loadConfidentiality } = require('../lib/admin/confidentiality')

const ROOT = path.join(__dirname, '..')
const migration = fs.readFileSync(path.join(ROOT, 'supabase/migrations/0015_admin_review.sql'), 'utf8')
const code = migration.replace(/--[^\n]*/g, '')

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

const USER = '11111111-1111-4111-8111-111111111111'
const PAPER = '22222222-2222-4222-8222-222222222222'
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(60) + '.' + 'b'.repeat(30)
const ENV = { ADMIN_REVIEW: 'enabled' }

// A recording stand-in for the service-role client and private storage.
function harness({ rpc = () => ({ data: { ok: true } }), user = USER, getUserError = false } = {}) {
  const calls = { rpc: [], getUser: [], storage: [], listUsers: [] }
  const lines = []
  const supabase = {
    rpc: async (name, args) => { calls.rpc.push([name, args]); const r = rpc(name, args); return r.error ? { data: null, error: r.error } : { data: r.data, error: null } },
    auth: {
      getUser: async (t) => { calls.getUser.push(t); return getUserError ? { data: null, error: { message: 'invalid JWT' } } : { data: { user: user ? { id: user } : null }, error: null } },
      admin: { listUsers: async () => { calls.listUsers.push(1); return { data: { users: [{ id: USER, email: 'v@example.invalid' }] }, error: null } } },
    },
  }
  const storage = {
    createSignedUrl: async (p, s) => { calls.storage.push(['createSignedUrl', p, s]); return { data: { signedUrl: `https://storage.invalid/sign/${p}?token=SECRET` }, error: null } },
    download: async (p) => { calls.storage.push(['download', p]); return { data: new Blob([Buffer.from('%PDF-1.4 x')]), error: null } },
    upload: async (p) => { calls.storage.push(['upload', p]); return { data: {}, error: null } },
    remove: async (p) => { calls.storage.push(['remove', p]); return { data: [], error: null } },
    createSignedUploadUrl: async (p) => { calls.storage.push(['createSignedUploadUrl', p]); return { data: { token: 'UPLOADSECRET', signedUrl: `https://storage.invalid/up/${p}` }, error: null } },
  }
  const log = { log: (...a) => lines.push(a.join(' ')), warn: (...a) => lines.push(a.join(' ')), error: (...a) => lines.push(a.join(' ')) }
  const call = (method, segments, over = {}) => handleAdmin({ method, segments, supabase, storage, env: ENV, token: TOKEN, log, root: ROOT, ...over })
  return { call, calls, lines }
}

async function main() {
  await check('off unless ADMIN_REVIEW=enabled: every route answers 404 and touches nothing', async () => {
    for (const env of [{}, { ADMIN_REVIEW: 'yes' }, { ADMIN_REVIEW: 'disabled' }]) {
      const h = harness()
      for (const [m, pattern] of ROUTES) {
        const r = await h.call(m, pattern.map((s) => (s.startsWith(':') ? PAPER : s)), { env })
        assert.strictEqual(r.status, 404, pattern.join('/'))
      }
      assert.deepStrictEqual([h.calls.getUser.length, h.calls.rpc.length], [0, 0])
    }
  })

  await check('authentication: no token, a malformed token, a token Supabase Auth rejects, or an unusable answer is 401 on every route, with no database call', async () => {
    const cases = [
      { token: undefined }, { token: '' }, { token: 'short' }, { token: 'x'.repeat(5000) },
      { token: TOKEN, getUserError: true }, { token: TOKEN, user: null }, { token: TOKEN, user: 'not-a-uuid' },
    ]
    for (const c of cases) {
      const h = harness({ getUserError: c.getUserError, user: c.user === undefined ? USER : c.user })
      for (const [m, pattern] of ROUTES) {
        const r = await h.call(m, pattern.map((s) => (s.startsWith(':') ? PAPER : s)), { token: c.token, body: {} })
        assert.strictEqual(r.status, 401, `${m} ${pattern.join('/')} ${JSON.stringify(c).slice(0, 40)}`)
        assert.strictEqual(r.body.reason, 'unauthenticated')
      }
      assert.strictEqual(h.calls.rpc.length, 0, 'no database call for an unauthenticated request')
    }
    // An unknown route is also 401 when anonymous: its existence is not revealed.
    const h = harness({ getUserError: true })
    assert.strictEqual((await h.call('GET', ['nothing', 'here'])).status, 401)
    // A throwing Auth client is 401, not a 500.
    const t = harness()
    assert.strictEqual((await t.call('GET', ['me'], { getUser: async () => { throw new Error('network') } })).status, 401)
  })

  await check('claims in the token confer nothing: only the id Supabase Auth returns is used, and the database decides the rest', async () => {
    const forged = Buffer.from(JSON.stringify({ sub: USER, role: 'service_role', user_metadata: { role: 'administrator' }, app_metadata: { role: 'administrator' } })).toString('base64url')
    const token = `eyJhbGciOiJIUzI1NiJ9.${forged}.${'c'.repeat(30)}`
    const h = harness({ rpc: () => ({ error: { message: 'ERROR: admin:forbidden' } }), user: '33333333-3333-4333-8333-333333333333' })
    const r = await h.call('GET', ['queue'], { token })
    assert.strictEqual(r.status, 403)
    assert.strictEqual(h.calls.rpc[0][1].p_actor, '33333333-3333-4333-8333-333333333333', 'the verified id, not the token\'s sub')
    assert.deepStrictEqual(h.calls.getUser, [token], 'Supabase Auth verified it')
    assert.ok(!JSON.stringify(h.calls.rpc).includes('administrator'), 'no claim is passed on')
  })

  await check('authorization is the database\'s: a denied call is a 403 or 404, is mapped without leaking, and has no side effect', async () => {
    const codes = { forbidden: 403, confidentiality_required: 403, not_found: 404, invalid_input: 400, last_administrator: 409, user_unconfirmed: 422, original_not_registered: 409 }
    for (const [code, status] of Object.entries(codes)) {
      const h = harness({ rpc: () => ({ error: { message: `ERROR:  P0001: admin:${code}\nCONTEXT: secret internals` } }) })
      const r = await h.call('POST', ['reviews', PAPER, 'notes'], { body: { body: 'x' } })
      assert.strictEqual(r.status, status, code)
      assert.strictEqual(r.body.reason, code)
      assert.ok(!JSON.stringify(r.body).includes('internals'))
    }
    // A file request the database refuses never reaches storage.
    const h = harness({ rpc: () => ({ error: { message: 'admin:forbidden' } }) })
    assert.strictEqual((await h.call('POST', ['reviews', PAPER, 'files', 'access'], { body: {} })).status, 403)
    assert.deepStrictEqual(h.calls.storage, [], 'no signed URL was created')
    // An unknown database failure is a 503 with no detail.
    const u = harness({ rpc: () => ({ error: { message: 'relation "x" does not exist', code: '42P01' } }) })
    const r = await u.call('GET', ['queue'])
    assert.strictEqual(r.status, 503); assert.strictEqual(r.body.reason, 'database_not_ready'); assert.ok(!JSON.stringify(r.body).includes('relation'))
  })

  await check('business answers map to clear statuses with their details', async () => {
    const answers = [
      [{ ok: false, error: 'stale_revision', revision: 'abc' }, 409], [{ ok: false, error: 'preconditions_failed', failures: [{ code: 'institution_unresolved' }] }, 422],
      [{ ok: false, error: 'reason_required' }, 400], [{ ok: false, error: 'hash_mismatch' }, 422], [{ ok: false, error: 'already_pending' }, 409],
    ]
    for (const [data, status] of answers) {
      const h = harness({ rpc: () => ({ data }) })
      const r = await h.call('POST', ['reviews', PAPER, 'decision'], { body: { decision: 'approved', reason: 'ok', expectedRevision: 'r' } })
      assert.strictEqual(r.status, status, data.error)
      assert.strictEqual(r.body.reason, data.error)
      if (data.failures) assert.deepStrictEqual(r.body.failures, data.failures)
      if (data.revision) assert.strictEqual(r.body.revision, 'abc')
    }
  })

  await check('validation: bad ids, unknown fields, wrong types, invalid JSON and oversize text are 400 before any database call', async () => {
    const bad = [
      ['GET', ['reviews', 'not-a-uuid'], {}], ['POST', ['reviews', PAPER, 'decision'], { decision: 'publish' }],
      ['POST', ['reviews', PAPER, 'decision'], { decision: 'approved', extra: 1 }], ['POST', ['reviews', PAPER, 'decision'], { decision: 'approved', disseminationVersionId: 'x' }],
      ['POST', ['reviews', PAPER, 'decision'], { decision: 'declined', reason: 'x'.repeat(2001) }], ['POST', ['reviews', PAPER, 'notes'], { body: '' }],
      ['POST', ['reviews', PAPER, 'notes'], { body: 'x'.repeat(5001) }], ['POST', ['reviews', PAPER, 'notes'], { body: 42 }],
      ['POST', ['reviews', PAPER, 'recommendation'], { recommendation: 'publish', reason: 'x' }], ['POST', ['reviews', PAPER, 'issues'], { kind: 'other', description: 'x', blocking: 'yes' }],
      ['POST', ['reviews', PAPER, 'assignments'], { volunteerId: 'x' }], ['POST', ['reviews', PAPER, 'assignments', 'nope', 'end'], {}],
      ['POST', ['reviews', PAPER, 'embargo'], { until: '01/01/2030' }], ['POST', ['reviews', PAPER, 'legacy-setting'], { setting: 'everything', note: 'x' }],
      ['POST', ['reviews', PAPER, 'legacy-setting'], { setting: 'hold' }], ['POST', ['reviews', PAPER, 'authority'], { verified: 'true' }],
      ['POST', ['reviews', PAPER, 'documents'], { origin: 'redacted_copy', file: { name: 'a.exe', size: 1, type: 'application/pdf' } }],
      ['POST', ['reviews', PAPER, 'documents'], { origin: 'redacted_copy', file: { name: 'a.pdf', size: 20 * 1024 * 1024 + 1, type: 'application/pdf' } }],
      ['POST', ['reviews', PAPER, 'documents'], { origin: 'redacted_copy', file: { name: 'a.pdf', size: 5, type: 'application/pdf', path: '/etc' } }],
      ['POST', ['reviews', PAPER, 'documents', 'zzz', 'finalize'], {}], ['POST', ['reviews', PAPER, 'files', 'access'], { path: 'intents/other.pdf' }],
      ['POST', ['reviews', PAPER, 'files', 'access'], { versionId: 'x' }], ['POST', ['staff'], { userId: USER, role: 'owner' }], ['POST', ['institutions'], { slug: 'X', nameEn: 'X' }],
      ['POST', ['units', PAPER, 'verify'], { sourceUrl: 'https://x.invalid', retrievedOn: '' }], ['POST', ['confidentiality', 'acknowledge'], { versionId: 'v', language: 'fr' }],
      ['GET', ['queue'], null, { limit: '1.5' }],
    ]
    for (const [m, seg, body, query] of bad) {
      const h = harness()
      const r = await h.call(m, seg, { body, query: query || {} })
      assert.strictEqual(r.status, 400, `${m} ${seg.join('/')} ${JSON.stringify(body)}`)
      assert.strictEqual(h.calls.rpc.length, 0, `${seg.join('/')} reached the database`)
    }
    const h = harness()
    assert.strictEqual((await h.call('POST', ['reviews', PAPER, 'notes'], { bodyError: true })).status, 400, 'invalid JSON')
    assert.strictEqual(h.calls.rpc.length, 0)
    assert.strictEqual((await h.call('DELETE', ['reviews', PAPER])).status, 404)
  })

  await check('staff: nobody but an active administrator reaches the account directory, and every refusal is the same', async () => {
    const bodies = [{ email: 'exists@example.invalid', role: 'administrator' }, { email: 'absent@example.invalid', role: 'volunteer' },
      { userId: USER, role: 'administrator' }, { userId: USER, email: 'a@b.c', role: 'volunteer' }, { role: 'administrator' }]
    const callers = {
      'ordinary user': () => ({ error: { message: 'admin:forbidden' } }),
      'inactive administrator': () => ({ error: { message: 'admin:forbidden' } }),
      volunteer: (n) => (n === 'admin_context' ? { data: { role: 'volunteer' } } : { data: { ok: true } }),
    }
    for (const [who, rpc] of Object.entries(callers)) {
      const seen = new Set()
      for (const body of bodies) {
        const h = harness({ rpc })
        const r = await h.call('POST', ['staff'], { body })
        seen.add(JSON.stringify([r.status, r.body]))
        assert.strictEqual(h.calls.listUsers.length, 0, `${who}: the directory was searched`)
        assert.ok(!h.calls.rpc.some(([n]) => n === 'admin_set_staff'), `${who}: reached the mutation`)
      }
      assert.deepStrictEqual([...seen], [JSON.stringify([403, { error: 'The request was refused.', reason: 'forbidden' }])], who)
    }
    const admin = (n) => (n === 'admin_context' ? { data: { role: 'administrator' } } : { data: { ok: true } })
    let h = harness({ rpc: admin })
    let r = await h.call('POST', ['staff'], { body: { email: 'V@example.invalid', role: 'volunteer' } })
    assert.strictEqual(r.status, 200)
    assert.strictEqual(h.calls.listUsers.length, 1)
    assert.deepStrictEqual(h.calls.rpc.map(([n]) => n), ['admin_context', 'admin_set_staff'], 'the mutation is still authorized by the database')
    assert.strictEqual(h.calls.rpc[1][1].p_user, USER)
    h = harness({ rpc: admin })
    r = await h.call('POST', ['staff'], { body: { email: 'nobody@example.invalid', role: 'volunteer' } })
    assert.deepStrictEqual([r.status, r.body.reason], [404, 'user_not_found'], 'only an administrator can learn an account is absent')
    h = harness({ rpc: admin })
    assert.strictEqual((await h.call('POST', ['staff'], { body: { userId: USER, email: 'a@b.c', role: 'volunteer' } })).status, 400)
    assert.strictEqual(h.calls.listUsers.length, 0)
  })

  await check('the queue passes only known filters, with types fixed, and the actor is always the verified user', async () => {
    const h = harness({ rpc: () => ({ data: { items: [] } }) })
    await h.call('GET', ['queue'], { query: { status: 'approved', institution: 'unresolved', mine: 'true', limit: '10', offset: '5', q: 'x', evil: "1' or 1=1", p_actor: 'someone-else' } })
    assert.deepStrictEqual(h.calls.rpc[0], ['admin_queue', { p_actor: USER, p_filters: { status: 'approved', institution: 'unresolved', mine: true, limit: 10, offset: 5, q: 'x' } }])
    for (const [, args] of (await (async () => { const g = harness(); for (const [m, pattern, spec] of ROUTES) await g.call(m, pattern.map((s) => (s.startsWith(':') ? PAPER : s)), { body: spec ? {} : undefined }); return g.calls.rpc })())) {
      if ('p_actor' in args) assert.strictEqual(args.p_actor, USER)
    }
  })

  await check('the confidentiality text: served only when its hash matches, acknowledged with the hash of what the SERVER served, never one the browser names', async () => {
    for (const ver of VERSIONS) {
      const loaded = loadConfidentiality(ver.id, ROOT)
      assert.ok(loaded, ver.id)
      for (const lang of ['en', 'ar']) {
        assert.strictEqual(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, ver.files[lang]))).digest('hex'), ver.sha256[lang], lang)
        assert.ok(migration.includes(ver.sha256[lang]), `migration 0015 seeds the ${lang} hash`)
      }
      assert.ok(migration.includes(`'${ver.id}'`))
    }
    assert.strictEqual(loadConfidentiality('unknown', ROOT), null)
    assert.strictEqual(loadConfidentiality(VERSIONS[0].id, path.join(ROOT, 'docs')), null, 'missing file: not served')
    const versionId = VERSIONS[0].id
    const h = harness({ rpc: (name) => (name === 'admin_context' ? { data: { confidentiality_version_id: versionId, confidentiality_required: true, acknowledged: false } } : { data: { ok: true } }) })
    const got = await h.call('GET', ['confidentiality'])
    assert.strictEqual(got.status, 200); assert.strictEqual(got.body.version.texts.en.sha256, VERSIONS[0].sha256.en)
    assert.ok(got.body.version.texts.ar.text.includes('التزام'))
    const ack = await h.call('POST', ['confidentiality', 'acknowledge'], { body: { versionId, language: 'ar' } })
    assert.strictEqual(ack.status, 200)
    const call = h.calls.rpc.find(([n]) => n === 'admin_acknowledge_confidentiality')
    assert.strictEqual(call[1].p_sha256, VERSIONS[0].sha256.ar)
    const stale = await h.call('POST', ['confidentiality', 'acknowledge'], { body: { versionId: 'older-version', language: 'en' } })
    assert.strictEqual(stale.status, 409); assert.strictEqual(stale.body.reason, 'version_changed')
    const rejected = await h.call('POST', ['confidentiality', 'acknowledge'], { body: { versionId, language: 'en', sha256: 'a'.repeat(64) } })
    assert.strictEqual(rejected.status, 400, 'a hash from the browser is not accepted')
  })

  await check('file access: the link comes only after the database allows it, lasts 60 seconds, and no separate storage path field is returned', async () => {
    const h = harness({ rpc: (name) => (name === 'admin_document_access' ? { data: { ok: true, storage_path: 'intents/abc/secret-path.pdf' } } : { data: { ok: true } }) })
    const r = await h.call('POST', ['reviews', PAPER, 'files', 'access'], { body: { versionId: null } })
    assert.strictEqual(r.status, 200)
    assert.deepStrictEqual(Object.keys(r.body).sort(), ['expiresIn', 'url'])
    assert.strictEqual(r.body.expiresIn, 60)
    assert.deepStrictEqual(h.calls.storage, [['createSignedUrl', 'intents/abc/secret-path.pdf', 60]])
    assert.ok(!JSON.stringify(h.calls.rpc).includes('createSignedUrl'))
    // The path the browser might name is never used.
    const evil = harness({ rpc: () => ({ data: { ok: true, storage_path: 'intents/abc/ok.pdf' } }) })
    await evil.call('POST', ['reviews', PAPER, 'files', 'access'], { body: { versionId: '44444444-4444-4444-8444-444444444444' } })
    assert.deepStrictEqual(evil.calls.storage.map((c) => c[1]), ['intents/abc/ok.pdf'])
  })

  await check('nothing secret is logged: no token, note, reason, signed URL or upload credential', async () => {
    const secretNote = 'PRIVATE-NOTE-TEXT-123'
    const h = harness({ rpc: (name) => (name === 'admin_document_access' ? { data: { ok: true, storage_path: 'p/x.pdf' } } : { error: { message: 'boom', code: 'XX000' } }) })
    await h.call('POST', ['reviews', PAPER, 'notes'], { body: { body: secretNote } })
    await h.call('POST', ['reviews', PAPER, 'decision'], { body: { decision: 'declined', reason: secretNote } })
    await h.call('POST', ['reviews', PAPER, 'files', 'access'], { body: {} })
    await h.call('POST', ['reviews', PAPER, 'documents'], { body: { origin: 'redacted_copy', redactionNote: secretNote, file: { name: 'a.pdf', size: 10, type: 'application/pdf' } } })
    const text = h.lines.join('\n')
    for (const s of [TOKEN, secretNote, 'SECRET', 'UPLOADSECRET', USER]) assert.ok(!text.includes(s), `logged: ${s.slice(0, 12)}`)
    const boom = await h.call('GET', ['queue'], { getUser: async () => ({ data: { user: { id: USER } }, error: null }) })
    assert.strictEqual(boom.status, 503)
  })

  await check('migration 0015: every API function starts by authorizing the actor, is granted to service_role only, and pins search_path', async () => {
    const grants = /v_api text\[\] := array\[([^\]]*)\]/.exec(code)[1].match(/'([a-z_]+)'/g).map((x) => x.replace(/'/g, ''))
    assert.ok(grants.length >= 30)
    const bodies = Object.fromEntries(migration.split(/create or replace function /).slice(1).map((b) => [/^([a-z_]+)\(/.exec(b)[1], b]))
    for (const fn of grants) {
      const b = bodies[fn]
      assert.ok(b, `${fn} is defined`)
      assert.ok(/security definer\s+set search_path = /.test(b), `${fn} pins search_path`)
      if (fn === 'publication_eligibility') continue // read-only rule for server-side public routes; no actor
      assert.ok(/admin_require_role\(|admin_require_access\(|admin_actor_role\(|admin_original_info|admin_document_upload_info/.test(b.split(/\n\$fn\$;/)[0]), `${fn} authorizes the actor`)
      // ...and before it writes anything.
      const first = b.search(/admin_require_role\(|admin_require_access\(|admin_actor_role\(/)
      const write = b.search(/\b(insert into|update [a-z_]+ set|delete from)\b/i)
      assert.ok(first !== -1 && (write === -1 || first < write), `${fn}: authorization precedes any write`)
    }
    assert.ok(!/grant\s+[^;]*\bto\s+[^;]*\b(anon|authenticated|public)\b/i.test(code.replace(/revoke[^;]*;/gi, '')), 'nothing is granted to a browser role')
    assert.ok(/revoke all on function %s from public, anon, authenticated, service_role/.test(code))
    assert.ok(!grants.includes('bootstrap_first_administrator') && !grants.includes('admin_log'), 'bootstrap and the audit writer are not API functions')
    // Every table has row level security and no browser grants.
    const tables = [...code.matchAll(/create table if not exists (\w+)/g)].map((m) => m[1])
    assert.ok(tables.length >= 15)
    for (const t of tables) {
      assert.ok(new RegExp(`alter table ${t} enable row level security`).test(code), `${t} has RLS`)
      assert.ok(new RegExp(`revoke all on table ${t} from anon, authenticated`).test(code), `${t} has no browser access`)
    }
    // Append-only tables refuse change.
    for (const t of ['admin_audit_events', 'review_notes', 'review_approvals', 'confidentiality_acknowledgements']) {
      assert.ok(new RegExp(`create trigger \\w+\\s+before update or delete on ${t}`).test(code), t)
    }
    assert.ok(/before truncate on admin_audit_events/.test(code))
    // No public-facing object is created, and nothing is seeded active or eligible beyond the founder's decision.
    assert.ok(!/create (or replace )?view|create policy|storage\./i.test(code), 'no view, policy or storage change')
    assert.ok(/'volunteer-confidentiality-2026-09-29',[^)]*false\)/.test(code.replace(/\s+/g, ' ')), 'confidentiality seeded inactive')
    // The UofK unit seed: the 21 units of the official directory as recorded
    // in the founder's review (2026-09-30), English only, repeatable.
    const seed = /insert into academic_units \(institution_id, kind, name_en,[\s\S]*?\) as u\(kind, name_en\)[\s\S]*?;/.exec(code)
    assert.ok(seed, 'the unit seed exists')
    const units = [...seed[0].matchAll(/\('(faculty|school)',\s*'([^']+)'\)/g)].map((m) => [m[1], m[2]])
    assert.strictEqual(units.length, 21)
    assert.strictEqual(new Set(units.map((u) => u[1])).size, 21, 'no duplicate unit')
    assert.deepStrictEqual(units.filter((u) => u[0] === 'school').map((u) => u[1]), ['School of Management Studies'])
    assert.ok(units.every(([k, n]) => n.startsWith(k === 'school' ? 'School of ' : 'Faculty of ')))
    assert.ok(/https:\/\/uofk\.edu\/index\.php\/faculties/.test(seed[0]) && /date '2026-09-30'/.test(seed[0]))
    assert.ok(/not exists \(select 1 from academic_units x\s+where x\.institution_id = i\.id and normalize_name_text\(x\.name_en\) = normalize_name_text\(u\.name_en\)\)/.test(seed[0]), 'repeatable, never duplicates')
    assert.ok(!/name_ar/.test(seed[0]), 'no Arabic name is invented')
  })

  await check('every database function the API calls exists in the migration, and every API function is used or is the shared rule', async () => {
    const src = fs.readFileSync(path.join(ROOT, 'lib/admin/handlers.js'), 'utf8')
    const defined = new Set([...code.matchAll(/create or replace function (admin_[a-z_]+)\(/g)].map((m) => m[1]))
    const used = new Set([...src.matchAll(/'((?:admin_[a-z_]+))'/g)].map((m) => m[1]).filter((n) => defined.has(n)))
    const grants = new Set(/v_api text\[\] := array\[([^\]]*)\]/.exec(code)[1].match(/'([a-z_]+)'/g).map((x) => x.replace(/'/g, '')))
    for (const fn of used) assert.ok(grants.has(fn), `${fn} is called but not granted`)
    for (const fn of grants) if (fn !== 'publication_eligibility') assert.ok(used.has(fn), `${fn} is granted but never used`)
  })

  await check('the route and the flag: /api/admin is a single, uncached, noindex entry point that reads the bearer token only', () => {
    const route = fs.readFileSync(path.join(ROOT, 'app/api/admin/[...path]/route.js'), 'utf8')
    assert.ok(/Cache-Control': 'no-store'/.test(route) && /noindex/.test(route))
    assert.ok(/authorization/.test(route) && !/cookie/i.test(route), 'no cookie authority')
    assert.ok(/ADMIN_REVIEW/.test(fs.readFileSync(path.join(ROOT, 'lib/admin/handlers.js'), 'utf8')))
    assert.ok(/'\/api\/admin\/\[\.\.\.path\]'/.test(fs.readFileSync(path.join(ROOT, 'next.config.mjs'), 'utf8')), 'the legal texts are traced into the function')
  })

  if (failed) {
    console.error(`\n${failed} check(s) failed.`)
    process.exit(1)
  }
  console.log('\nAll checks passed.')
}

main()
