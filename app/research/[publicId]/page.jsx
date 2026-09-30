import { notFound } from 'next/navigation'
import RecordView from '../../../components/research/RecordView'
import { isPublicEnabled, siteOrigin, recordUrl } from '../../../lib/public/server'
import { citationText } from '../../../lib/public/citation'
import { getActivity } from '../../../lib/public/activity'
import { publicClient } from '../../../lib/public/pageData'
import { loadRecord, pageLocale } from '../../../lib/public/pageData'
import { messagesFor } from '../../../lib/i18n'

export const dynamic = 'force-dynamic'

// Anything not public right now (unknown, private, pending, withdrawn,
// suspended, embargoed, changed since approval, ineligible institution) is
// the same neutral not-found, with no reason given.
export async function generateMetadata({ params }) {
  if (!isPublicEnabled()) return {}
  const { publicId } = await params
  const r = await loadRecord(publicId)
  const t = messagesFor(await pageLocale())
  if (r.error || !r.data) return { title: t.research.record.unavailableTitle, robots: { index: false, follow: false } }
  const rec = r.data
  const ar = (await pageLocale()) === 'ar'
  const title = (ar ? rec.title_ar || rec.title : rec.title || rec.title_ar) || t.research.record.unavailableTitle
  const abs = (ar ? rec.abstract_ar || rec.abstract : rec.abstract || rec.abstract_ar) || ''
  const description = abs.length > 200 ? `${abs.slice(0, 197).trimEnd()}…` : abs
  const origin = siteOrigin()
  const url = origin ? `${origin}/research/${rec.public_id}` : undefined
  return {
    title,
    description,
    robots: origin ? { index: true, follow: true } : { index: false, follow: false },
    ...(url ? { alternates: { canonical: url } } : {}),
    openGraph: { type: 'article', title, description, ...(url ? { url } : {}), siteName: t.shell?.wordmark },
    twitter: { card: 'summary', title, description },
  }
}

export default async function Page({ params }) {
  if (!isPublicEnabled()) notFound()
  const { publicId } = await params
  const r = await loadRecord(publicId)
  if (r.error) throw new Error('public record unavailable')
  if (!r.data) notFound()
  const url = recordUrl(r.data.public_id)
  // Counts are read, never written, while rendering. If they cannot be read
  // the page still renders, saying so.
  const sb = publicClient()
  const act = sb ? await getActivity(sb, r.data.public_id) : { error: true }
  return <RecordView record={r.data} citation={citationText(r.data, url)} hasUrl={!!url} activity={act.error ? null : act.data} activityError={!!act.error} />
}
