'use client'

// Browser side of the review area. Its OWN Supabase client (separate
// storage key) so a staff session never mixes with anything else. The
// session only proves who someone is; what they may do is decided by the
// server and database on every request (docs/admin-review.md).

import { createClient } from '@supabase/supabase-js'

let client = null

export function authClient() {
  if (client) return client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return null
  client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'sarp-admin-auth' },
  })
  return client
}

async function token() {
  const c = authClient()
  if (!c) return null
  const { data } = await c.auth.getSession()
  return data?.session?.access_token || null
}

// -> { ok, status, data } ; never throws. data.reason carries the code.
export async function api(method, path, body) {
  const t = await token()
  if (!t) return { ok: false, status: 401, data: { reason: 'unauthenticated' } }
  try {
    const res = await fetch(`/api/admin/${path}`, {
      method,
      headers: { Authorization: `Bearer ${t}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    })
    let data = null
    try { data = await res.json() } catch { data = {} }
    return { ok: res.ok, status: res.status, data: data || {} }
  } catch {
    return { ok: false, status: 0, data: { reason: 'network' } }
  }
}
