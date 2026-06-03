'use client'
import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase'
import Auth from '@/components/Auth'
import AppShell from '@/components/AppShell'

export const dynamic = 'force-dynamic'

export default function Page() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const supabase = createClient()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user ?? null))
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setUser(session?.user ?? null)
    })
    return () => subscription.unsubscribe()
  }, [])

  if (user === undefined) {
    return (
      <div className="h-screen flex items-center justify-center bg-[--bg]">
        <div className="spinner" style={{ borderTopColor: 'var(--accent)', borderColor: 'var(--border-2)' }} />
      </div>
    )
  }

  if (!user) return <Auth />
  return <AppShell user={user} />
}
