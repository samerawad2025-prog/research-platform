import AdminReview from '../../../../components/admin/AdminReview'
export default async function Page({ params }) {
  const { id } = await params
  return <AdminReview paperId={id} />
}
