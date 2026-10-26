import { NextResponse } from 'next/server'

const sampleWards = ['7', '12']

export async function GET() {
  const sampleMode = process.env.WARD_FINDER_SAMPLE_MODE === 'true' || process.env.NODE_ENV !== 'production'

  if (sampleMode || process.env.WARD_FINDER_REAL_SEARCH_ENABLED !== 'true') {
    return NextResponse.json({ wards: sampleWards }, { headers: { 'Cache-Control': 'no-store' } })
  }

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return NextResponse.json({ wards: sampleWards }, { headers: { 'Cache-Control': 'no-store' } })
  }

  try {
    const wardsUrl = new URL(`${url.replace(/\/$/, '')}/rest/v1/ward_search`)
    wardsUrl.searchParams.set('select', 'ward_number')

    const response = await fetch(wardsUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })

    if (!response.ok) {
      return NextResponse.json({ wards: sampleWards }, { headers: { 'Cache-Control': 'no-store' } })
    }

    const rows = (await response.json()) as Array<{ ward_number: string }>
    const distinctWards = Array.from(new Set(rows.map((r) => r.ward_number)))
      .filter((w) => /^[1-9][0-9]{0,2}$/.test(w))
      .sort((a, b) => Number(a) - Number(b))

    return NextResponse.json({ wards: distinctWards.length ? distinctWards : sampleWards }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ wards: sampleWards }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
