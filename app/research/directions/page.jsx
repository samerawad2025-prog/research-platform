import { notFound } from 'next/navigation'
import Directions from '../../../components/research/Directions'
import definitions from '../../../content/research-directions.json'
import { loadDirections } from '../../../lib/public/directions'
import { publicClient, pageLocale } from '../../../lib/public/pageData'
import { isPublicEnabled } from '../../../lib/public/server'
import { DIRECTIONS_MESSAGES } from '../../../lib/i18nDirections'
export const dynamic = 'force-dynamic'
export async function generateMetadata() {
  const t = DIRECTIONS_MESSAGES[await pageLocale()]
  return { title:t.title, description:t.intro, robots:{index:false,follow:true} }
}
export default async function Page() {
  if (!isPublicEnabled()) notFound()
  const sb=publicClient()
  const result=sb?await loadDirections(sb,definitions):{cards:[],unavailable:true}
  return <Directions {...result} />
}
