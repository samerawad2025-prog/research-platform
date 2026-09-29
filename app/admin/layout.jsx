import { notFound } from 'next/navigation'
import AdminProvider from '../../components/admin/AdminProvider'

export const metadata = {
  title: 'Review',
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
}
export const dynamic = 'force-dynamic'

export default function AdminLayout({ children }) {
  if (String(process.env.ADMIN_REVIEW || '').trim().toLowerCase() !== 'enabled') notFound()
  return <AdminProvider>{children}</AdminProvider>
}
