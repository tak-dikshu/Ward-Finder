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
  const pageParam = parseInt(url.searchParams.get('page') || '1', 10)
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSize = 25
  const offset = (page - 1) * pageSize

  if (!query || query.length > 100) return NextResponse.json({ results: [], total: 0, page: 1, hasMore: false })

  // Validate ward filter if provided
  const targetWard = wardParam && wardParam !== 'all' && WARD_RE.test(wardParam) ? wardParam : null

  // Generate transliteration variants for bilingual search
  const searchVariants = getSearchVariants(query)
  if (!searchVariants.length) {
    searchVariants.push(query)
  }

  const sampleMode = process.env.WARD_FINDER_SAMPLE_MODE === 'true' || process.env.NODE_ENV !== 'production'

  if (sampleMode) {
    // Check against every variant in both Hindi and English
    const normalizedVariants = searchVariants.map(normalizeSearchField)

    const filtered = sampleRecords.filter((record) => {
      if (targetWard && record.wardNumber !== targetWard) return false

      const fields = [record.name, record.relativeName]
        .filter((f): f is string => Boolean(f))
        .map(normalizeSearchField)

      // Match if any field contains any search variant or vice versa
      return fields.some((field) =>
        normalizedVariants.some((variant) => field.includes(variant) || variant.includes(field))
      )
    })

    const total = filtered.length
    const results = filtered.slice(offset, offset + pageSize)
    const hasMore = offset + results.length < total

    return NextResponse.json(
      { results, total, page, pageSize, hasMore, sample: true, notice: 'Fictional sample records only.' },
      { headers: { 'Cache-Control': 'no-store' } }
    )
  }

  if (process.env.WARD_FINDER_REAL_SEARCH_ENABLED !== 'true') {
    return NextResponse.json({ error: 'Search is not available yet.' }, { status: 503, headers: { 'Cache-Control': 'no-store' } })
  }

  const dbUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!dbUrl || !key) return NextResponse.json({ error: 'Search is not configured.' }, { status: 503 })

  // Construct PostgREST ILIKE filters for each variant across name and relative_name
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
  searchUrl.searchParams.set('order', 'ward_number.asc,serial_number.asc.nullslast')
  searchUrl.searchParams.set('limit', String(pageSize))
  searchUrl.searchParams.set('offset', String(offset))

  try {
    const response = await fetch(searchUrl, {
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact',
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    })
    if (!response.ok) return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })

    // Extract total count from PostgREST Content-Range header (e.g. "0-24/53")
    const contentRange = response.headers.get('content-range')
    let totalCount: number | null = null
    if (contentRange) {
      const parts = contentRange.split('/')
      if (parts.length === 2 && parts[1] !== '*') {
        const parsed = parseInt(parts[1], 10)
        if (!Number.isNaN(parsed)) totalCount = parsed
      }
    }

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

    const finalTotal = totalCount ?? (results.length < pageSize && page === 1 ? results.length : results.length)
    const hasMore = totalCount !== null ? offset + results.length < totalCount : results.length === pageSize

    return NextResponse.json({
      results,
      total: finalTotal,
      page,
      pageSize,
      hasMore,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })
  }
}
