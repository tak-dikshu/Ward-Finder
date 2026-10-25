import { NextResponse } from 'next/server'

const sampleRecords = [
  { id: 'sample-1', name: 'Aarav Mehta', relativeName: 'Kiran Mehta', wardNumber: '12' },
  { id: 'sample-2', name: 'आरव मेहता', relativeName: 'किरण मेहता', wardNumber: '12' },
  { id: 'sample-3', name: 'Nisha Sharma', relativeName: 'Rakesh Sharma', wardNumber: '7' },
]

function normalize(value: string) {
  return value.normalize('NFKC').toLocaleLowerCase('hi-IN').replace(/[़॒॑]/g, '').replace(/\s+/g, ' ').trim()
}

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get('q')?.trim() ?? ''
  if (!query || query.length > 100) return NextResponse.json({ results: [] })

  const normalizedQuery = normalize(query)
  const sampleMode = process.env.WARD_FINDER_SAMPLE_MODE === 'true' || process.env.NODE_ENV !== 'production'

  if (sampleMode) {
    const results = sampleRecords.filter((record) => [record.name, record.relativeName].some((field) => field && normalize(field).includes(normalizedQuery))).slice(0, 20)
    return NextResponse.json({ results, sample: true, notice: 'Fictional sample records only.' }, { headers: { 'Cache-Control': 'no-store' } })
  }

  // Real-record search stays OFF until WARD_FINDER_REAL_SEARCH_ENABLED=true is set deliberately,
  // after the security and accuracy checks in the README have passed.
  if (process.env.WARD_FINDER_REAL_SEARCH_ENABLED !== 'true') return NextResponse.json({ error: 'Search is not available yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return NextResponse.json({ error: 'Search is not configured.' }, { status: 503 })

  const escapedQuery = normalizedQuery.replace(/[\\%_*(),]/g, (character) => `\\${character}`)
  const pattern = `*${escapedQuery}*`
  const searchUrl = new URL(`${url.replace(/\/$/, '')}/rest/v1/ward_search`)
  searchUrl.searchParams.set('select', 'id,name,relative_name,ward_number')
  searchUrl.searchParams.set('or', `(name.ilike.${pattern},relative_name.ilike.${pattern})`)
  searchUrl.searchParams.set('limit', '20')

  try {
    const response = await fetch(searchUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!response.ok) return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })

    const rows = await response.json() as Array<{ id: string; name: string; relative_name: string | null; ward_number: string }>
    const results = rows.map((row) => ({
      id: row.id,
      name: row.name,
      relativeName: row.relative_name,
      wardNumber: row.ward_number,
    }))
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })
  }
}
