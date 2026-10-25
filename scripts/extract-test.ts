// Local extraction test:  pnpm tsx scripts/extract-test.ts path/to/file.pdf [page ...]
// Prints only counts and timings (no names) unless --show N is given.
import fs from 'node:fs'
import { extractPages, inspectPdf } from '../lib/ward-extract'
import { analyzeRows } from '../lib/ward-import-core'

async function main() {
const args = process.argv.slice(2)
const showIdx = args.indexOf('--show')
const show = showIdx >= 0 ? Number(args[showIdx + 1]) : 0
const rest = showIdx >= 0 ? args.filter((_, i) => i !== showIdx && i !== showIdx + 1) : args
const file = rest[0]
const buffer = new Uint8Array(fs.readFileSync(file))
const info = await inspectPdf(buffer, file)
const pages = rest.length > 1 ? rest.slice(1).map(Number) : Array.from({ length: info.pages }, (_, i) => i + 1)
console.log('pages', info.pages, 'hash', info.hash12, 'summary numbers', info.summaryNumbers.join(','), 'filenameWard', info.filenameWard)
const t = Date.now()
const results = await extractPages(buffer, file, info.hash12, pages)
const rows = analyzeRows(results.flatMap((r) => r.rows))
console.log('total ms', Date.now() - t)
for (const r of results) console.log(`page ${r.page}: cards ${r.cards} wardText ${r.wardText} wardOcr ${r.wardOcr} ocr ${r.ocrMs}ms`)
const flagged = rows.filter((r) => r.flags.length)
console.log('rows', rows.length, 'flagged', flagged.length)
const serials = rows.map((r) => r.serial).filter((s): s is number => s !== null).sort((a, b) => a - b)
console.log('serial range', serials[0], '-', serials[serials.length - 1], 'continuous', serials.every((s, i) => i === 0 || s === serials[i - 1] + 1))
const kinds = new Map<string, number>()
for (const r of rows) for (const f of r.flags) { const k = f.replace(/ as .*$/, '').replace(/\(\d+\)/, ''); kinds.set(k, (kinds.get(k) ?? 0) + 1) }
console.log('flag kinds', JSON.stringify([...kinds]))
if (show) for (const r of rows.slice(0, show)) console.log(r.serial, '|', r.person_name, '|', r.relative_name, '|', r.ward_number, '|', r.confidence, '|', r.flags.join('; '))
}
main().catch((e) => { console.error(e); process.exit(1) })
