import { redirect } from 'next/navigation'
import { AdminLogin } from '@/components/admin-login'
import { getAdminState } from '@/lib/admin-auth'

export const metadata = { title: 'Administrator sign-in | Ward Finder', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

export default async function AdminLoginPage() {
  const state = await getAdminState()
  if (state.status === 'admin') redirect('/admin/import')
  return <AdminLogin notice={state.status === 'forbidden' ? 'This account is not authorized for the administrator area.' : undefined} />
}
