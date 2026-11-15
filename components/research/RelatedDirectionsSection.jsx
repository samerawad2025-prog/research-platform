import RelatedDirections from './RelatedDirections'
import definitions from '../../content/research-directions.json'
import { loadRelatedDirections } from '../../lib/public/directions'
import { publicClient } from '../../lib/public/pageData'

// Stream optional source checks separately so they do not hold up the paper.
export default async function RelatedDirectionsSection({ publicId }) {
  let cards
  try {
    const sb = publicClient()
    if (!sb) return null
    cards = await loadRelatedDirections(sb, publicId, definitions)
  } catch {
    return null
  }
  return <RelatedDirections cards={cards} />
}
