// Server-only glue between the public pages and lib/public/server.js.
// React's cache() lets generateMetadata and the page share one read per
// request; nothing is cached across requests.

import { cache } from 'react'
import { cookies } from 'next/headers'
import { getSupabaseAdmin } from '../supabaseAdminClient'
import { adminOrNull } from '../submission/routeHelpers'
import { normalizeLocale, LOCALE_COOKIE } from '../i18n'
import { getRecord, getCatalogue } from './server'

export function publicClient() {
  return adminOrNull(getSupabaseAdmin)
}

// { data } | { data: null } | { error: true }
export const loadRecord = cache(async (publicId) => {
  const sb = publicClient()
  if (!sb) return { error: true }
  return getRecord(sb, publicId)
})

export async function loadCatalogue(filters) {
  const sb = publicClient()
  if (!sb) return { error: true }
  return getCatalogue(sb, filters)
}

export async function pageLocale() {
  return normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value)
}
