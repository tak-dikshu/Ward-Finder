// Pure, dependency-free helpers shared by the admin UI (display flags) and the
// server routes (hard validation before anything touches the database).

export const MAX_FILES = 50
export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_TOTAL_BYTES = 250 * 1024 * 1024
export const MAX_ROWS_PER_COMMIT = 5000
export const PAGES_PER_CHUNK = 2
export const LOW_CONFIDENCE = 75

export const WARD_RE = /^[1-9][0-9]{0,2}$/
export const KEY_RE = /^[0-9a-f]{12}:[0-9]{1,5}$/
const DEVANAGARI_NAME_RE = /^[\u0900-\u097F][\u0900-\u097F .'’-]*$/

export type PreviewRow = {
  key: string
  serial: number | null
  person_name: string
  relative_name: string
  ward_number: string
  source_filename: string
  source_page: number
  confidence: number
  flags: string[]
}

export type CommitRow = {
  source_record_key: string
  person_name: string
  relative_name: string
  ward_number: string
  source_filename: string
  source_page: number
  approved: boolean
}

export function normalizeText(value: string): string {
  return value.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g, '').replace(/\s+/g, ' ').trim()
}

/** Strip OCR label residue and stray punctuation from an OCR'd value. */
export function cleanOcrValue(value: string): string {
  let text = value
  const colon = Math.max(text.lastIndexOf(':'), text.lastIndexOf('：'))
  if (colon >= 0) text = text.slice(colon + 1)
  text = text.replace(/[|_\[\]{}$@#*~^<>"“”]/g, ' ')
  return normalizeText(text).replace(/^[.\-'’ ]+|[ -]+$/g, '').trim()
}

export function nameFlags(value: string, label: string): string[] {
  if (!value) return [`Missing ${label}`]
  const flags: string[] = []
  if (value.length > 120) flags.push(`${label} unusually long`)
  if (!DEVANAGARI_NAME_RE.test(value)) flags.push(`${label} has unexpected characters`)
  return flags
}

export function recordKey(fileHash12: string, serial: number): string {
  return `${fileHash12}:${serial}`
}

/** Spelling-insensitive key for duplicate / similar-name detection. */
export function looseKey(value: string): string {
  return normalizeText(value).replace(/[\s\u093C\u094D\u0901\u0902\u200d.'’-]/g, '').toLowerCase()
}

function editDistanceAtMostOne(a: string, b: string): boolean {
  if (a === b) return true
  if (Math.abs(a.length - b.length) > 1) return false
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1)
  return a.length > b.length ? a.slice(i + 1) === b.slice(i) : a.slice(i) === b.slice(i + 1)
}

/**
 * Adds cross-row flags: duplicate keys, exact duplicates, similar names, and
 * conflicting ward values. Returns new row objects; input is not mutated.
 */
export function analyzeRows(input: PreviewRow[]): PreviewRow[] {
  const rows = input.map((row) => ({ ...row, flags: row.flags.filter((flag) => !flag.startsWith('§')) }))
  const add = (row: PreviewRow, flag: string) => { if (!row.flags.includes(flag)) row.flags.push(flag) }
  const byKey = new Map<string, number[]>()
  rows.forEach((row, index) => byKey.set(row.key, [...(byKey.get(row.key) ?? []), index]))
  for (const indexes of byKey.values()) if (indexes.length > 1) indexes.forEach((i) => add(rows[i], '§Duplicate source key in this batch'))

  const loose = rows.map((row) => ({ person: looseKey(row.person_name), relative: looseKey(row.relative_name) }))
  for (let i = 0; i < rows.length; i++) {
    if (!loose[i].person) continue
    for (let j = i + 1; j < rows.length; j++) {
      if (loose[i].relative !== loose[j].relative && !(loose[i].relative && loose[j].relative && editDistanceAtMostOne(loose[i].relative, loose[j].relative))) continue
      if (!editDistanceAtMostOne(loose[i].person, loose[j].person)) continue
      const exact = rows[i].person_name === rows[j].person_name && rows[i].relative_name === rows[j].relative_name
      const sameWard = rows[i].ward_number === rows[j].ward_number
      const labelI = `§${exact ? 'Same name and relative' : 'Similar name and relative'} as ${rows[j].source_filename} #${rows[j].serial ?? '?'}`
      const labelJ = `§${exact ? 'Same name and relative' : 'Similar name and relative'} as ${rows[i].source_filename} #${rows[i].serial ?? '?'}`
      add(rows[i], labelI); add(rows[j], labelJ)
      if (!sameWard) { add(rows[i], '§Conflicting ward values for the same person'); add(rows[j], '§Conflicting ward values for the same person') }
    }
  }
  return rows
}

/** Hard validation applied server-side before import. Returns error strings. */
export function validateCommitRow(row: unknown): string[] {
  const errors: string[] = []
  if (typeof row !== 'object' || row === null) return ['Row is not an object']
  const r = row as Record<string, unknown>
  if (r.approved !== true) errors.push('Row was not approved')
  if (typeof r.source_record_key !== 'string' || !KEY_RE.test(r.source_record_key)) errors.push('Invalid source record key')
  for (const field of ['person_name', 'relative_name', 'source_filename'] as const) {
    const v = r[field]
    if (typeof v !== 'string') { errors.push(`${field} must be text`); continue }
    if (v.length > 200) errors.push(`${field} too long`)
    if (/[\u0000-\u001f\u007f]/.test(v)) errors.push(`${field} has control characters`)
  }
  if (typeof r.person_name === 'string' && !normalizeText(r.person_name)) errors.push('Missing person name')
  if (typeof r.relative_name === 'string' && r.relative_name !== '' && !normalizeText(r.relative_name)) errors.push('Blank relative name')
  if (typeof r.ward_number !== 'string' || !WARD_RE.test(r.ward_number)) errors.push('Invalid ward number')
  if (typeof r.source_filename === 'string' && !normalizeText(r.source_filename)) errors.push('Missing source filename')
  if (!Number.isInteger(r.source_page) || (r.source_page as number) < 1 || (r.source_page as number) > 5000) errors.push('Invalid source page')
  return errors
}

export function wardFromFilename(filename: string): string | null {
  const m = filename.match(/ward[\s_.-]*(?:no[\s_.-]*)?0*([0-9]{1,3})/i)
  return m ? m[1] : null
}

export function validateUploadList(files: unknown): { ok: true; files: { name: string; size: number }[] } | { ok: false; error: string } {
  if (!Array.isArray(files) || files.length < 1 || files.length > MAX_FILES) return { ok: false, error: `Select between 1 and ${MAX_FILES} PDF files.` }
  let total = 0
  const out: { name: string; size: number }[] = []
  for (const f of files) {
    if (typeof f !== 'object' || f === null) return { ok: false, error: 'Invalid file list.' }
    const { name, size } = f as { name?: unknown; size?: unknown }
    if (typeof name !== 'string' || !name.toLowerCase().endsWith('.pdf') || name.length > 200) return { ok: false, error: 'PDF files only.' }
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) return { ok: false, error: `${name}: empty or invalid file.` }
    if (size > MAX_FILE_BYTES) return { ok: false, error: `${name}: larger than ${MAX_FILE_BYTES / 1048576} MB.` }
    total += size
    out.push({ name, size })
  }
  if (total > MAX_TOTAL_BYTES) return { ok: false, error: `Batch larger than ${MAX_TOTAL_BYTES / 1048576} MB.` }
  return { ok: true, files: out }
}
