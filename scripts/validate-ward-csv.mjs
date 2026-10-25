#!/usr/bin/env node
import fs from 'node:fs'
import path from 'node:path'

const input = process.argv[2]
const output = process.argv[3] ?? 'ward-import-review.json'
const MAX_WARD = 9999
const REQUIRED = ['name', 'relative_name', 'ward_number', 'source_filename', 'source_page', 'source_record_key']

if (!input) {
  console.error('Usage: pnpm validate:ward-csv <input.csv> [report.json]')
  process.exit(2)
}

const text = fs.readFileSync(path.resolve(input), 'utf8').replace(/^\uFEFF/, '')
const lines = text.split(/\r?\n/).filter((line, index, rows) => line.length > 0 || index < rows.length - 1)
const errors = []
const warnings = []
const records = []

function parseLine(line) {
  const values = []
  let value = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index]
    if (char === '"' && line[index + 1] === '"' && quoted) { value += '"'; index += 1; continue }
    if (char === '"') { quoted = !quoted; continue }
    if (char === ',' && !quoted) { values.push(value.trim()); value = ''; continue }
    value += char
  }
  if (quoted) return { error: 'Unclosed quoted field' }
  values.push(value.trim())
  return { values }
}

const headerResult = parseLine(lines[0] ?? '')
const headers = headerResult.values ?? []
if (headerResult.error || headers.join(',') !== REQUIRED.join(',')) {
  errors.push({ row: 1, errors: [`Header must be exactly: ${REQUIRED.join(',')}`] })
}

const seenKeys = new Map()
const seenRecords = new Map()
for (let index = 1; index < lines.length; index += 1) {
  const rowNumber = index + 1
  const parsed = parseLine(lines[index])
  if (parsed.error) { errors.push({ row: rowNumber, errors: [parsed.error] }); continue }
  if (parsed.values.length !== REQUIRED.length) { errors.push({ row: rowNumber, errors: [`Expected ${REQUIRED.length} columns, found ${parsed.values.length}`] }); continue }
  const record = Object.fromEntries(REQUIRED.map((key, position) => [key, parsed.values[position]]))
  const rowErrors = []
  if (!record.name) rowErrors.push('name is required')
  if (!record.relative_name) warnings.push({ row: rowNumber, message: 'relative_name is blank; verify whether the name is unique' })
  if (!/^\d{1,4}$/.test(record.ward_number) || Number(record.ward_number) < 1 || Number(record.ward_number) > MAX_WARD) rowErrors.push('ward_number must be an integer from 1 to 9999')
  if (!record.source_filename) rowErrors.push('source_filename is required')
  if (!/^\d+$/.test(record.source_page) || Number(record.source_page) < 1) rowErrors.push('source_page must be a positive integer')
  if (!record.source_record_key) rowErrors.push('source_record_key is required for idempotency')
  const canonical = [record.name, record.relative_name, record.ward_number].map((value) => value.normalize('NFKC').toLocaleLowerCase('hi-IN').replace(/\s+/g, ' ').trim()).join('|')
  if (seenKeys.has(record.source_record_key)) rowErrors.push(`duplicate source_record_key (also row ${seenKeys.get(record.source_record_key)})`)
  if (seenRecords.has(canonical)) rowErrors.push(`duplicate person/relative/ward record (also row ${seenRecords.get(canonical)})`)
  if (rowErrors.length) errors.push({ row: rowNumber, errors: rowErrors })
  seenKeys.set(record.source_record_key, rowNumber)
  seenRecords.set(canonical, rowNumber)
  records.push(record)
}

const report = { input_file: input, generated_at: new Date().toISOString(), valid_rows: errors.length ? 0 : records.length, record_count: records.length, error_count: errors.length, warning_count: warnings.length, errors, warnings, import_status: errors.length ? 'blocked_review_required' : 'ready_for_manual_import_review' }
fs.writeFileSync(path.resolve(output), JSON.stringify(report, null, 2) + '\n', 'utf8')
console.log(JSON.stringify({ report: output, ...report }, null, 2))
process.exit(errors.length ? 1 : 0)
