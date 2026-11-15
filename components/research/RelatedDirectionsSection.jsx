import RelatedDirections from './RelatedDirections'
import definitions from '../../content/research-directions.json'
import { loadRelatedDirections } from '../../lib/public/directions'
import { publicClient } from '../../lib/public/pageData'

// Stream optional source checks separately so they do not hold up the paper.
export default async function RelatedDirectionsSection({ publicId }) {
  try {
    const sb = publicClient()
    if (!sb) return null
    const cards = await loadRelatedDirections(sb, publicId, definitions)
    return <RelatedDirections cards={cards} />
  } catch {
    return null
  }
}
