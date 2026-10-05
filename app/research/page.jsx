import { notFound } from 'next/navigation'
import Catalogue from '../../components/research/Catalogue'
import { isPublicEnabled, siteOrigin, parseFilters } from '../../lib/public/server'
import { loadCatalogue, pageLocale } from '../../lib/public/pageData'
import { messagesFor } from '../../lib/i18n'

// Rendered per request from the database: a withdrawn record disappears
// from the next page load, with no page cache in between.
export const dynamic = 'force-dynamic'

export async function generateMetadata({ searchParams }) {
  if (!isPublicEnabled()) return {}
  const t = messagesFor(await pageLocale()).research.catalogue
  const origin = siteOrigin()
  const filtered = Object.keys(parseFilters(await searchParams)).length > 0
  return {
    title: t.title,
    description: t.intro,
    // Indexed only once a permanent origin is configured, and only the
    // unfiltered catalogue (search result pages are not indexed).
    robots: origin && !filtered ? { index: true, follow: true } : { index: false, follow: !!origin },
    ...(origin ? { alternates: { canonical: `${origin}/research` } } : {}),
  }
}

export default async function Page({ searchParams }) {
  if (!isPublicEnabled()) notFound()
  const filters = parseFilters(await searchParams)
  const r = await loadCatalogue(filters)
  return <Catalogue data={r.error ? null : r.data} filters={filters} error={!!r.error} />
}
