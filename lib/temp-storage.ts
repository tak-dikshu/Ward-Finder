import 'server-only'
import type { createServiceClient } from '@/lib/supabase/admin'

export const TEMP_BUCKET = 'ward-import-temp'
export const TEMP_MAX_AGE_MS = 2 * 60 * 60 * 1000

type Service = NonNullable<ReturnType<typeof createServiceClient>>

/**
 * Deletes temporary uploads older than TEMP_MAX_AGE_MS. With userId it sweeps only that
 * admin's folder (cheap, run on every upload); without it, it sweeps the whole bucket (cron).
 */
export async function sweepStaleTemp(service: Service, userId?: string): Promise<{ checked: number; removed: number }> {
  const bucket = service.storage.from(TEMP_BUCKET)
  const folders: string[] = []
  const stale: string[] = []
  let checked = 0
  const isStale = (createdAt?: string | null) => Boolean(createdAt) && Date.now() - new Date(createdAt as string).getTime() > TEMP_MAX_AGE_MS

  if (userId) folders.push(userId)
  else {
    const { data } = await bucket.list('', { limit: 1000 })
    for (const entry of data ?? []) {
      if (entry.id === null) folders.push(entry.name)
      else { checked++; if (isStale(entry.created_at)) stale.push(entry.name) }
    }
  }
  for (const folder of folders) {
    const { data } = await bucket.list(folder, { limit: 1000 })
    for (const file of data ?? []) { checked++; if (isStale(file.created_at)) stale.push(`${folder}/${file.name}`) }
  }
  if (stale.length) await bucket.remove(stale)
  return { checked, removed: stale.length }
}
