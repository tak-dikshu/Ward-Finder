import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { getSupabaseAnonKey, getSupabaseUrl } from './config'

/** Cookie-based auth client (anon key). Used only to identify the signed-in user. */
export async function createAuthClient() {
  const url = getSupabaseUrl()
  const key = getSupabaseAnonKey()
  if (!url || !key) return null
  const store = await cookies()
  return createServerClient(url, key, {
    cookies: {
      getAll: () => store.getAll(),
      setAll: (items) => {
        try { items.forEach(({ name, value, options }) => store.set(name, value, options)) } catch { /* called from a Server Component; proxy.ts refreshes the session */ }
      },
    },
  })
}
