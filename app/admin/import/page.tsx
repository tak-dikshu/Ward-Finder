import { redirect } from 'next/navigation'
import { AdminPdfImport } from '@/components/admin-pdf-import'
import { getAdminState } from '@/lib/admin-auth'

export const metadata = { title: 'Private PDF import | Ward Finder', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function AdminImportPage() {
  const state = await getAdminState()
  if (state.status !== 'admin') redirect('/admin/login')
  return <AdminPdfImport adminEmail={state.email} />
}
