// Public records only (public_sitemap() re-applies the publication rule),
// and only once a permanent site origin is configured. Otherwise empty.
import { getSupabaseAdmin } from '../lib/supabaseAdminClient'
import { adminOrNull } from '../lib/submission/routeHelpers'
import { isPublicEnabled, siteOrigin, getSitemap } from '../lib/public/server'

export const dynamic = 'force-dynamic'

export default async function sitemap() {
  const origin = siteOrigin()
  if (!isPublicEnabled() || !origin) return []
  const sb = adminOrNull(getSupabaseAdmin)
  const r = sb ? await getSitemap(sb) : { error: true }
  if (r.error || !Array.isArray(r.data)) return []
  return [
    { url: `${origin}/research` },
    ...r.data.map((e) => ({ url: `${origin}/research/${e.public_id}`, ...(e.lastmod ? { lastModified: new Date(e.lastmod) } : {}) })),
  ]
}
