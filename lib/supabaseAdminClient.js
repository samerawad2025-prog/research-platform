// lib/supabaseAdminClient.js
//
// SERVER-SIDE ONLY. This client uses the Supabase service role key,
// which bypasses Row Level Security entirely. It must only ever be
// imported from API routes (app/api/**/route.js), never from a
// component that runs in the browser. The key itself lives in
// SUPABASE_SERVICE_ROLE_KEY, deliberately not prefixed with
// NEXT_PUBLIC_, so Next.js will not bundle it into client code.

import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

export function getSupabaseAdmin() {
  if (!serviceRoleKey) {
    throw new Error('SUPABASE_SERVICE_ROLE_KEY is not set. This must be configured server-side only, never exposed with a NEXT_PUBLIC_ prefix.')
  }
  return createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
