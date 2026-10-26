import { NextResponse } from 'next/server'
import { getSearchVariants } from '@/lib/transliteration'
import { WARD_RE } from '@/lib/ward-import-core'

type SampleRecord = {
  id: string
  name: string
  relativeName: string | null
  wardNumber: string
  serialNumber: number | null
}

const sampleRecords: SampleRecord[] = [
  { id: 'sample-1', name: 'Aarav Mehta', relativeName: 'Kiran Mehta', wardNumber: '12', serialNumber: 88 },
  { id: 'sample-2', name: 'आरव मेहता', relativeName: 'किरण मेहता', wardNumber: '12', serialNumber: 89 },
  { id: 'sample-3', name: 'Nisha Sharma', relativeName: 'Rakesh Sharma', wardNumber: '7', serialNumber: 100 },
  { id: 'sample-4', name: 'सोनू मेचावाल', relativeName: 'अनिल मेचावाल', wardNumber: '7', serialNumber: 101 },
  { id: 'sample-5', name: 'मुकेश कुमार', relativeName: 'सुरेश कुमार', wardNumber: '12', serialNumber: 102 },
]

function normalizeSearchField(value: string) {
  return value.normalize('NFKC').toLowerCase().replace(/[़॒॑]/g, '').replace(/\s+/g, ' ').trim()
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const wardParam = url.searchParams.get('ward')?.trim() ?? ''

  if (!query || query.length > 100) return NextResponse.json({ results: [] })

  const targetWard = wardParam && wardParam !== 'all' && WARD_RE.test(wardParam) ? wardParam : null

  const searchVariants = getSearchVariants(query)
  if (!searchVariants.length) {
    searchVariants.push(query)
  }

  const sampleMode = process.env.WARD_FINDER_SAMPLE_MODE === 'true' || process.env.NODE_ENV !== 'production'

  if (sampleMode) {
    const normalizedVariants = searchVariants.map(normalizeSearchField)

    const results = sampleRecords
      .filter((record) => {
        if (targetWard && record.wardNumber !== targetWard) return false
        const fields = [record.name, record.relativeName]
          .filter((f): f is string => Boolean(f))
          .map(normalizeSearchField)
        return fields.some((field) =>
          normalizedVariants.some((variant) => field.includes(variant) || variant.includes(field))
        )
      })
      .slice(0, 20)

    return NextResponse.json(
      { results, sample: true, notice: 'Fictional sample records only.' },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (process.env.WARD_FINDER_REAL_SEARCH_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Search is not available yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  const dbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!dbUrl || !key) return NextResponse.json({ error: 'Search is not configured.' }, { status: 503 })

  const orConditions: string[] = []
  for (const variant of searchVariants) {
    const escaped = variant.replace(/[\\%_*(),]/g, (character) => `\\${character}`)
    orConditions.push(`name.ilike.*${escaped}*`)
    orConditions.push(`relative_name.ilike.*${escaped}*`)
  }

  const searchUrl = new URL(`${dbUrl.replace(/\/$/, '')}/rest/v1/ward_search`)
  searchUrl.searchParams.set('select', 'id,name,relative_name,ward_number,serial_number')
  searchUrl.searchParams.set('or', `(${orConditions.join(',')})`)
  if (targetWard) {
    searchUrl.searchParams.set('ward_number', `eq.${targetWard}`)
  }
  searchUrl.searchParams.set('limit', '20')

  try {
    const response = await fetch(searchUrl, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: 'no-store',
    })
    if (!response.ok) return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })

    const rows = (await response.json()) as Array<{
      id: string
      name: string
      relative_name: string | null
      ward_number: string
      serial_number: number | null
    }>

    const results = rows.map((row) => ({
      id: row.id,
      name: row.name,
      relativeName: row.relative_name,
      wardNumber: row.ward_number,
      serialNumber: typeof row.serial_number === 'number' && Number.isInteger(row.serial_number) ? row.serial_number : null,
    }))
    return NextResponse.json({ results }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })
  }
}
