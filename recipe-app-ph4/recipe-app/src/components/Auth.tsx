'use client'
import { useState } from 'react'
import { createClient } from '@/lib/supabase'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const supabase = createClient()

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim()) return
    setLoading(true)
    setError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/` },
    })
    setLoading(false)
    if (error) setError(error.message)
    else setSent(true)
  }

  return (
    <div className="h-screen flex items-center justify-center bg-[--bg]">
      <div className="bg-white rounded-2xl p-8 w-full max-w-sm shadow-sm border border-[--border]">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">📖</div>
          <h1 className="font-serif text-2xl font-medium text-[--text]">Recipe Manager</h1>
          <p className="text-sm text-[--muted] mt-1">Your AI-powered personal cookbook</p>
        </div>

        {sent ? (
          <div className="text-center">
            <div className="text-3xl mb-3">✉️</div>
            <p className="font-medium text-[--text] mb-1">Check your email</p>
            <p className="text-sm text-[--muted]">
              We sent a magic link to <strong>{email}</strong>.<br />
              Click it to sign in — no password needed.
            </p>
            <button
              onClick={() => setSent(false)}
              className="mt-4 text-xs text-[--muted] underline"
            >
              Use a different email
            </button>
          </div>
        ) : (
          <form onSubmit={handleLogin} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-[--muted] mb-1.5">Email address</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                className="w-full px-3 py-2.5 rounded-lg border border-[--border-2] text-sm bg-white text-[--text] outline-none focus:border-[--accent] transition-colors"
              />
            </div>
            {error && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-[--accent] text-white rounded-lg text-sm font-medium hover:bg-[--accent-dark] transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading ? <><span className="spinner" />Sending…</> : 'Send magic link →'}
            </button>
            <p className="text-xs text-center text-[--hint]">No password required. We&apos;ll email you a link.</p>
          </form>
        )}
      </div>
    </div>
  )
}
