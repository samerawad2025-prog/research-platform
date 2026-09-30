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
//   4. with --live: the service key is accepted by THIS project (a harmless
//      read), and the production ref is not reachable with these keys.

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
    facts.push(`${name}: not a JWT (new-style key); project checked only with --live`)
  }
}

const provider = String(process.env.AI_PROVIDER || '').trim().toLowerCase()
if (provider && provider !== 'mock') problems.push(`AI_PROVIDER is "${provider}"; hosted tests must use mock`)
if (process.env.GEMINI_API_KEY) problems.push('GEMINI_API_KEY is present; remove it from the test environment')
const mode = String(process.env.EXTRACTION_MODE || '').trim().toLowerCase()
if (mode && mode !== 'manual') problems.push(`EXTRACTION_MODE is "${mode}"; hosted tests must run manual`)
facts.push(`AI_PROVIDER=${provider || '(unset)'} EXTRACTION_MODE=${mode || '(unset → manual)'} GEMINI_API_KEY=${process.env.GEMINI_API_KEY ? 'SET' : 'absent'}`)

async function live() {
  if (!url || !process.env.SUPABASE_SERVICE_ROLE_KEY) return
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  // A harmless read with the service key against the URL's project.
  const r = await fetch(`${url.replace(/\/$/, '')}/storage/v1/bucket`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
  if (r.status !== 200) problems.push(`the service key is not accepted by ${urlRef} (HTTP ${r.status})`)
  else facts.push(`service key accepted by ${urlRef}`)
  if (PROD) {
    const p = await fetch(`https://${PROD}.supabase.co/storage/v1/bucket`, { headers: { apikey: key, Authorization: `Bearer ${key}` } })
    if (p.status === 200) problems.push('the service key is ACCEPTED BY PRODUCTION')
    else facts.push(`production refuses this service key (HTTP ${p.status})`)
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
