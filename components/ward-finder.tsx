'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertCircle, ArrowRight, CheckCircle2, CircleHelp, Filter, Loader2, Search, ShieldCheck, X } from 'lucide-react'

type Result = {
  id: string
  name: string
  relativeName: string | null
  wardNumber: string
  serialNumber: number | null
}

type SearchState = 'idle' | 'loading' | 'success' | 'empty' | 'error'

export function WardFinder() {
  const [query, setQuery] = useState('')
  const [selectedWard, setSelectedWard] = useState('all')
  const [availableWards, setAvailableWards] = useState<string[]>([])
  const [results, setResults] = useState<Result[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [hasMore, setHasMore] = useState(false)
  const [isDualSearch, setIsDualSearch] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [isSampleMode, setIsSampleMode] = useState(false)
  const [state, setState] = useState<SearchState>('idle')
  const [error, setError] = useState('')
  const requestId = useRef(0)

  // Fetch published wards on mount to populate the dropdown without loading records
  useEffect(() => {
    fetch('/api/wards')
      .then((res) => (res.ok ? res.json() : { wards: [] }))
      .then((data) => {
        if (Array.isArray(data.wards) && data.wards.length > 0) {
          setAvailableWards(data.wards)
        }
      })
      .catch(() => undefined)
  }, [])

  useEffect(() => {
    const value = query.trim()
    if (!value) return

    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      const id = ++requestId.current
      setState('loading')
      setCurrentPage(1)
      let didTimeout = false
      try {
        const timeoutId = window.setTimeout(() => {
          didTimeout = true
          controller.abort()
        }, 12000)
        const wardParam = selectedWard !== 'all' ? `&ward=${encodeURIComponent(selectedWard)}` : ''
        const response = await fetch(`/api/search?q=${encodeURIComponent(value)}${wardParam}&page=1`, {
          cache: 'no-store',
          signal: controller.signal,
        })
        window.clearTimeout(timeoutId)
        if (!response.ok) throw new Error('Search unavailable')
        const data = (await response.json()) as {
          results?: Result[]
          total?: number
          hasMore?: boolean
          isDualSearch?: boolean
          sample?: boolean
        }
        if (id !== requestId.current) return
        const nextResults = data.results ?? []
        setResults(nextResults)
        setTotalCount(typeof data.total === 'number' ? data.total : nextResults.length)
        setHasMore(Boolean(data.hasMore))
        setIsDualSearch(Boolean(data.isDualSearch))
        if (typeof data.sample === 'boolean') {
          setIsSampleMode(data.sample)
        }
        setState(nextResults.length ? 'success' : 'empty')
      } catch (err: unknown) {
        if (id !== requestId.current) return
        if (err instanceof DOMException && err.name === 'AbortError') {
          if (!didTimeout) return
          setState('error')
          setError('Search took too long to respond. Please try again.')
          return
        }
        setState('error')
        setError('We could not complete that search. Please try again.')
      }
    }, 300)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [query, selectedWard])

  async function loadMore() {
    if (loadingMore || !hasMore || !query.trim()) return
    const nextPage = currentPage + 1
    setLoadingMore(true)
    try {
      const wardParam = selectedWard !== 'all' ? `&ward=${encodeURIComponent(selectedWard)}` : ''
      const response = await fetch(
        `/api/search?q=${encodeURIComponent(query.trim())}${wardParam}&page=${nextPage}`,
        { cache: 'no-store' }
      )
      if (!response.ok) throw new Error('Failed to load more results')
      const data = (await response.json()) as {
        results?: Result[]
        total?: number
        hasMore?: boolean
        isDualSearch?: boolean
        sample?: boolean
      }
      const newItems = data.results ?? []
      setResults((prev) => [...prev, ...newItems])
      setCurrentPage(nextPage)
      setHasMore(Boolean(data.hasMore))
      if (typeof data.isDualSearch === 'boolean') {
        setIsDualSearch(data.isDualSearch)
      }
      if (typeof data.total === 'number') {
        setTotalCount(data.total)
      }
      if (typeof data.sample === 'boolean') {
        setIsSampleMode(data.sample)
      }
    } catch {
      // Keep existing results intact if load more encounters a temporary network glitch
    } finally {
      setLoadingMore(false)
    }
  }

  function resetSearch() {
    requestId.current++
    setResults([])
    setTotalCount(null)
    setCurrentPage(1)
    setHasMore(false)
    setIsDualSearch(false)
    setIsSampleMode(false)
    setState('idle')
    setError('')
  }

  function updateQuery(value: string) {
    setQuery(value)
    if (!value.trim()) resetSearch()
  }

  function clearSearch() {
    setQuery('')
    resetSearch()
  }

  return (
    <main className="min-h-dvh overflow-hidden bg-[#f7f8f4] text-[#1d302b]">
      <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col px-5 py-5 sm:px-8 sm:py-8">
        <header className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-xl bg-[#1d302b] text-[#d9f04d] shadow-xs">
              <span className="text-lg font-black">W</span>
            </div>
            <span className="text-sm font-bold tracking-[-0.02em]">Ward Finder</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs font-medium text-[#6c7b74]">
              <ShieldCheck className="size-4" /> Private by design
            </div>
          </div>
        </header>

        <section className="flex flex-1 flex-col justify-center py-14 sm:py-20">
          <div className="max-w-3xl">
            <p className="mb-5 text-xs font-bold uppercase tracking-[0.22em] text-[#728275]">Electoral ward lookup</p>
            <h1 className="max-w-2xl text-[clamp(2.7rem,10vw,5.8rem)] font-semibold leading-[0.94] tracking-[-0.07em]">
              Find your ward, <span className="text-[#809b15]">simply.</span>
            </h1>
            <p className="mt-6 max-w-xl text-base leading-7 text-[#64736c] sm:text-lg">
              Search a person&apos;s name or relative&apos;s name to find the corresponding electoral ward.
            </p>

            <div className="mt-9 max-w-2xl space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                {/* Search Bar */}
                <div className="flex flex-1 items-center rounded-2xl border border-[#d7ded5] bg-white p-2 shadow-[0_12px_35px_-22px_rgba(29,48,43,0.45)] transition focus-within:border-[#9aad38] focus-within:ring-4 focus-within:ring-[#d9f04d]/30">
                  <Search className="ml-3 size-5 shrink-0 text-[#819087]" aria-hidden="true" />
                  <input
                    id="ward-search"
                    value={query}
                    onChange={(event) => updateQuery(event.target.value)}
                    placeholder="Search name or 'Name, Relative' (e.g. Ramesh, Mukesh)"
                    autoComplete="off"
                    className="min-w-0 flex-1 bg-transparent px-3 py-3 text-base outline-none placeholder:text-[#a5b0a9]"
                  />
                  {query && (
                    <button
                      type="button"
                      onClick={clearSearch}
                      aria-label="Clear search"
                      className="rounded-full p-2 text-[#87958e] hover:bg-[#eef2ec] hover:text-[#1d302b]"
                    >
                      <X className="size-4" />
                    </button>
                  )}
                  <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#d9f04d] text-[#1d302b]">
                    <ArrowRight className="size-5" aria-hidden="true" />
                  </div>
                </div>

                {/* Ward Filter Dropdown */}
                <div className="flex items-center gap-2 rounded-2xl border border-[#d7ded5] bg-white px-3.5 py-3 shadow-[0_12px_35px_-22px_rgba(29,48,43,0.45)] transition focus-within:border-[#9aad38] focus-within:ring-4 focus-within:ring-[#d9f04d]/30 sm:w-auto">
                  <Filter className="size-4 shrink-0 text-[#819087]" aria-hidden="true" />
                  <label htmlFor="ward-filter" className="sr-only">
                    Filter by Ward
                  </label>
                  <select
                    id="ward-filter"
                    value={selectedWard}
                    onChange={(e) => setSelectedWard(e.target.value)}
                    aria-label="Select electoral ward"
                    className="cursor-pointer bg-transparent text-sm font-semibold text-[#1d302b] outline-none"
                  >
                    <option value="all">All Wards</option>
                    {availableWards.map((ward) => (
                      <option key={ward} value={ward}>
                        Ward {ward}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <p className="flex items-center gap-2 text-xs text-[#85918a]">
                <CircleHelp className="size-3.5" /> Type single name (e.g. Ramesh) or dual &quot;Name, Relative&quot; (e.g. Ramesh, Mukesh / रमेश, मुकेश)
              </p>
            </div>
          </div>

          <div aria-live="polite" className="mt-12 max-w-2xl">
            {state === 'idle' && (
              <div className="rounded-2xl border border-dashed border-[#cbd5ca] px-5 py-6 text-sm text-[#7b8981]">
                Enter a name above or type &quot;Name, Relative&quot; to see matching wards.
              </div>
            )}
            {state === 'loading' && (
              <div className="flex items-center gap-3 rounded-2xl bg-white px-5 py-5 text-sm text-[#66766e]">
                <Loader2 className="size-4 animate-spin" /> Searching ward records…
              </div>
            )}
            {state === 'error' && (
              <div role="alert" className="flex items-center gap-3 rounded-2xl border border-[#edcaca] bg-[#fff7f7] px-5 py-5 text-sm text-[#9b4b4b]">
                <AlertCircle className="size-4" /> {error}
              </div>
            )}
            {state === 'empty' && (
              <div className="rounded-2xl border border-[#d7ded5] bg-white px-5 py-6">
                <p className="font-semibold">No matching ward found</p>
                <p className="mt-1 text-sm leading-6 text-[#728078]">
                  Check the spelling or try searching just the person&apos;s first name. {selectedWard !== 'all' ? `Results are currently filtered to Ward ${selectedWard}.` : 'No ward is shown unless a reliable match exists.'}
                </p>
              </div>
            )}
            {state === 'success' && (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      {totalCount !== null && totalCount > results.length
                        ? `Showing ${results.length} of ${totalCount} matches`
                        : `${results.length} ${results.length === 1 ? 'match' : 'matches'} found`}
                      {selectedWard !== 'all' ? ` in Ward ${selectedWard}` : ' across all wards'}
                    </p>
                    {isDualSearch && (
                      <span className="inline-flex items-center rounded-md bg-[#eef4d4] px-2 py-0.5 text-xs font-semibold text-[#5a6f0f]">
                        Exact Name + Relative Match
                      </span>
                    )}
                  </div>
                  <CheckCircle2 className="size-4 text-[#809b15]" />
                </div>
                <div className="flex flex-col gap-3">
                  {results.map((result) => (
                    <article
                      key={result.id}
                      className="flex items-center justify-between gap-4 rounded-2xl border border-[#e1e6df] bg-white px-5 py-4 shadow-[0_8px_25px_-22px_rgba(29,48,43,0.5)]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="truncate font-semibold">{result.name}</p>
                          {result.serialNumber !== null && (
                            <span className="inline-flex shrink-0 items-center rounded-md bg-[#eef2ec] px-2 py-0.5 text-xs font-semibold text-[#40523e]">
                              Serial #{result.serialNumber}
                            </span>
                          )}
                        </div>
                        {result.relativeName && (
                          <p className="mt-1 truncate text-sm text-[#7a8980]">
                            Relative: {result.relativeName}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#91a097]">Ward</p>
                        <p className="text-2xl font-semibold tracking-[-0.04em] text-[#809b15]">{result.wardNumber}</p>
                      </div>
                    </article>
                  ))}
                </div>

                {/* Load More / Next Page Controls */}
                {hasMore && (
                  <div className="mt-5 flex flex-col items-center gap-2">
                    <button
                      type="button"
                      onClick={loadMore}
                      disabled={loadingMore}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#d7ded5] bg-white px-5 py-3.5 text-sm font-semibold text-[#1d302b] shadow-xs transition hover:border-[#9aad38] hover:bg-[#f1f5ee] active:scale-[0.99] disabled:opacity-60"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="size-4 animate-spin text-[#809b15]" />
                          <span>Loading more results…</span>
                        </>
                      ) : (
                        <>
                          <span>Load Next Results</span>
                          {totalCount !== null && totalCount > results.length && (
                            <span className="rounded-full bg-[#eef2ec] px-2 py-0.5 text-xs font-bold text-[#40523e]">
                              +{totalCount - results.length} remaining
                            </span>
                          )}
                        </>
                      )}
                    </button>
                    <p className="text-xs text-[#85918a]">
                      Showing {results.length} of {totalCount ?? 'more'} records
                    </p>
                  </div>
                )}

                {!hasMore && results.length > 20 && (
                  <div className="mt-5 text-center text-xs font-medium text-[#85918a]">
                    All {results.length} matching records loaded
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        <footer className="flex flex-col gap-2 border-t border-[#e0e6de] pt-5 text-xs leading-5 text-[#89958d] sm:flex-row sm:items-center sm:justify-between">
          <p>Results are limited to name, relative name, serial number, and ward number.</p>
          {isSampleMode && <p>Sample mode uses fictional records only.</p>}
        </footer>
      </div>
    </main>
  )
}
