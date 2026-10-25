'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertCircle, LockKeyhole } from 'lucide-react'
import { createBrowserSupabase } from '@/lib/supabase/browser'

export function AdminLogin({ notice }: { notice?: string }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(notice ?? '')
  const [busy, setBusy] = useState(false)
  const router = useRouter()

  async function signIn(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true); setError('')
    try {
      const { error: authError } = await createBrowserSupabase().auth.signInWithPassword({ email: email.trim(), password })
      if (authError) throw new Error('Sign-in failed. Check your email and password.')
      router.replace('/admin/import')
      router.refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.')
      setBusy(false)
    }
  }

  return (
    <main className="min-h-dvh bg-[#f7f8f4] px-5 py-8 text-[#1d302b] sm:px-8">
      <div className="mx-auto max-w-md">
        <header className="flex items-center gap-3"><div className="flex size-10 items-center justify-center rounded-xl bg-[#1d302b] text-[#d9f04d]"><span className="text-lg font-black">W</span></div><div><p className="font-bold">Ward Finder</p><p className="text-xs text-[#728275]">Private administrator area</p></div></header>
        <div className="mt-10 flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-[#728275]"><LockKeyhole className="size-4" /> Administrator sign-in</div>
        <h1 className="mt-4 text-3xl font-semibold tracking-[-0.05em]">Sign in</h1>
        <form onSubmit={signIn} className="mt-6 space-y-4">
          <label className="block text-sm font-semibold">Email<input type="email" required autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-[#d7ded5] bg-white px-3 py-3 font-normal" /></label>
          <label className="block text-sm font-semibold">Password<input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-[#d7ded5] bg-white px-3 py-3 font-normal" /></label>
          <button type="submit" disabled={busy} className="w-full rounded-xl bg-[#1d302b] px-5 py-3 font-semibold text-white disabled:opacity-50">{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        {error && <div role="alert" className="mt-5 flex gap-2 rounded-xl border border-[#edcaca] bg-[#fff7f7] p-4 text-sm text-[#9b4b4b]"><AlertCircle className="size-4 shrink-0" />{error}</div>}
      </div>
    </main>
  )
}
