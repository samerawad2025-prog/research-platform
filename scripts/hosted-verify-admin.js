#!/usr/bin/env node
// Release verification, hosted (H1): Auth sign-in, staff authorization and
// the staff-exclusion cookie, against an ISOLATED preview + test project.
// Synthetic accounts only (created in the test project's auth.users).
// Needs HV_DEPLOYMENT, HV_BYPASS_FILE, HV_SUPABASE_URL, HV_ANON_KEY,
// HV_PASSWORD_FILE, HV_ADMIN_EMAIL, HV_OTHER_EMAIL, HV_STATE.
// Prints statuses and booleans only.

const assert = require('node:assert')
const fs = require('node:fs')
const D = process.env.HV_DEPLOYMENT
const BYPASS = fs.readFileSync(process.env.HV_BYPASS_FILE, 'utf8').trim()
const SB = process.env.HV_SUPABASE_URL
const ANON = process.env.HV_ANON_KEY
const PW = fs.readFileSync(process.env.HV_PASSWORD_FILE, 'utf8').trim()
if (!SB || SB.includes('mzpkiuovjppmavqkppem')) throw new Error('test project only')
const scrub = (m) => String(m).split(BYPASS).join('<bypass>')
let failed = 0
async function check(name, fn) {
  try { const n = await fn(); console.log(`PASS  ${name}${n ? ` — ${n}` : ''}`) } catch (e) { failed++; console.log(`FAIL  ${name} — ${scrub(e.message)}`) }
}
async function signIn(email, password = PW) {
  const r = await fetch(`${SB}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
  const j = await r.json().catch(() => ({}))
  return { status: r.status, token: j.access_token }
}
const admin = (path, token, init = {}) => fetch(`${D}/api/admin/${path}`, { ...init, headers: { 'x-vercel-protection-bypass': BYPASS, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers || {}) } })

async function main() {
  const state = JSON.parse(fs.readFileSync(process.env.HV_STATE, 'utf8'))
  let A, O
  await check('H1 Auth sign-in with the right password; wrong password refused', async () => {
    const a = await signIn(process.env.HV_ADMIN_EMAIL); const o = await signIn(process.env.HV_OTHER_EMAIL)
    const bad = await signIn(process.env.HV_ADMIN_EMAIL, `${PW}x`)
    assert.strictEqual(a.status, 200); assert.strictEqual(o.status, 200); assert.ok(a.token && o.token)
    assert.strictEqual(bad.status, 400, `wrong password ${bad.status}`)
    A = a.token; O = o.token
    return 'both 200; wrong password 400'
  })
  await check('H1 staff authorization: admin allowed; signed-in non-staff, anonymous and forged tokens refused', async () => {
    const me = await admin('me', A); const meBody = await me.json()
    assert.strictEqual(me.status, 200); assert.strictEqual(meBody.role, 'administrator', JSON.stringify(meBody))
    const other = await admin('me', O); assert.strictEqual(other.status, 403, `non-staff ${other.status}`)
    const none = await admin('me'); assert.strictEqual(none.status, 401, `anonymous ${none.status}`)
    const parts = A.split('.'); const forged = `${parts[0]}.${parts[1]}.${'A'.repeat(parts[2].length)}`
    const f = await admin('me', forged); assert.strictEqual(f.status, 401, `forged ${f.status}`)
    const q = await admin('queue', O); assert.strictEqual(q.status, 403, `non-staff queue ${q.status}`)
    return `admin 200 (${meBody.role}); non-staff 403; anonymous 401; forged signature 401; non-staff queue 403`
  })
  await check('H1 admin responses are private and not indexed', async () => {
    const r = await admin('me', A)
    const cc = r.headers.get('cache-control') || ''; const xr = r.headers.get('x-robots-tag') || ''
    assert.ok(/no-store/.test(cc), `cache-control: ${cc}`); assert.ok(/noindex/.test(xr), `x-robots-tag: ${xr}`)
    return `cache-control "${cc}"; x-robots-tag "${xr}"`
  })
  await check('H1 staff-exclusion cookie is Secure, HttpOnly, SameSite=Lax, identity-free; anonymous refused', async () => {
    const r = await admin('metrics-exclusion', A, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.strictEqual(r.status, 200, `status ${r.status}`)
    const sc = r.headers.get('set-cookie') || ''
    assert.ok(/;\s*Secure/i.test(sc), 'no Secure'); assert.ok(/;\s*HttpOnly/i.test(sc), 'no HttpOnly'); assert.ok(/SameSite=Lax/i.test(sc), 'no SameSite=Lax')
    const value = sc.split(';')[0].split('=').slice(1).join('=')
    assert.ok(/^v1\.\d+\.[A-Za-z0-9_-]+$/.test(value), 'unexpected marker shape')
    const payload = JSON.stringify(JSON.parse(Buffer.from(A.split('.')[1], 'base64url').toString()))
    assert.ok(!value.includes(JSON.parse(payload).sub), 'marker contains the user id')
    fs.writeFileSync(process.env.HV_STATE, JSON.stringify({ ...state, staffCookie: sc.split(';')[0] }), { mode: 0o600 })
    const anon = await admin('metrics-exclusion', null, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    assert.strictEqual(anon.status, 401, `anonymous ${anon.status}`)
    const cookieOnly = await fetch(`${D}/api/admin/me`, { headers: { 'x-vercel-protection-bypass': BYPASS, Cookie: sc.split(';')[0] } })
    assert.strictEqual(cookieOnly.status, 401, `cookie granted access ${cookieOnly.status}`)
    return 'Secure; HttpOnly; SameSite=Lax; value v1.<exp>.<sig> without the user id; anonymous 401; the cookie alone grants no admin access (401)'
  })
  fs.writeFileSync(`${process.env.HV_STATE}.admin`, A, { mode: 0o600 })
  console.log(`\n${failed ? `${failed} failed` : 'all passed'}; deployment ${D}`)
  process.exit(failed ? 1 : 0)
}
main().catch((e) => { console.error('ERROR', scrub(e.message)); process.exit(2) })
