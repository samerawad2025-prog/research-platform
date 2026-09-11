import ConfirmationScreen from '../../../components/ConfirmationScreen'

export const dynamic = 'force-dynamic'

export default async function ConfirmPage({ params }) {
  const { token } = await params
  return <ConfirmationScreen token={token} />
}
