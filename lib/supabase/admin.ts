import 'server-only'
import { createClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from './config'

/**
 * Privileged client using the service-role key. SERVER ONLY: never import this
 * from a client component and never expose the key with a NEXT_PUBLIC_ prefix.
 */
export function createServiceClient() {
  const url = getSupabaseUrl()
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY
  if (!url || !key) return null
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
