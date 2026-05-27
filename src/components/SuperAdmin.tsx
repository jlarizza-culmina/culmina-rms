'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import type { Restaurant } from '@/lib/types'

interface Props {
  onBack: () => void
}

export default function SuperAdmin({ onBack }: Props) {
  const supabase = createClient()
  const [restaurants, setRestaurants] = useState<Restaurant[]>([])
  const [loading,     setLoading]     = useState(true)
  const [search,      setSearch]      = useState('')

  useEffect(() => {
    async function load() {
      setLoading(true)
      const { data } = await supabase
        .from('restaurants')
        .select('*')
        .order('created_at', { ascending: false })
      setRestaurants(data ?? [])
      setLoading(false)
    }
    load()
  }, [])

  const filtered = restaurants.filter(r =>
    r.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-lg bg-red-100 flex items-center justify-center text-sm">🛡</div>
          <div>
            <h1 className="font-serif text-lg font-medium text-[--text]">Super Admin</h1>
            <p className="text-[11px] text-[--muted]">Manage all CulminaRMS clients</p>
          </div>
        </div>
        <div className="flex gap-2">
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search clients…"
            className="flex-1 px-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]"
          />
          <button className="px-3 py-1.5 bg-[--accent] text-white text-xs rounded-lg hover:bg-[--accent-dark]">
            + New Client
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3 px-6 py-4 bg-[--surface-2] border-b border-[--border]">
        {[
          { label: 'Total clients', value: String(restaurants.length) },
          { label: 'Active',        value: String(restaurants.filter(r => r.is_active).length) },
          { label: 'This month',    value: String(restaurants.filter(r => {
            const d = new Date(r.created_at ?? '')
            const now = new Date()
            return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear()
          }).length) },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl p-3 border border-[--border] text-center">
            <div className="text-lg font-medium text-[--text]">{s.value}</div>
            <div className="text-[10px] text-[--muted]">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Client list */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {loading ? (
          <div className="text-center py-12 text-[--hint] text-sm">Loading clients…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-[--muted]">
            <div className="text-4xl opacity-20 mb-3">🏢</div>
            <p className="text-sm">No clients yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {filtered.map(r => (
              <div key={r.id} className="flex items-center gap-4 p-4 bg-white rounded-xl border border-[--border] group hover:border-[--border-2] transition-colors">
                <div className="w-9 h-9 rounded-xl flex-shrink-0 flex items-center justify-center font-bold text-sm text-white"
                  style={{ background: r.branding?.primaryColor ?? 'var(--accent)' }}>
                  {r.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[--text]">{r.name}</div>
                  <div className="text-[11px] text-[--muted] mt-0.5">
                    {r.cuisine_type && <span className="mr-2">{r.cuisine_type}</span>}
                    <span className="capitalize">{r.dish_mode} mode</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${r.is_active ? 'bg-green-50 text-[--green]' : 'bg-[--surface-2] text-[--hint]'}`}>
                    {r.is_active ? 'Active' : 'Inactive'}
                  </span>
                  <span className="text-[10px] text-[--hint]">
                    {r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}
                  </span>
                  <button className="opacity-0 group-hover:opacity-100 text-xs px-3 py-1 border border-[--border-2] rounded-lg text-[--muted] hover:text-[--text] transition-all">
                    Manage →
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer note */}
      <div className="px-6 py-3 border-t border-[--border] bg-[--surface-2]">
        <p className="text-[10px] text-[--hint] text-center">
          Super Admin access — CulminaRMS internal use only
        </p>
      </div>
    </div>
  )
}
