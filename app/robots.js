// Private areas are never to be crawled: confirmation links, the review
// area and the APIs. A sitemap is advertised only when the public research
// site is on and has a permanent origin.
import { isPublicEnabled, siteOrigin } from '../lib/public/server'

export const dynamic = 'force-dynamic'

export default function robots() {
  const origin = siteOrigin()
  return {
    rules: { userAgent: '*', allow: '/', disallow: ['/confirm/', '/admin', '/api/'] },
    ...(isPublicEnabled() && origin ? { sitemap: `${origin}/sitemap.xml` } : {}),
  }
}
