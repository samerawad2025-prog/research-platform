#!/usr/bin/env node
// Release preparation: prove an environment is ISOLATED from production
// before any hosted test writes anything. Prints project references, never
// a key. Exits non-zero on any doubt.
//
//   PRODUCTION_SUPABASE_REF=mzpkiuovjppmavqkppem \
//   NEXT_PUBLIC_SUPABASE_URL=... NEXT_PUBLIC_SUPABASE_ANON_KEY=... \
//   SUPABASE_SERVICE_ROLE_KEY=... AI_PROVIDER=... EXTRACTION_MODE=... \
//   node scripts/check-isolation.js
//
// (With the Vercel CLI: `vercel env pull .env.isolation --environment=preview
// --git-branch=<branch>` then `set -a; . ./.env.isolation; set +a` first.
// Delete that file afterwards; it holds secrets.)
//
// Checks:
//   1. the browser URL's project ref is not production;
//   2. the anon key and the service key name that same project (legacy JWT
//      keys carry a `ref` claim; new-style sb_ keys do not, and are then
//      checked by calling the project with them — see --live);
//   3. no real AI provider can be called: AI_PROVIDER is mock or unset,
//      GEMINI_API_KEY is absent, EXTRACTION_MODE is manual or unset;
//   4. with --live (required whenever a key is not a JWT): each key is used
//      against the test project and against production. The anon key must be
//      accepted by the test project's API and refused by its admin API; the
//      service key must be accepted by both; production must refuse both.
//
// Fails closed: a missing variable, an undecodable key, a network error or an
// unexpected answer is a failure, never a pass.

const PROD = String(process.env.PRODUCTION_SUPABASE_REF || '').trim()
const problems = []
const facts = []

function refFromUrl(u) {
  try {
    const h = new URL(u).hostname
    const m = /^([a-z0-9]{20})\.supabase\.co$/.exec(h)
    return m ? m[1] : null
  } catch { return null }
}
function jwtClaims(k) {
  const parts = String(k || '').split('.')
  if (parts.length !== 3) return null
  try { return JSON.parse(Buffer.from(parts[1], 'base64url').toString()) } catch { return null }
}

if (!/^[a-z0-9]{20}$/.test(PROD)) problems.push('PRODUCTION_SUPABASE_REF must be set to the production project ref')
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const urlRef = refFromUrl(url)
if (!urlRef) problems.push('NEXT_PUBLIC_SUPABASE_URL is not a https://<ref>.supabase.co address')
else facts.push(`browser URL project: ${urlRef}`)
if (urlRef && urlRef === PROD) problems.push('NEXT_PUBLIC_SUPABASE_URL points at PRODUCTION')

for (const [name, want] of [['NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon'], ['SUPABASE_SERVICE_ROLE_KEY', 'service_role']]) {
  const v = process.env[name]
  if (!v) { problems.push(`${name} is not set`); continue }
  const c = jwtClaims(v)
  if (c) {
    facts.push(`${name}: JWT for project ${c.ref || '(no ref)'} role ${c.role || '?'}`)
    if (c.ref && c.ref === PROD) problems.push(`${name} is a PRODUCTION key`)
    if (c.ref && urlRef && c.ref !== urlRef) problems.push(`${name} names project ${c.ref}, not the URL's ${urlRef}`)
    if (c.role !== want) problems.push(`${name} has role ${c.role}, expected ${want}`)
  } else {
    facts.push(`${name}: not a JWT (new-style key)`)
    if (!process.argv.includes('--live')) problems.push(`${name} is not a JWT; its project can only be proven with --live`)
  }
}

if (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY === process.env.SUPABASE_SERVICE_ROLE_KEY) problems.push('the anon key and the service key are the same value')

const provider = String(process.env.AI_PROVIDER || '').trim().toLowerCase()
if (provider && provider !== 'mock') problems.push(`AI_PROVIDER is "${provider}"; hosted tests must use mock`)
if (process.env.GEMINI_API_KEY) problems.push('GEMINI_API_KEY is present; remove it from the test environment')
const mode = String(process.env.EXTRACTION_MODE || '').trim().toLowerCase()
if (mode && mode !== 'manual') problems.push(`EXTRACTION_MODE is "${mode}"; hosted tests must run manual`)
facts.push(`AI_PROVIDER=${provider || '(unset)'} EXTRACTION_MODE=${mode || '(unset → manual)'} GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'SET' : 'absent'}`)

async function status(base, path, key) {
  const r = await fetch(`${base}${path}`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  return r.status
}

async function live() {
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!urlRef || !anon || !service || !PROD) { problems.push('--live needs the URL, both keys and PRODUCTION_SUPABASE_REF'); return }
  const test = `https://${urlRef}.supabase.co`
  const prod = `https://${PROD}.supabase.co`
  // Browser credential: usable against the test project, not an admin key.
  const a1 = await status(test, '/auth/v1/settings', anon)
  if (a1 !== 200) problems.push(`the anon key is not accepted by ${urlRef} (HTTP ${a1})`); else facts.push(`anon key accepted by ${urlRef}`)
  const a2 = await status(test, '/auth/v1/admin/users?per_page=1', anon)
  if (a2 === 200) problems.push('the anon key has admin access: it is a service key'); else facts.push(`anon key refused by the admin API (HTTP ${a2})`)
  // Server credential: admin on the test project.
  const s1 = await status(test, '/auth/v1/admin/users?per_page=1', service)
  if (s1 !== 200) problems.push(`the service key is not an admin key for ${urlRef} (HTTP ${s1})`); else facts.push(`service key is admin on ${urlRef}`)
  const s2 = await status(test, '/storage/v1/bucket', service)
  if (s2 !== 200) problems.push(`the service key cannot read ${urlRef} Storage (HTTP ${s2})`); else facts.push(`service key reads ${urlRef} Storage`)
  // Production must refuse both.
  for (const [name, key] of [['anon key', anon], ['service key', service]]) {
    const p = await status(prod, '/auth/v1/settings', key)
    if (p === 200) problems.push(`the ${name} is ACCEPTED BY PRODUCTION`); else facts.push(`production refuses the ${name} (HTTP ${p})`)
  }
}

;(async () => {
  if (process.argv.includes('--live')) await live().catch((e) => problems.push(`live check failed: ${e.message}`))
  for (const f of facts) console.log(`  ${f}`)
  if (problems.length) {
    console.error('\nNOT ISOLATED — do not run hosted tests:')
    for (const p of problems) console.error(`  - ${p}`)
    process.exit(1)
  }
  console.log('\nIsolated: a single non-production project, no real AI provider.')
})()
