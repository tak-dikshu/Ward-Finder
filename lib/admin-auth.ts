import 'server-only'
import { createAuthClient } from '@/lib/supabase/server'

export type AdminState =
  | { status: 'anonymous' }
  | { status: 'forbidden'; email: string }
  | { status: 'admin'; id: string; email: string }

/** Identifies the signed-in user and checks them against WARD_FINDER_ADMIN_EMAILS. */
export async function getAdminState(): Promise<AdminState> {
  const supabase = await createAuthClient()
  if (!supabase) return { status: 'anonymous' }
  const { data, error } = await supabase.auth.getUser()
  const user = data?.user
  if (error || !user?.email) return { status: 'anonymous' }
  const allowed = (process.env.WARD_FINDER_ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  const email = user.email.toLowerCase()
  if (!user.email_confirmed_at || !allowed.includes(email)) return { status: 'forbidden', email }
  return { status: 'admin', id: user.id, email }
}
