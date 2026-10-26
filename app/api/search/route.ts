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
  { id: 'sample-17', name: 'रमेश', relativeName: 'मुकेश', wardNumber: '5', serialNumber: 74 },
  { id: 'sample-18', name: 'Ramesh', relativeName: 'Mukesh', wardNumber: '5', serialNumber: 75 },
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
 * Calculates relevance score for single-name searches.
 * Guarantees person name matches (600-1000) rank ahead of relative matches (200-400).
 */
function getSingleRelevanceScore(record: { name: string; relativeName: string | null }, variants: string[]): number {
  const normName = normalizeSearchField(record.name)
  const normRel = record.relativeName ? normalizeSearchField(record.relativeName) : ''

  let highestScore = 0

  for (const v of variants) {
    const nv = normalizeSearchField(v)
    if (!nv) continue

    // 1. Exact match on person name
    if (normName === nv) {
      highestScore = Math.max(highestScore, 1000)
      continue
    }

    // 2. Person name starts with variant
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

    // 4. Substring inside person name
    if (normName.includes(nv)) {
      highestScore = Math.max(highestScore, 600)
      continue
    }

    // 5. Exact match on relative name
    if (normRel === nv) {
      highestScore = Math.max(highestScore, 400)
      continue
    }

    // 6. Relative name starts with variant
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

/**
 * Calculates relevance score for dual searches (e.g. "Ramesh, Mukesh").
 * Records matching BOTH the Person Name and Relative Name receive high priority (2000+).
 */
function getDualRelevanceScore(
  record: { name: string; relativeName: string | null },
  personVariants: string[],
  relativeVariants: string[]
): number {
  const normName = normalizeSearchField(record.name)
  const normRel = record.relativeName ? normalizeSearchField(record.relativeName) : ''

  let nameScore = 0
  for (const v of personVariants) {
    const nv = normalizeSearchField(v)
    if (!nv) continue
    if (normName === nv) {
      nameScore = Math.max(nameScore, 1000)
      break
    }
    if (normName.startsWith(nv + ' ') || normName.startsWith(nv)) {
      nameScore = Math.max(nameScore, 800)
    } else if (normName.split(' ').includes(nv)) {
      nameScore = Math.max(nameScore, 700)
    } else if (normName.includes(nv)) {
      nameScore = Math.max(nameScore, 600)
    }
  }

  let relScore = 0
  for (const v of relativeVariants) {
    const nv = normalizeSearchField(v)
    if (!nv) continue
    if (normRel === nv) {
      relScore = Math.max(relScore, 1000)
      break
    }
    if (normRel.startsWith(nv + ' ') || normRel.startsWith(nv)) {
      relScore = Math.max(relScore, 800)
    } else if (normRel.split(' ').includes(nv)) {
      relScore = Math.max(relScore, 700)
    } else if (normRel.includes(nv)) {
      relScore = Math.max(relScore, 600)
    }
  }

  // Exact dual match: both person name and relative name match
  if (nameScore > 0 && relScore > 0) {
    return 2000 + nameScore + relScore
  }

  // Partial match: only person name matched
  if (nameScore > 0) {
    return nameScore
  }

  // Fallback: only relative name matched
  if (relScore > 0) {
    return Math.floor(relScore / 2)
  }

  return 0
}

function parseWardNum(ward: string): number {
  const match = ward.match(/\d+/)
  return match ? parseInt(match[0], 10) : 999999
}

function parseSerialNum(serial: number | null): number {
  return typeof serial === 'number' && Number.isInteger(serial) ? serial : 99999999
}

function sortRankedRecords(
  records: SearchRecord[],
  personVariants: string[],
  relativeVariants?: string[]
): SearchRecord[] {
  const isDual = Array.isArray(relativeVariants) && relativeVariants.length > 0

  return [...records].sort((a, b) => {
    const scoreA = isDual
      ? getDualRelevanceScore(a, personVariants, relativeVariants)
      : getSingleRelevanceScore(a, personVariants)
    const scoreB = isDual
      ? getDualRelevanceScore(b, personVariants, relativeVariants)
      : getSingleRelevanceScore(b, personVariants)

    if (scoreA !== scoreB) {
      return scoreB - scoreA
    }

    // Secondary: Numeric ward order
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
  const rawQuery = url.searchParams.get('q')?.trim() ?? ''
  const wardParam = url.searchParams.get('ward')?.trim() ?? ''
  const pageParam = parseInt(url.searchParams.get('page') || '1', 10)
  const page = Number.isInteger(pageParam) && pageParam > 0 ? pageParam : 1
  const pageSizeParam = parseInt(url.searchParams.get('pageSize') || '100', 10)
  const pageSize = Number.isInteger(pageSizeParam) && pageSizeParam > 0 && pageSizeParam <= 200 ? pageSizeParam : 100
  const offset = (page - 1) * pageSize

  if (!rawQuery || rawQuery.length > 100) return NextResponse.json({ results: [], total: 0, page: 1, hasMore: false })

  // Validate ward filter if provided
  const targetWard = wardParam && wardParam !== 'all' && WARD_RE.test(wardParam) ? wardParam : null

  // Check if user is searching in "Person, Relative" dual format (e.g. "Ramesh, Mukesh")
  const commaParts = rawQuery.split(',').map((p) => p.trim()).filter(Boolean)
  const isDualSearch = commaParts.length >= 2

  let personQuery = rawQuery
  let relativeQuery = ''
  if (isDualSearch) {
    personQuery = commaParts[0]
    relativeQuery = commaParts.slice(1).join(' ')
  }

  // Generate transliteration variants for person name
  const personVariants = getSearchVariants(personQuery)
  if (!personVariants.length) personVariants.push(personQuery)

  // Generate transliteration variants for relative name if dual search
  let relativeVariants: string[] = []
  if (isDualSearch && relativeQuery) {
    relativeVariants = getSearchVariants(relativeQuery)
    if (!relativeVariants.length) relativeVariants.push(relativeQuery)
  }

  const sampleMode = process.env.WARD_FINDER_SAMPLE_MODE === 'true' || process.env.NODE_ENV !== 'production'

  if (sampleMode) {
    let filtered: SearchRecord[] = []

    if (isDualSearch) {
      const normPersonVariants = personVariants.map(normalizeSearchField)
      const normRelVariants = relativeVariants.map(normalizeSearchField)

      filtered = sampleRecords.filter((record) => {
        if (targetWard && record.wardNumber !== targetWard) return false
        const normName = normalizeSearchField(record.name)
        const normRel = record.relativeName ? normalizeSearchField(record.relativeName) : ''

        const matchesPerson = normPersonVariants.some((v) => normName.includes(v) || v.includes(normName))
        const matchesRelative = normRelVariants.some((v) => normRel.includes(v) || v.includes(normRel))

        return matchesPerson && matchesRelative
      })

      // If strict dual match found 0, fallback to person matches
      if (filtered.length === 0) {
        filtered = sampleRecords.filter((record) => {
          if (targetWard && record.wardNumber !== targetWard) return false
          const normName = normalizeSearchField(record.name)
          return normPersonVariants.some((v) => normName.includes(v) || v.includes(normName))
        })
      }
    } else {
      const normalizedVariants = personVariants.map(normalizeSearchField)
      filtered = sampleRecords.filter((record) => {
        if (targetWard && record.wardNumber !== targetWard) return false
        const fields = [record.name, record.relativeName].filter((f): f is string => Boolean(f)).map(normalizeSearchField)
        return fields.some((field) => normalizedVariants.some((variant) => field.includes(variant) || variant.includes(field)))
      })
    }

    const sorted = sortRankedRecords(filtered, personVariants, isDualSearch ? relativeVariants : undefined)
    const total = sorted.length
    const results = sorted.slice(offset, offset + pageSize)
    const hasMore = offset + results.length < total

    return NextResponse.json(
      {
        results,
        total,
        page,
        pageSize,
        hasMore,
        isDualSearch,
        sample: true,
        notice: 'Fictional sample records only.',
      },
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

  // Construct search conditions
  const nameConditions: string[] = []
  for (const variant of personVariants) {
    const escaped = variant.replace(/[\\%_*(),]/g, (char) => `\\${char}`)
    nameConditions.push(`name.ilike.*${escaped}*`)
  }

  const relativeConditions: string[] = []
  const relVariantsToSearch = isDualSearch ? relativeVariants : personVariants
  for (const variant of relVariantsToSearch) {
    const escaped = variant.replace(/[\\%_*(),]/g, (char) => `\\${char}`)
    relativeConditions.push(`relative_name.ilike.*${escaped}*`)
  }

  type Row = {
    id: string
    name: string
    relative_name: string | null
    ward_number: string
    serial_number: number | null
  }

  const recordsMap = new Map<string, SearchRecord>()
  const authHeaders = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Prefer: 'count=exact',
  }

  try {
    if (isDualSearch) {
      // 1. Try exact dual search: Person name matches AND Relative name matches
      const dualUrl = new URL(baseUrl)
      dualUrl.searchParams.set('select', 'id,name,relative_name,ward_number,serial_number')
      dualUrl.searchParams.set('and', `(or(${nameConditions.join(',')}),or(${relativeConditions.join(',')}))`)
      if (targetWard) dualUrl.searchParams.set('ward_number', `eq.${targetWard}`)
      dualUrl.searchParams.set('limit', '100')

      const dualRes = await fetch(dualUrl, { headers: authHeaders, cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => null)

      if (dualRes && dualRes.ok) {
        const rows = (await dualRes.json()) as Row[]
        if (Array.isArray(rows) && rows.length > 0) {
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

      // 2. If dual query returned few or zero results, fetch person name candidates
      if (recordsMap.size < 5) {
        const fallbackNameUrl = new URL(baseUrl)
        fallbackNameUrl.searchParams.set('select', 'id,name,relative_name,ward_number,serial_number')
        fallbackNameUrl.searchParams.set('or', `(${nameConditions.join(',')})`)
        if (targetWard) fallbackNameUrl.searchParams.set('ward_number', `eq.${targetWard}`)
        fallbackNameUrl.searchParams.set('limit', '150')

        const fallbackRes = await fetch(fallbackNameUrl, { headers: authHeaders, cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => null)
        if (fallbackRes && fallbackRes.ok) {
          const rows = (await fallbackRes.json()) as Row[]
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
      }
    } else {
      // Single name search: query person matches and relative matches in parallel
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

      const [nameRes, relativeRes] = await Promise.all([
        fetch(nameUrl, { headers: authHeaders, cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => null),
        fetch(relativeUrl, { headers: authHeaders, cache: 'no-store', signal: AbortSignal.timeout(6000) }).catch(() => null),
      ])

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

      // Combined fallback if needed
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
    }

    const allRecords = Array.from(recordsMap.values())
    const sorted = sortRankedRecords(allRecords, personVariants, isDualSearch ? relativeVariants : undefined)

    const total = sorted.length
    const results = sorted.slice(offset, offset + pageSize)
    const hasMore = offset + results.length < total

    return NextResponse.json({
      results,
      total,
      page,
      pageSize,
      hasMore,
      isDualSearch,
      sample: false,
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ error: 'Search unavailable.' }, { status: 502 })
  }
    }
