'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, CheckCircle2, FileUp, Loader2, LockKeyhole, LogOut, UploadCloud } from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase/browser'
import { PAGES_PER_CHUNK, analyzeRows, nameFlags, validateUploadList, type PreviewRow } from '@/lib/ward-import-core'

type Row = PreviewRow & { approved: boolean }
type FileReport = { name: string; pages: number; cards: number; notes: string[] }
type PageResult = { page: number; cards: number; wardText: string | null; wardOcr: string | null; rows: PreviewRow[] }
type Info = { pages: number; hash12: string; summaryNumbers: number[]; filenameWard: string | null }
type Filter = 'flagged' | 'all' | 'approved'

const BUCKET = 'ward-import-temp'
const PAGE_SIZE = 50
const NAME_FLAG = /^(Missing (person|relative) name|(person|relative) name )/

async function call<T>(payload: Record<string, unknown>): Promise<T> {
  const response = await fetch('/api/admin/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const data = (await response.json().catch(() => ({}))) as T & { error?: string }
  if (!response.ok) throw new Error(data.error ?? 'Request failed.')
  return data
}

export function AdminPdfImport({ adminEmail }: { adminEmail: string }) {
  const router = useRouter()
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')
  const [reports, setReports] = useState<FileReport[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [filter, setFilter] = useState<Filter>('flagged')
  const [page, setPage] = useState(0)
  const [importResult, setImportResult] = useState('')
  const [batchWard, setBatchWard] = useState('')

  const analyzed = useMemo(() => {
    const flagged = analyzeRows(rows)
    return rows.map((row, i) => ({ ...flagged[i], approved: row.approved }))
  }, [rows])
  const approvedCount = analyzed.filter((r) => r.approved).length
  const flaggedCount = analyzed.filter((r) => r.flags.length).length
  const missingWardCount = rows.filter((r) => !r.ward_number.trim()).length
  const visible = analyzed.map((row, index) => ({ row, index })).filter(({ row }) => filter === 'all' || (filter === 'flagged' ? row.flags.length > 0 : row.approved))
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const shown = visible.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
  const canApprove = (row: Row) => Boolean(row.key && row.ward_number && row.person_name.trim())

  async function signOut() {
    await createBrowserSupabase().auth.signOut()
    router.replace('/admin/login')
    router.refresh()
  }

  async function extract() {
    const list = validateUploadList(files.map((f) => ({ name: f.name, size: f.size })))
    if (!list.ok) { setError(list.error); return }
    setBusy(true); setError(''); setRows([]); setReports([]); setImportResult(''); setPage(0)
    const supabase = createBrowserSupabase()
    const collected: Row[] = []
    const fileReports: FileReport[] = []
    try {
      setProgress('Preparing private upload…')
      const { uploads } = await call<{ uploads: { name: string; path: string; token: string }[] }>({ action: 'sign', files: list.files })
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        const upload = uploads[i]
        const notes: string[] = []
        try {
          setProgress(`File ${i + 1}/${files.length}: uploading ${file.name}…`)
          const { error: uploadError } = await supabase.storage.from(BUCKET).uploadToSignedUrl(upload.path, upload.token, file, { contentType: 'application/pdf' })
          if (uploadError) throw new Error('Upload failed.')
          const { info, ocrReady } = await call<{ info: Info; ocrReady: boolean }>({ action: 'info', path: upload.path, filename: file.name })
          if (!ocrReady) throw new Error('The text-recognition language files are missing from this deployment. Nothing was processed. Re-deploy with the assets/ocr folder included.')
          const results: PageResult[] = []
          for (let start = 1; start <= info.pages; start += PAGES_PER_CHUNK) {
            const pages = Array.from({ length: Math.min(PAGES_PER_CHUNK, info.pages - start + 1) }, (_, k) => start + k)
            setProgress(`File ${i + 1}/${files.length}: reading pages ${pages[0]}–${pages[pages.length - 1]} of ${info.pages}…`)
            const chunk = await call<{ results: PageResult[] }>({ action: 'extract', path: upload.path, filename: file.name, pages })
            results.push(...chunk.results)
          }
          let fileRows = results.flatMap((r) => r.rows)
          const cardPages = results.filter((r) => r.cards > 0)
          let wards = new Set(cardPages.map((r) => (r.wardText && r.wardOcr && r.wardText === r.wardOcr ? r.wardText : '?')))
          const serials = fileRows.map((r) => r.serial).filter((s): s is number => s !== null).sort((a, b) => a - b)
          const continuous = serials.length === fileRows.length && serials.every((s, k) => s === k + 1)
          const matchesTotal = info.summaryNumbers.includes(fileRows.length)

          if ((wards.size !== 1 || wards.has('?')) && info.filenameWard) {
            fileRows = fileRows.map((r) => {
              if (!r.ward_number) {
                return {
                  ...r,
                  ward_number: info.filenameWard!,
                  flags: r.flags.filter((f) => !f.includes('Ward number uncertain')),
                }
              }
              return r
            })
            wards = new Set([info.filenameWard])
            notes.push(`Ward number ${info.filenameWard} automatically applied from filename (${file.name}).`)
            setBatchWard(info.filenameWard)
          } else if (wards.size !== 1 || wards.has('?')) {
            notes.push('Notice: Ward number could not be confirmed uniformly across all pages. Please verify or set ward numbers.')
          }
          if (!continuous) {
            notes.push(`Notice: Serial numbers range from ${serials[0] ?? '?'} to ${serials[serials.length - 1] ?? '?'}, but are not strictly 1…N without gaps.`)
          }
          if (!matchesTotal) {
            notes.push(`Notice: Extracted ${fileRows.length} records. Please confirm this matches the voter count for this ward.`)
          }
          const docWard = wards.size === 1 ? [...wards][0] : ''
          if (info.filenameWard && docWard && info.filenameWard !== docWard) notes.push(`Filename suggests ward ${info.filenameWard} but the document says ${docWard}. The document value is used.`)
          if (!notes.length) notes.push(`Checks passed: ${fileRows.length} records, serials 1–${fileRows.length}, ward ${docWard} confirmed by two readings, count matches the summary page.`)
          fileReports.push({ name: file.name, pages: info.pages, cards: fileRows.length, notes })
          collected.push(...fileRows.map((r) => ({ ...r, approved: false })))
        } catch (cause) {
          fileReports.push({ name: file.name, pages: 0, cards: 0, notes: [cause instanceof Error ? cause.message : 'Could not process this file.'] })
        } finally {
          await call({ action: 'discard', path: upload.path }).catch(() => undefined)
        }
      }
      setRows(collected); setReports(fileReports); setFilter(collected.some((r) => r.flags.length) ? 'flagged' : 'all')
      setProgress('Extraction finished. Review the rows below; nothing has been imported.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Extraction failed.'); setProgress('')
    } finally {
      setBusy(false)
    }
  }

  function updateRow(index: number, patch: Partial<Pick<Row, 'person_name' | 'relative_name' | 'approved' | 'ward_number'>>) {
    setRows((current) => current.map((row, i) => {
      if (i !== index) return row
      const next = { ...row, ...patch }
      if ('ward_number' in patch) {
        if (next.ward_number.trim()) {
          next.flags = next.flags.filter((flag) => !flag.includes('Ward number uncertain'))
        } else if (!next.flags.some((f) => f.includes('Ward number uncertain'))) {
          next.flags.push('Ward number uncertain (header OCR and PDF digits disagree or are missing)')
        }
      }
      if ('person_name' in patch || 'relative_name' in patch) {
        const kept = next.flags.filter((flag) => !NAME_FLAG.test(flag))
        next.flags = [...nameFlags(next.person_name.trim(), 'person name'), ...(next.relative_name.trim() ? nameFlags(next.relative_name.trim(), 'relative name') : ['Missing relative name']), ...kept]
        next.approved = false
      }
      if (next.approved && !canApprove(next)) next.approved = false
      return next
    }))
  }

  function applyBatchWard(targetWard?: string) {
    const target = (targetWard ?? batchWard).trim()
    if (!target || !/^[1-9][0-9]{0,2}$/.test(target)) {
      setError('Please enter a valid ward number (1-999).')
      return
    }
    setError('')
    setRows((current) => current.map((row) => {
      const flags = row.flags.filter((f) => !f.includes('Ward number uncertain'))
      return { ...row, ward_number: target, flags }
    }))
  }

  function approveUnflagged() {
    setRows((current) => analyzeRows(current).map((row, i) => ({ ...current[i], approved: current[i].approved || (row.flags.length === 0 && canApprove(current[i])) })))
  }

  function approveAll() {
    setRows((current) => current.map((row) => ({ ...row, approved: canApprove(row) })))
  }

  function unapproveAll() {
    setRows((current) => current.map((row) => ({ ...row, approved: false })))
  }

  async function importApproved() {
    const approved = analyzed.filter((r) => r.approved)
    if (!approved.length) return
    if (!window.confirm(`Import ${approved.length} approved record(s) into the private staging table? Records are not public.`)) return
    setBusy(true); setError(''); setImportResult('')
    let inserted = 0, duplicates = 0
    const conflicts: string[] = []
    try {
      for (let start = 0; start < approved.length; start += 1000) {
        setProgress(`Importing ${Math.min(start + 1000, approved.length)} of ${approved.length}…`)
        const batch = approved.slice(start, start + 1000).map((r) => ({ source_record_key: r.key, person_name: r.person_name, relative_name: r.relative_name, ward_number: r.ward_number, source_filename: r.source_filename, source_page: r.source_page, serial_number: r.serial, approved: true }))
        const { result } = await call<{ result: { inserted: number; duplicates: number; conflicts: string[] } }>({ action: 'commit', rows: batch })
        inserted += result.inserted; duplicates += result.duplicates; conflicts.push(...result.conflicts)
      }
      setImportResult(`Imported ${inserted} new, ${duplicates} already present (unchanged), ${conflicts.length} conflicting with an existing key (skipped, not overwritten).`)
      setRows([]); setProgress('')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Import failed.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh bg-[#f7f8f4] px-5 py-8 text-[#1d302b] sm:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-[#1d302b] text-[#d9f04d]"><span className="text-lg font-black">W</span></div><div><p className="font-bold">Ward Finder</p><p className="text-xs text-[#728275]">Private administrator area · {adminEmail}</p></div></div>
          <button type="button" onClick={signOut} className="inline-flex items-center gap-2 rounded-xl border border-[#d7ded5] bg-white px-3 py-2 text-sm font-semibold"><LogOut className="size-4" />Sign out</button>
        </header>

        <section className="mt-10 max-w-3xl">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#728275]"><LockKeyhole className="size-4" /> Authenticated · private staging only</div>
          <h1 className="mt-4 text-4xl font-semibold tracking-[-0.05em]">Review ward PDFs</h1>
          <p className="mt-3 leading-7 text-[#64736c]">Upload ward check-list PDFs. Names are read from the page image and the ward number from the document itself. Only person name, relative name, ward, source file and page are kept. Nothing is imported until you approve rows.</p>
          <label className="mt-8 flex cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-[#bfcbbd] bg-white px-6 py-12 text-center"><UploadCloud className="size-8 text-[#809b15]" /><span className="mt-3 font-semibold">Choose up to 50 PDF files</span><span className="mt-1 text-sm text-[#7b8981]">25 MB per file, 250 MB per batch</span><input className="sr-only" type="file" accept="application/pdf,.pdf" multiple disabled={busy} onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
          {files.length > 0 && <p className="mt-3 text-sm text-[#64736c]">{files.length} file(s) selected</p>}
          <button type="button" disabled={!files.length || busy} onClick={extract} className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#1d302b] px-5 py-3 font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">{busy ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />}{busy ? 'Working…' : 'Preview extraction'}</button>
          {progress && <p className="mt-4 text-sm text-[#64736c]" aria-live="polite">{progress}</p>}
          {error && <div role="alert" className="mt-5 flex gap-2 rounded-xl border border-[#edcaca] bg-[#fff7f7] p-4 text-sm text-[#9b4b4b]"><AlertCircle className="size-4 shrink-0" />{error}</div>}
          {importResult && <div className="mt-5 flex gap-2 rounded-xl border border-[#cfe0b8] bg-white p-4 text-sm"><CheckCircle2 className="size-4 shrink-0 text-[#809b15]" />{importResult}</div>}
        </section>

        {reports.length > 0 && (
          <section className="mt-8 space-y-2">{reports.map((r) => <div key={r.name} className="rounded-xl border border-[#d7ded5] bg-white p-4 text-sm"><p className="font-semibold">{r.name} <span className="font-normal text-[#728275]">· {r.pages} pages · {r.cards} records</span></p>{r.notes.map((n) => <p key={n} className="mt-1 text-[#64736c]">{n}</p>)}</div>)}</section>
        )}

        {rows.length > 0 && (
          <section className="mt-8 rounded-2xl border border-[#d7ded5] bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-[#64736c]">{rows.length} records · {flaggedCount} flagged · <strong>{approvedCount} approved</strong></p>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {(['flagged', 'all', 'approved'] as Filter[]).map((f) => <button key={f} type="button" onClick={() => { setFilter(f); setPage(0) }} className={`rounded-lg border px-3 py-1.5 ${filter === f ? 'border-[#1d302b] bg-[#1d302b] text-white' : 'border-[#d7ded5]'}`}>{f}</button>)}
                <button type="button" onClick={approveUnflagged} className="rounded-lg border border-[#d7ded5] px-3 py-1.5 hover:bg-[#f7f8f4]">Approve all unflagged</button>
                <button type="button" onClick={approveAll} className="rounded-lg border border-[#809b15] bg-[#d9f04d] px-3 py-1.5 font-bold text-[#1d302b] shadow-xs hover:bg-[#cfe0b8]">Approve all ({rows.length})</button>
                {approvedCount > 0 && <button type="button" onClick={unapproveAll} className="rounded-lg border border-[#d7ded5] px-3 py-1.5 text-[#728275] hover:bg-[#f7f8f4]">Reset</button>}
                <div className="flex items-center gap-1.5 border-l border-[#d7ded5] pl-2">
                  <span className="text-xs font-semibold text-[#728275]">Ward:</span>
                  <input
                    type="text"
                    placeholder="7"
                    value={batchWard}
                    onChange={(e) => setBatchWard(e.target.value)}
                    className="w-14 rounded-lg border border-[#d7ded5] bg-white px-2 py-1 text-center font-bold text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => applyBatchWard()}
                    className="rounded-lg border border-[#d7ded5] bg-[#f7f8f4] px-2.5 py-1 text-xs font-semibold hover:bg-white"
                  >
                    Apply to all
                  </button>
                </div>
              </div>
            </div>

            {missingWardCount > 0 && (
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#f3d288] bg-[#fffbf0] p-4 text-sm text-[#875a0e]">
                <div className="flex items-center gap-2">
                  <AlertCircle className="size-5 shrink-0 text-[#c27803]" />
                  <span><strong>{missingWardCount} records</strong> have no ward number (uncertain from PDF header). Assign ward number to enable approval:</span>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="e.g. 7"
                    value={batchWard}
                    onChange={(e) => setBatchWard(e.target.value)}
                    className="w-20 rounded-lg border border-[#d6a543] bg-white px-2.5 py-1.5 text-center font-bold text-[#1d302b]"
                  />
                  <button
                    type="button"
                    onClick={() => applyBatchWard()}
                    className="rounded-lg bg-[#c27803] px-3.5 py-1.5 font-semibold text-white shadow-xs hover:bg-[#a56600]"
                  >
                    Assign Ward {batchWard || '...'} to all {rows.length} rows
                  </button>
                </div>
              </div>
            )}

            <p className="mt-3 rounded-xl bg-[#f7f8f4] p-3 text-xs text-[#64736c]">Compare each row with the original PDF page before approving. Flagged rows are never approved automatically; fix the text if needed, then tick the box yourself.</p>
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[820px] text-left text-sm">
                <thead><tr className="border-b text-xs uppercase tracking-wide text-[#728275]"><th className="p-2">OK</th><th className="p-2">#</th><th className="p-2">Name</th><th className="p-2">Relative</th><th className="p-2">Ward</th><th className="p-2">Page</th><th className="p-2">Flags</th></tr></thead>
                <tbody>
                  {shown.map(({ row, index }) => (
                    <tr key={`${row.source_filename}-${row.source_page}-${row.serial}-${index}`} className="border-b border-[#eef1eb] align-top">
                      <td className="p-2"><input type="checkbox" aria-label={`Approve record ${row.serial ?? index + 1}`} checked={row.approved} disabled={!canApprove(row)} onChange={(e) => updateRow(index, { approved: e.target.checked })} className="size-5" /></td>
                      <td className="p-2 tabular-nums">{row.serial ?? '—'}</td>
                      <td className="p-2"><input value={row.person_name} onChange={(e) => updateRow(index, { person_name: e.target.value })} className="w-full rounded-lg border border-[#e1e7df] px-2 py-1" /></td>
                      <td className="p-2"><input value={row.relative_name} onChange={(e) => updateRow(index, { relative_name: e.target.value })} className="w-full rounded-lg border border-[#e1e7df] px-2 py-1" /></td>
                      <td className="p-2 tabular-nums">
                        <input
                          value={row.ward_number}
                          placeholder="—"
                          onChange={(e) => updateRow(index, { ward_number: e.target.value })}
                          className="w-14 rounded-lg border border-[#e1e7df] px-1.5 py-1 text-center font-bold text-sm"
                        />
                      </td>
                      <td className="p-2 whitespace-nowrap">{row.source_page}</td>
                      <td className="p-2 text-xs text-[#9b4b4b]">{row.flags.map((f) => f.replace(/^[§‡]/, '')).join('; ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm">
                <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Prev</button>
                <span>{page + 1} / {pageCount}</span>
                <button type="button" disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)} className="rounded-lg border px-3 py-1.5 disabled:opacity-40">Next</button>
              </div>
              <button type="button" disabled={!approvedCount || busy} onClick={importApproved} className="rounded-xl bg-[#1d302b] px-5 py-3 font-semibold text-white disabled:opacity-50">
                Import {approvedCount} approved to private staging
              </button>
            </div>
          </section>
        )}
      </div>
    </main>
  )
}
                       
