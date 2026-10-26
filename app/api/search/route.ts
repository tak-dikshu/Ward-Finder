import { NextResponse } from 'next/server'
import { getSearchVariants } from '@/lib/transliteration'
import { WARD_RE } from '@/lib/ward-import-core'

type SearchRecord = {
  id: string
  name: string
  relativeName: string | null
  wardNumber: string
  serialNumber: number | null
}

const sampleRecords: SearchRecord[] = [
  { id: 'sample-1', name: 'Aarav Mehta', relativeName: 'Kiran Mehta', wardNumber: '12', serialNumber: 88 },
  { id: 'sample-2', name: 'आरव मेहता', relativeName: 'किरण मेहता', wardNumber: '12', serialNumber: 89 },
  { id: 'sample-3', name: 'Nisha Sharma', relativeName: 'Rakesh Sharma', wardNumber: '7', serialNumber: 100 },
  { id: 'sample-4', name: 'सोनू मेचावाल', relativeName: 'अनिल मेचावाल', wardNumber: '7', serialNumber: 101 },
  { id: 'sample-5', name: 'मुकेश कुमार', relativeName: 'सुरेश कुमार', wardNumber: '12', serialNumber: 102 },
  { id: 'sample-6', name: 'रमेश', relativeName: 'मोडू', wardNumber: '11', serialNumber: 260 },
  { id: 'sample-7', name: 'रमेश', relativeName: 'भवाना', wardNumber: '2', serialNumber: 46 },
  { id: 'sample-8', name: 'रमेश चंद', relativeName: 'प्रभू लाल', wardNumber: '11', serialNumber: 302 },
  { id: 'sample-9', name: 'रमेशचन्द', relativeName: 'देवीलाल', wardNumber: '11', serialNumber: 293 },
  { id: 'sample-10', name: 'रमेशचन्द्र', relativeName: 'बिज्ञालाल', wardNumber: '13', serialNumber: 68 },
  { id: 'sample-11', name: 'नरेन्द्र कुमार', relativeName: 'रमेश चन्द', wardNumber: '11', serialNumber: 134 },
  { id: 'sample-12', name: 'सुरेन्द्र कुमार', relativeName: 'रमेश चन्द', wardNumber: '11', serialNumber: 135 },
  { id: 'sample-13', name: 'बरजीबाई', relativeName: 'रमेश', wardNumber: '1', serialNumber: 6 },
  { id: 'sample-14', name: 'टिललू', relativeName: 'रमेश', wardNumber: '1', serialNumber: 12 },
  { id: 'sample-15', name: 'संजू', relativeName: 'रमेश चंद्र', wardNumber: '13', serialNumber: 51 },
  { id: 'sample-16', name: 'सम्पत्ति', relativeName: 'रमेश', wardNumber: '11', serialNumber: 261 },
]

function normalizeSearchField(value: string) {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u200b-\u200d\ufeff]/g, '')
    .replace(/[़॒॑]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Calculates a relevance score for a record based on search variants.
 * Guarantees that person name matches (scores 600-1000) ALWAYS rank ahead
 * of relative name matches (scores 200-400).
 */
function getRelevanceScore(record: { name: string; relativeName: string | null }, variants: string[]): number {
  const normName = normalizeSearchField(record.name)
  const normRel = record.relativeName ? normalizeSearchField(record.relativeName) : ''

  let highestScore = 0

  for (const v of variants) {
    const nv = normalizeSearchField(v)
    if (!nv) continue

    // 1. Exact match on person name (e.g. "रमेश" === "रमेश")
    if (normName === nv) {
      highestScore = Math.max(highestScore, 1000)
      continue
    }

    // 2. Person name starts with variant (e.g. "रमेश चंद" starts with "रमेश")
    if (normName.startsWith(nv + ' ') || normName.startsWith(nv)) {
      highestScore = Math.max(highestScore, 800)
      continue
    }

    // 3. Word in person name matches variant
    const nameWords = normName.split(' ')
    if (nameWords.includes(nv)) {
      highestScore = Math.max(highestScore, 700)
      continue
    }

    // 4. Substring inside person name (e.g. "रमेशचन्द्र")
    if (normName.includes(nv)) {
      highestScore = Math.max(highestScore, 600)
      continue
    }

    // 5. Exact match on relative name (e.g. relative is "रमेश")
    if (normRel === nv) {
      highestScore = Math.max(highestScore, 400)
      continue
    }

    // 6. Relative name starts with variant (e.g. relative is "रमेश चंद")
    if (normRel.startsWith(nv + ' ') || normRel.startsWith(nv)) {
      highestScore = Math.max(highestScore, 300)
      continue
    }

    // 7. Word in relative name matches variant
    const relWords = normRel.split(' ')
    if (relWords.includes(nv)) {
      highestScore = Math.max(highestScore, 250)
      continue
    }

    // 8. Substring inside relative name
    if (normRel.includes(nv)) {
      highestScore = Math.max(highestScore, 200)
      continue
    }
  }

  return highestScore
}

function parseWardNum(ward: string): number {
  const match = ward.match(/\d+/)
  return match ? parseInt(match[0], 10) : 999999
}

function parseSerialNum(serial: number | null): number {
  return typeof serial === 'number' && Number.isInteger(serial) ? serial : 99999999
}

function sortRankedRecords(records: SearchRecord[], variants: string[]): SearchRecord[] {
  return [...records].sort((a, b) => {
    const scoreA = getRelevanceScore(a, variants)
    const scoreB = getRelevanceScore(b, variants)
    if (scoreA !== scoreB) {
      return scoreB - scoreA // Higher score first: person name before relative name
    }

    // Secondary: Numeric ward order (Ward 1, Ward 2, Ward 11, Ward 13)
    const wardA = parseWardNum(a.wardNumber)
    const wardB = parseWardNum(b.wardNumber)
    if (wardA !== wardB) {
      return wardA - wardB
    }

    // Tertiary: Serial number ascending
    const serialA = parseSerialNum(a.serialNumber)
    const serialB = parseSerialNum(b.serialNumber)
    return serialA - serialB
  })
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const query = url.searchParams.get('q')?.trim() ?? ''
  const wardParam = url.searchParams.get('ward')?.trim() ?? ''
  const pageParam = parseInt(url.searchParams.get('page') || '1', 10)
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSizeParam = parseInt(url.searchParams.get('pageSize') || '100', 10)
  const pageSize = Number.isInteger(pageSizeParam) && pageSizeParam > 0 && pageSizeParam <= 200 ? pageSizeParam : 100
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
    const normalizedVariants = searchVariants.map(normalizeSearchField)

    const filtered = sampleRecords.filter((record) => {
      if (targetWard && record.wardNumber !== targetWard) return false

      const fields = [record.name, record.relativeName]
        .filter((f): f is string => Boolean(f))
        .map(normalizeSearchField)

      return fields.some((field) =>
        normalizedVariants.some((variant) => field.includes(variant) || variant.includes(field))
      )
    })

    const sorted = sortRankedRecords(filtered, searchVariants)
    const total = sorted.length
    const results = sorted.slice(offset, offset + pageSize)
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

  const baseUrl = `${dbUrl.replace(/\/$/, '')}/rest/v1/ward_search`

  // Construct filters for person name and relative name
  const nameConditions: string[] = []
  const relativeConditions: string[] = []
  for (const variant of searchVariants) {
    const escaped = variant.replace(/[\\%_*(),]/g, (character) => `\\${character}`)
    nameConditions.push(`name.ilike.*${escaped}*`)
    relativeConditions.push(`relative_name.ilike.*${escaped}*`)
  }

  // Fetch person matches and relative matches in parallel to ensure
  // person name matches are never crowded out by relative matches across wards
  const nameUrl = new URL(baseUrl)
  nameUrl.searchParams.set('select', 'id,name,relative_name,ward_number,serial_number')
  nameUrl.searchParams.set('or', `(${nameConditions.join(',')})`)
  if (targetWard) nameUrl.searchParams.set('ward_number', `eq.${targetWard}`)
  nameUrl.searchParams.set('limit', '150')

  const relativeUrl = new URL(baseUrl)
  relativeUrl.searchParams.set('select', 'id,name,relative_name,ward_number,serial_number')
  relativeUrl.searchParams.set('or', `(${relativeConditions.join(',')})`)
  if (targetWard) relativeUrl.searchParams.set('ward_number', `eq.${targetWard}`)
  relativeUrl.searchParams.set('limit', '150')

  try {
    const authHeaders = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Prefer: 'count=exact',
    }

    const [nameRes, relativeRes] = await Promise.all([
      fetch(nameUrl, { headers: authHeaders, cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => null),
      fetch(relativeUrl, { headers: authHeaders, cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => null),
    ])

    type Row = {
      id: string
      name: string
      relative_name: string | null
      ward_number: string
      serial_number: number | null
    }

    const recordsMap = new Map<string, SearchRecord>()

    if (nameRes && nameRes.ok) {
      const rows = (await nameRes.json()) as Row[]
      if (Array.isArray(rows)) {
        for (const row of rows) {
          recordsMap.set(row.id, {
            id: row.id,
            name: row.name,
            relativeName: row.relative_name,
            wardNumber: row.ward_number,
            serialNumber: typeof row.serial_number === 'number' && Number.isInteger(row.serial_number) ? row.serial_number : null,
          })
        }
      }
    }

    if (relativeRes && relativeRes.ok) {
      const rows = (await relativeRes.json()) as Row[]
      if (Array.isArray(rows)) {
        for (const row of rows) {
          if (!recordsMap.has(row.id)) {
            recordsMap.set(row.id, {
              id: row.id,
              name: row.name,
              relativeName: row.relative_name,
              wardNumber: row.ward_number,
              serialNumber: typeof row.serial_number === 'number' && Number.isInteger(row.serial_number) ? row.serial_number : null,
            })
          }
        }
      }
    }

    // Fallback: If both split queries failed, try standard combined query
    if (recordsMap.size === 0 && (!nameRes?.ok || !relativeRes?.ok)) {
      const fallbackUrl = new URL(baseUrl)
      fallbackUrl.searchParams.set('select', 'id,name,relative_name,ward_number,serial_number')
      fallbackUrl.searchParams.set('or', `(${[...nameConditions, ...relativeConditions].join(',')})`)
      if (targetWard) fallbackUrl.searchParams.set('ward_number', `eq.${targetWard}`)
      fallbackUrl.searchParams.set('limit', '150')

      const fallbackRes = await fetch(fallbackUrl, { headers: authHeaders, cache: 'no-store', signal: AbortSignal.timeout(6000) })
      if (!fallbackRes.ok) return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })
      const rows = (await fallbackRes.json()) as Row[]
      if (Array.isArray(rows)) {
        for (const row of rows) {
          recordsMap.set(row.id, {
            id: row.id,
            name: row.name,
            relativeName: row.relative_name,
            wardNumber: row.ward_number,
            serialNumber: typeof row.serial_number === 'number' && Number.isInteger(row.serial_number) ? row.serial_number : null,
          })
        }
      }
    }

    const allRecords = Array.from(recordsMap.values())
    const sorted = sortRankedRecords(allRecords, searchVariants)

    const total = sorted.length
    const results = sorted.slice(offset, offset + pageSize)
    const hasMore = offset + results.length < total

    return NextResponse.json({
      results,
      total,
      page,
      pageSize,
      hasMore,
      sample: false,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })
  }
    }
