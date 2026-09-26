import ConfirmationScreen from '../../../components/ConfirmationScreen'
import { resolveExtractionMode } from '../../../lib/env'

export const dynamic = 'force-dynamic'

export default async function ConfirmPage({ params }) {
  const { token } = await params
  // Only the boolean crosses to the browser, never the setting itself.
  // The route enforces the mode; this just picks the screen.
  return <ConfirmationScreen token={token} manualMode={resolveExtractionMode().mode === 'manual'} />
}
