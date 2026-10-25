import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeRows, cleanOcrValue, nameFlags, validateCommitRow, validateUploadList, wardFromFilename, recordKey, looseKey, type PreviewRow } from '../lib/ward-import-core'

const row = (o: Partial<PreviewRow>): PreviewRow => ({ key: 'aaaaaaaaaaaa:1', serial: 1, person_name: 'कमला', relative_name: 'शोभा लाल', ward_number: '12', source_filename: 'a.pdf', source_page: 3, confidence: 90, flags: [], ...o })
const commit = (o: Record<string, unknown> = {}) => ({ source_record_key: 'aaaaaaaaaaaa:1', person_name: 'कमला', relative_name: 'शोभा लाल', ward_number: '12', source_filename: 'a.pdf', source_page: 3, approved: true, ...o })

test('record key is deterministic', () => assert.equal(recordKey('abcdef012345', 7), 'abcdef012345:7'))
test('OCR label residue is stripped and Hindi is preserved', () => {
  assert.equal(cleanOcrValue('नाम:किशना'), 'किशना')
  assert.equal(cleanOcrValue('पति का नाम: शोभा लाल |'), 'शोभा लाल')
  assert.equal(cleanOcrValue('घासी  लाल'), 'घासी लाल')
})
test('name flags: missing and unexpected characters', () => {
  assert.deepEqual(nameFlags('', 'person name'), ['Missing person name'])
  assert.ok(nameFlags('कमला$7', 'person name').length === 1)
  assert.deepEqual(nameFlags('आरव मेहता', 'person name'), [])
})
test('exact duplicate rows with different keys are flagged, not dropped', () => {
  const out = analyzeRows([row({ key: 'aaaaaaaaaaaa:274', serial: 274 }), row({ key: 'aaaaaaaaaaaa:275', serial: 275 })])
  assert.equal(out.length, 2)
  assert.ok(out.every((r) => r.flags.some((f) => f.includes('Same name and relative'))))
})
test('similar spelling is flagged', () => {
  const out = analyzeRows([row({ key: 'aaaaaaaaaaaa:1', person_name: 'रामचरण' }), row({ key: 'aaaaaaaaaaaa:2', serial: 2, person_name: 'रामचरन' })])
  assert.ok(out[0].flags.some((f) => f.includes('Similar')))
})
test('conflicting ward values are flagged', () => {
  const out = analyzeRows([row({}), row({ key: 'aaaaaaaaaaaa:2', serial: 2, ward_number: '13' })])
  assert.ok(out.every((r) => r.flags.includes('§Conflicting ward values for the same person')))
})
test('duplicate source keys are flagged', () => {
  const out = analyzeRows([row({}), row({ person_name: 'अन्य' })])
  assert.ok(out.every((r) => r.flags.includes('§Duplicate source key in this batch')))
})
test('analyze is idempotent (does not accumulate flags)', () => {
  const once = analyzeRows([row({}), row({ key: 'aaaaaaaaaaaa:2', serial: 2 })])
  const twice = analyzeRows(once)
  assert.deepEqual(once.map((r) => r.flags), twice.map((r) => r.flags))
})
test('commit validation accepts a clean approved row', () => assert.deepEqual(validateCommitRow(commit()), []))
test('commit validation rejects unapproved, bad ward, bad key, blank name, bad page', () => {
  assert.ok(validateCommitRow(commit({ approved: false })).length)
  for (const ward of ['0', '1000', '012', 'abc', '', '12 ']) assert.ok(validateCommitRow(commit({ ward_number: ward })).length, ward)
  assert.ok(validateCommitRow(commit({ source_record_key: 'not-a-key' })).length)
  assert.ok(validateCommitRow(commit({ person_name: '   ' })).length)
  assert.ok(validateCommitRow(commit({ source_page: 0 })).length)
  assert.ok(validateCommitRow(commit({ person_name: 'x\u0000y' })).length)
  assert.ok(validateCommitRow(null).length)
})
test('relative name may be empty', () => assert.deepEqual(validateCommitRow(commit({ relative_name: '' })), []))
test('upload list limits', () => {
  assert.equal(validateUploadList([]).ok, false)
  assert.equal(validateUploadList(Array.from({ length: 51 }, (_, i) => ({ name: `${i}.pdf`, size: 10 }))).ok, false)
  assert.equal(validateUploadList([{ name: 'a.txt', size: 10 }]).ok, false)
  assert.equal(validateUploadList([{ name: 'a.pdf', size: 26 * 1048576 }]).ok, false)
  assert.equal(validateUploadList(Array.from({ length: 11 }, (_, i) => ({ name: `${i}.pdf`, size: 24 * 1048576 }))).ok, false)
  assert.equal(validateUploadList([{ name: 'a.pdf', size: 0 }]).ok, false)
  assert.equal(validateUploadList([{ name: 'a.pdf', size: 4_266_761 }]).ok, true)
})
test('filename ward is parsed only as a hint', () => {
  assert.equal(wardFromFilename('WithPhoto_DABI-Ward_No-012.pdf'), '12')
  assert.equal(wardFromFilename('random.pdf'), null)
})
test('looseKey ignores nukta/virama/spaces', () => assert.equal(looseKey('राम चरण'), looseKey('रामचरण')))
