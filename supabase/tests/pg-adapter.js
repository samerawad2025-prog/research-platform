// supabase/tests/pg-adapter.js
//
// Test harness only. Runs the supabase-js calls the application makes
// (query builder + rpc) as SQL against a DISPOSABLE local Postgres through
// psql, so route logic can be tested against a real database. It is not a
// PostgREST implementation; PostgREST itself is not exercised.
//
// Also a storage substitute that models the behaviour the M2A flow relies
// on from Supabase Storage (see docs/submission-flow.md, "Assumptions"):
// a signed upload authorization is bound to one path, and with
// upsert:false an existing object cannot be replaced through it.

const { execFileSync } = require('node:child_process')
const crypto = require('node:crypto')

function makePsql(db) {
  function psql(sql) {
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
  function sqlOk(sql) {
    const r = psql(sql)
    if (r.error) throw new Error(`${r.error.code} ${r.error.message}\n${sql}`)
    return r.out
  }
  return { psql, sqlOk, json: (sql) => JSON.parse(sqlOk(sql) || 'null') }
}

function lit(v) {
  if (v === null || v === undefined) return 'null'
  if (typeof v === 'number') return String(v)
  if (typeof v === 'boolean') return v ? 'true' : 'false'
  if (typeof v === 'object') return `${lit(JSON.stringify(v))}::jsonb`
  return `'${String(v).replace(/'/g, "''")}'`
}

const VOID_FUNCTIONS = ['mark_submission_object_removed', 'record_upload_authorization', 'record_declared_authors']

function pgClient({ psql }, { storage = null } = {}) {
  function builder(table) {
    const q = { op: 'select', cols: '*', filters: [], patch: null, rows: null, returning: null, single: null }
    const where = () =>
      q.filters.length
        ? 'where ' + q.filters.map(([k, c, v]) => (k === 'eq' ? `${c} = ${lit(v)}` : k === 'lt' ? `${c} < ${lit(v)}` : v === null ? `${c} is null` : `${c} is ${lit(v)}`)).join(' and ')
        : ''
    function run() {
      let sql
      if (q.op === 'select') sql = `select coalesce(json_agg(t), '[]') from (select ${q.cols} from ${table} ${where()}) t`
      else if (q.op === 'update') {
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
      if (q.single) return { data: rows[0] ?? null, error: null }
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
  async function rpc(name, args = {}) {
    const argList = Object.entries(args).map(([k, v]) => `${k} => ${lit(v)}`).join(', ')
    const sql = VOID_FUNCTIONS.includes(name) ? `select ${name}(${argList}); select 'null'` : `select coalesce(to_jsonb(${name}(${argList})), 'null'::jsonb)`
    const r = psql(sql)
    if (r.error) return { data: null, error: r.error }
    const lines = r.out.split('\n')
    return { data: JSON.parse(lines[lines.length - 1]), error: null }
  }
  return { from: builder, rpc, storage: { from: () => storage } }
}

// A private bucket: nothing is readable without the server's own client.
function fakeStorage() {
  const objects = new Map()
  const grants = new Map() // token -> { path, upsert }
  const s = {
    objects,
    // Like Supabase: a JWT-shaped token whose exp is two hours out, and
    // which intent expiry does NOT revoke.
    async createSignedUploadUrl(path, { upsert = false } = {}) {
      const exp = Math.floor(Date.now() / 1000) + 2 * 3600
      const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
      const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ url: `papers/${path}`, upsert, exp })}.${crypto.randomBytes(16).toString('base64url')}`
      grants.set(token, { path, upsert, exp })
      return { data: { path, token, signedUrl: `https://storage.invalid/object/upload/sign/papers/${path}?token=${token}` }, error: null }
    },
    // Test control: make an authorization's own expiry pass.
    expireGrant(token) {
      const g = grants.get(token)
      if (g) g.exp = Math.floor(Date.now() / 1000) - 1
    },
    // What the browser does with the authorization.
    uploadWithToken(path, token, bytes) {
      const g = grants.get(token)
      if (!g || g.path !== path) return { error: { message: 'invalid signature' } }
      if (g.exp <= Math.floor(Date.now() / 1000)) return { error: { message: 'jwt expired' } }
      if (objects.has(path) && !g.upsert) return { error: { message: 'The resource already exists' } }
      objects.set(path, Buffer.from(bytes))
      return { error: null }
    },
    async download(path) {
      if (!objects.has(path)) return { data: null, error: { message: 'Object not found' } }
      return { data: new Blob([objects.get(path)]), error: null }
    },
    async remove(paths) {
      for (const p of paths) objects.delete(p)
      return { data: paths.map((name) => ({ name })), error: null }
    },
  }
  return s
}

module.exports = { makePsql, lit, pgClient, fakeStorage }
