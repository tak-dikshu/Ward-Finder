import { randomUUID } from 'node:crypto'
import { NextResponse } from 'next/server'
import { getAdminState } from '@/lib/admin-auth'
import { createServiceClient } from '@/lib/supabase/admin'
import { extractPages, inspectPdf, ocrModelsPresent, pdfHash12 } from '@/lib/ward-extract'
import { sweepStaleTemp, TEMP_BUCKET } from '@/lib/temp-storage'
import { MAX_FILE_BYTES, MAX_ROWS_PER_COMMIT, PAGES_PER_CHUNK, validateCommitRow, validateUploadList } from '@/lib/ward-import-core'

export const runtime = 'nodejs'
export const maxDuration = 60

const BUCKET = TEMP_BUCKET
const PATH_RE = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/
const MAX_PDF_PAGES = 400

const json = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store' } })

function sameOrigin(request: Request) {
  const origin = request.headers.get('origin')
  const host = request.headers.get('host')
  if (!origin || !host) return false
  try { return new URL(origin).host === host } catch { return false }
}

type Service = NonNullable<ReturnType<typeof createServiceClient>>

async function loadPdf(service: Service, userId: string, path: unknown): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; response: NextResponse }> {
  if (typeof path !== 'string' || !PATH_RE.test(path) || !path.startsWith(`${userId}/`)) return { ok: false, response: json({ error: 'Invalid upload reference.' }, 400) }
  const { data, error } = await service.storage.from(BUCKET).download(path)
  if (error || !data) return { ok: false, response: json({ error: 'Uploaded file not found. Please upload again.' }, 404) }
  if (data.size > MAX_FILE_BYTES) return { ok: false, response: json({ error: 'File exceeds the size limit.' }, 413) }
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (Buffer.from(bytes.subarray(0, 5)).toString('latin1') !== '%PDF-') return { ok: false, response: json({ error: 'Not a valid PDF file.' }, 422) }
  return { ok: true, bytes }
}

export async function POST(request: Request) {
  if (!sameOrigin(request)) return json({ error: 'Forbidden.' }, 403)
  if (!(request.headers.get('content-type') ?? '').includes('application/json')) return json({ error: 'JSON required.' }, 415)

  const admin = await getAdminState()
  if (admin.status === 'anonymous') return json({ error: 'Authentication required.' }, 401)
  if (admin.status === 'forbidden') return json({ error: 'Not authorized.' }, 403)

  const service = createServiceClient()
  if (!service) return json({ error: 'Server is not configured.' }, 503)

  let body: Record<string, unknown>
  try { body = (await request.json()) as Record<string, unknown> } catch { return json({ error: 'Invalid request.' }, 400) }

  try {
    switch (body.action) {
      case 'sign': {
        const list = validateUploadList(body.files)
        if (!list.ok) return json({ error: list.error }, 400)
        await sweepStaleTemp(service, admin.id)
        const uploads: { name: string; path: string; token: string }[] = []
        for (const file of list.files) {
          const path = `${admin.id}/${randomUUID()}.pdf`
          const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path)
          if (error || !data) return json({ error: 'Could not prepare the upload.' }, 502)
          uploads.push({ name: file.name, path, token: data.token })
        }
        return json({ uploads })
      }
      case 'info': {
        const file = await loadPdf(service, admin.id, body.path)
        if (!file.ok) return file.response
        const filename = typeof body.filename === 'string' ? body.filename : 'upload.pdf'
        let info
        try { info = await inspectPdf(file.bytes, filename) } catch { return json({ error: 'Could not read this PDF.' }, 422) }
        if (info.pages < 1 || info.pages > MAX_PDF_PAGES) return json({ error: `PDF must have 1 to ${MAX_PDF_PAGES} pages.` }, 422)
        return json({ info, ocrReady: ocrModelsPresent() })
      }
      case 'extract': {
        const file = await loadPdf(service, admin.id, body.path)
        if (!file.ok) return file.response
        const pages = Array.isArray(body.pages) ? body.pages : []
        if (!pages.length || pages.length > PAGES_PER_CHUNK || !pages.every((p) => Number.isInteger(p) && p >= 1 && p <= MAX_PDF_PAGES)) return json({ error: 'Invalid page selection.' }, 400)
        const filename = typeof body.filename === 'string' ? body.filename.slice(0, 200) : 'upload.pdf'
        let results
        try { results = await extractPages(file.bytes, filename, pdfHash12(file.bytes), pages as number[]) } catch { return json({ error: 'Text recognition failed for these pages.' }, 422) }
        return json({ results })
      }
      case 'discard': {
        if (typeof body.path !== 'string' || !PATH_RE.test(body.path) || !body.path.startsWith(`${admin.id}/`)) return json({ error: 'Invalid upload reference.' }, 400)
        await service.storage.from(BUCKET).remove([body.path])
        return json({ ok: true })
      }
      case 'commit': {
        const rows = body.rows
        if (!Array.isArray(rows) || rows.length < 1 || rows.length > MAX_ROWS_PER_COMMIT) return json({ error: `Send between 1 and ${MAX_ROWS_PER_COMMIT} approved rows.` }, 400)
        const problems: { index: number; errors: string[] }[] = []
        const seen = new Set<string>()
        rows.forEach((row, index) => {
          const errors = validateCommitRow(row)
          const key = (row as { source_record_key?: unknown })?.source_record_key
          if (typeof key === 'string') { if (seen.has(key)) errors.push('Duplicate source key in request'); seen.add(key) }
          if (errors.length) problems.push({ index, errors })
        })
        if (problems.length) return json({ error: 'Some rows failed validation. Nothing was imported.', problems: problems.slice(0, 20) }, 422)
        const payload = rows.map((r) => {
          const row = r as Record<string, unknown>
          return { source_record_key: row.source_record_key, person_name: String(row.person_name).normalize('NFC').trim(), relative_name: String(row.relative_name ?? '').normalize('NFC').trim(), ward_number: row.ward_number, source_filename: String(row.source_filename).trim(), source_page: row.source_page }
        })
        const { data, error } = await service.rpc('import_ward_staging', { p_rows: payload, p_admin: admin.email })
        if (error) { console.error('[ward-import] commit rejected by database', error.code ?? 'unknown'); return json({ error: 'Import failed. Nothing was imported.' }, 500) }
        return json({ result: data })
      }
      default:
        return json({ error: 'Unknown action.' }, 400)
    }
  } catch (cause) {
    // Log the action and error type only: never file names, record text, or tokens.
    console.error('[ward-import] request failed', String(body.action), cause instanceof Error ? cause.name : 'unknown')
    return json({ error: 'Request failed.' }, 500)
  }
}
