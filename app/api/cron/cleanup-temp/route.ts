import { timingSafeEqual } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sweepStaleTemp } from '@/lib/temp-storage'

export const runtime = 'nodejs'
export const maxDuration = 60

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

// Called daily by Vercel Cron (see vercel.json). Vercel sends "Authorization: Bearer $CRON_SECRET".
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET
  if (!secret) return json({ error: 'Cleanup is not configured.' }, 503)
  const supplied = Buffer.from(request.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${secret}`)
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return json({ error: 'Unauthorized.' }, 401)
  const service = createServiceClient()
  if (!service) return json({ error: 'Server is not configured.' }, 503)
  try {
    return json({ ...(await sweepStaleTemp(service)) })
  } catch {
    console.error('[ward-cleanup] sweep failed')
    return json({ error: 'Cleanup failed.' }, 500)
  }
}
