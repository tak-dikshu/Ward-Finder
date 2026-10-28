// Server-side extraction for Rajasthan panchayat check-list PDFs.
//
// The PDFs' own text layer has corrupted Hindi (broken font encoding), so it is
// NEVER used for names. It is used only for geometry (where each field sits) and
// for plain digits (serial numbers, ward number, voter total). Names come from
// OCR of the rendered page. Voter IDs, photos, ages, genders and house numbers
// are never read into the output.
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { LOW_CONFIDENCE, cleanOcrValue, nameFlags, recordKey, type PreviewRow } from './ward-import-core'

const DPI = 300
const SCALE = DPI / 72
const ID_RE = /^(?:[A-Z]{2,4}\d{5,10}|[A-Z]{2}\/\d+\/\d+\/\d+)$/

type Line = { t: string; x: number; y: number; w: number; h: number }
type Box = { x0: number; y0: number; x1: number; y1: number }
type OcrWord = { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }

/** True when both OCR language files shipped with this deployment. */
export function ocrModelsPresent(dir: string = path.join(process.cwd(), 'assets', 'ocr')): boolean {
  return ['hin.traineddata', 'eng.traineddata'].every((name) => {
    try { return fs.statSync(path.join(dir, name)).size > 1_000_000 } catch { return false }
  })
}

export type PdfInfo = { pages: number; hash12: string; summaryNumbers: number[]; filenameWard: string | null }
export type PageResult = {
  page: number
  cards: number
  wardText: string | null
  wardOcr: string | null
  rows: PreviewRow[]
  ocrMs: number
}

type MuDoc = { countPages(): number; loadPage(i: number): MuPage }
type MuPage = { toStructuredText(o?: string): { asJSON(): string }; toPixmap(m: unknown, cs: unknown, alpha?: boolean, annots?: boolean): { asPNG(): Uint8Array; destroy?: () => void }; destroy?: () => void }

async function mu() {
  return (await import('mupdf')) as unknown as {
    Document: { openDocument(buf: Uint8Array, magic: string): MuDoc }
    Matrix: { scale(x: number, y: number): unknown }
    ColorSpace: { DeviceGray: unknown }
  }
}

function linesOf(page: MuPage): Line[] {
  const json = JSON.parse(page.toStructuredText('preserve-whitespace').asJSON()) as { blocks: Array<{ lines?: Array<{ text: string; bbox: { x: number; y: number; w: number; h: number } }> }> }
  const out: Line[] = []
  for (const block of json.blocks) for (const line of block.lines ?? []) out.push({ t: line.text, x: line.bbox.x, y: line.bbox.y, w: line.bbox.w, h: line.bbox.h })
  return out
}

export function pdfHash12(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex').slice(0, 12)
}

export async function inspectPdf(buffer: Uint8Array, filename: string): Promise<PdfInfo> {
  const { Document } = await mu()
  const doc = Document.openDocument(buffer, 'application/pdf')
  const pages = doc.countPages()
  const first = doc.loadPage(0)
  const summaryNumbers = linesOf(first).map((l) => l.t.trim()).filter((t) => /^\d{1,5}$/.test(t)).map(Number)
  const { wardFromFilename } = await import('./ward-import-core')
  return { pages, hash12: pdfHash12(buffer), summaryNumbers, filenameWard: wardFromFilename(filename) }
}

function union(lines: Line[]): Box | null {
  if (!lines.length) return null
  return { x0: Math.min(...lines.map((l) => l.x)), y0: Math.min(...lines.map((l) => l.y)), x1: Math.max(...lines.map((l) => l.x + l.w)), y1: Math.max(...lines.map((l) => l.y + l.h)) }
}

function textFromBox(words: OcrWord[], box: Box | null): { text: string; confidence: number } {
  if (!box) return { text: '', confidence: 0 }
  const pad = 2
  const hits = words.filter((w) => {
    const wb = { x0: w.bbox.x0 / SCALE, y0: w.bbox.y0 / SCALE, x1: w.bbox.x1 / SCALE, y1: w.bbox.y1 / SCALE }
    const cy = (wb.y0 + wb.y1) / 2
    if (cy < box.y0 - pad || cy > box.y1 + pad) return false
    const overlap = Math.min(wb.x1, box.x1 + pad) - Math.max(wb.x0, box.x0 - pad)
    return overlap > 0 && overlap / Math.max(1, wb.x1 - wb.x0) >= 0.25
  }).sort((a, b) => a.bbox.x0 - b.bbox.x0)
  if (!hits.length) return { text: '', confidence: 0 }
  return { text: cleanOcrValue(hits.map((h) => h.text).join(' ')), confidence: Math.min(...hits.map((h) => h.confidence)) }
}

type Worker = { recognize(image: Uint8Array, options?: Record<string, unknown>): Promise<{ data: { text: string; words: OcrWord[] } }>; terminate(): Promise<unknown>; setParameters(p: Record<string, string>): Promise<unknown> }

async function makeWorker(lang: 'hin' | 'eng'): Promise<Worker> {
  const { createWorker } = await import('tesseract.js')
  const worker = (await createWorker(lang, 1, { langPath: path.join(process.cwd(), 'assets', 'ocr'), gzip: false, cachePath: '/tmp/ward-finder-tesseract' })) as unknown as Worker
  if (lang === 'hin') await worker.setParameters({ tessedit_pageseg_mode: '4' })
  else await worker.setParameters({ tessedit_pageseg_mode: '7', tessedit_char_whitelist: '0123456789' })
  return worker
}

/** Independent digit-only OCR of the ward number printed in the page header. */
async function ocrWardDigits(worker: Worker, png: Uint8Array, line: Line | undefined): Promise<string | null> {
  if (!line) return null
  const left = Math.max(0, Math.floor((line.x + line.w - 26) * SCALE))
  const top = Math.max(0, Math.floor((line.y - 3) * SCALE))
  const { data } = await worker.recognize(png, { rectangle: { left, top, width: Math.ceil(30 * SCALE), height: Math.ceil((line.h + 6) * SCALE) } })
  const digits = data.text.replace(/\D/g, '')
  return /^[0-9]{1,3}$/.test(digits) ? digits : null
}

/** Extract the cards from the given 1-based page numbers of one PDF. */
export async function extractPages(buffer: Uint8Array, filename: string, hash12: string, pageNumbers: number[]): Promise<PageResult[]> {
  const { Document, Matrix, ColorSpace } = await mu()
  const doc = Document.openDocument(buffer, 'application/pdf')
  const total = doc.countPages()
  const worker = await makeWorker('hin')
  const digitWorker = await makeWorker('eng')
  const results: PageResult[] = []
  try {
    for (const pageNumber of pageNumbers) {
      if (pageNumber < 1 || pageNumber > total) continue
      const page = doc.loadPage(pageNumber - 1)
      const lines: Line[] = linesOf(page)
      // Deletion or modification section heading: "घटक 2: विलोपन सूची" or "घटक 3: संशोधन सूची"
      const deletionHeader = lines.find((l) => /घटक\s*[23]/i.test(l.t))
      const anchors: Array<{ x: number; y: number; serial: number | null }> = []

      // 1. Standard cards with EPIC IDs (e.g. IXI1234567, RJ/14/...)
      for (const l of lines) {
        if (!ID_RE.test(l.t.trim())) continue
        if (deletionHeader && l.y >= deletionHeader.y - 12) continue
        const serialLine = lines.find((s) => /^\s*\d{1,5}\s*$/.test(s.t) && s.x >= l.x - 35 && s.x <= l.x - 2 && Math.abs(s.y - (l.y + 1)) < 7)
        anchors.push({ x: l.x, y: l.y, serial: serialLine ? Number(serialLine.t.trim()) : null })
      }

      // 2. Supplementary addition cards (परिवर्धन सूची) without EPIC IDs
      for (const l of lines) {
        if (!/^\s*\d{1,5}\s*$/.test(l.t)) continue
        if (deletionHeader && l.y >= deletionHeader.y - 12) continue
        const val = Number(l.t.trim())
        if (val < 1 || val > 10000) continue
        const nearExisting = anchors.some((a) => Math.abs(a.y - l.y) < 7 && l.x >= a.x - 35 && l.x <= a.x - 2)
        if (nearExisting) continue
        const hasNameBelow = lines.some((nl) => /[नना]र?म\s*:/.test(nl.t) && Math.abs(nl.x - (l.x - 16)) < 25 && nl.y - l.y >= 8 && nl.y - l.y <= 20)
        if (hasNameBelow) {
          anchors.push({ x: l.x + 31, y: l.y - 1, serial: val })
        }
      }

      const wardLineObj = lines.find((l) => /कमरपक\s*:\s*\d{1,3}\s*$/.test(l.t))
      const wardMatch = wardLineObj ? wardLineObj.t.match(/(\d{1,3})\s*$/) : null
      const wardText = wardMatch ? wardMatch[1] : null
      if (!anchors.length) { results.push({ page: pageNumber, cards: 0, wardText, wardOcr: null, rows: [], ocrMs: 0 }); continue }

      const png = page.toPixmap(Matrix.scale(SCALE, SCALE), ColorSpace.DeviceGray, false, true).asPNG()
      const started = Date.now()
      const { data } = await worker.recognize(png)
      const ocrMs = Date.now() - started
      const wardOcr = await ocrWardDigits(digitWorker, png, wardLineObj)
      const { wardFromFilename } = await import('./ward-import-core')
      const fileWard = wardFromFilename(filename)
      const wardExact = wardText && wardOcr && wardText === wardOcr
      const ward = wardExact ? wardText : (wardText || fileWard || '')

      const rows: PreviewRow[] = []
      for (const a of anchors) {
        const left = a.x - 40
        const right = left + 140
        const inColumn = (l: Line) => l.x >= left - 2 && l.x < right && !l.t.includes(':') && l.t.trim() !== '' && !/^\s*\d+\s*$/.test(l.t)
        const nameBox = union(lines.filter((l) => inColumn(l) && l.y >= a.y + 10 && l.y <= a.y + 19))
        const relBox = union(lines.filter((l) => inColumn(l) && l.y >= a.y + 23 && l.y <= a.y + 32))
        const serial = a.serial
        const person = textFromBox(data.words, nameBox)
        const relative = textFromBox(data.words, relBox)
        // If box is completely empty and serial is null, skip it
        if (serial === null && !person.text.trim()) continue

        const flags = [...nameFlags(person.text, 'person name'), ...(relative.text ? nameFlags(relative.text, 'relative name') : ['Missing relative name'])]
        const confidence = Math.round(Math.min(person.confidence || 0, relative.confidence || person.confidence || 0))
        if (confidence < LOW_CONFIDENCE) flags.push(`Low OCR confidence (${confidence})`)
        if (serial === null) flags.push('Missing serial number')
        if (!wardExact) flags.push('Ward number uncertain (header OCR and PDF digits disagree or are missing)')
        rows.push({ key: serial === null ? '' : recordKey(hash12, serial), serial, person_name: person.text, relative_name: relative.text, ward_number: ward, source_filename: path.basename(filename), source_page: pageNumber, confidence, flags })
      }
      results.push({ page: pageNumber, cards: anchors.length, wardText, wardOcr, rows, ocrMs })
    }
  } finally {
    await worker.terminate()
    await digitWorker.terminate()
  }
  return results
    }
