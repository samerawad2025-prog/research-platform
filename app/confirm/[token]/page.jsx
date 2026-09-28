import ConfirmationScreen from '../../../components/ConfirmationScreen'
import { resolveExtractionMode } from '../../../lib/env'

export const dynamic = 'force-dynamic'

// A private editing link, never a public research page: kept out of
// search indexes, and the token in the address is not sent onward as a
// referrer to any other site.
export const metadata = {
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}

export default async function ConfirmPage({ params }) {
  const { token } = await params
  // Only the boolean crosses to the browser, never the setting itself.
  // The route enforces the mode; this just picks the screen.
  return <ConfirmationScreen token={token} manualMode={resolveExtractionMode().mode === 'manual'} />
}
