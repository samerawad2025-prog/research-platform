import { notFound } from 'next/navigation'
import Catalogue from '../../../../components/research/Catalogue'
import SubmissionPreview from '../../../../components/SubmissionPreview'
import { loadCatalogue } from '../../../../lib/public/pageData'
import { isPublicEnabled } from '../../../../lib/public/server'
export const dynamic = 'force-dynamic'
export const metadata = { robots: { index: false, follow: false, nocache: true }, referrer: 'no-referrer' }
export default async function Page({ params }) {
  const { token } = await params
  if (!/^[0-9a-f]{64}$/.test(token) || !isPublicEnabled()) notFound()
  const r = await loadCatalogue({})
  return <Catalogue data={r.error ? null : r.data} filters={{}} error={!!r.error}>
    <SubmissionPreview token={token} />
  </Catalogue>
}
