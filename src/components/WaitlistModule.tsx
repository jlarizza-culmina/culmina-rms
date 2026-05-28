'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { WaitlistSession, Guest, Location, LocationWaitlistSettings } from '@/lib/types'

interface Props {
  userId: string
  restaurantId?: string
  locations: Location[]
}

type HostTab = 'queue' | 'guests'

const STATUS_STYLES: Record<string, { badge: string; row: string }> = {
  waiting:  { badge: 'bg-blue-50 text-blue-700 border-blue-200',   row: '' },
  notified: { badge: 'bg-amber-50 text-amber-700 border-amber-200', row: 'bg-amber-50/30' },
  seated:   { badge: 'bg-green-50 text-green-700 border-green-200', row: 'opacity-50' },
  no_show:  { badge: 'bg-red-50 text-red-500 border-red-200',       row: 'opacity-40' },
  cancelled:{ badge: 'bg-gray-50 text-gray-400 border-gray-200',    row: 'opacity-30' },
}

function waitTime(joinedAt: string): string {
  const mins = Math.floor((Date.now() - new Date(joinedAt).getTime()) / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m`
  return `${Math.floor(mins/60)}h ${mins%60}m`
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export default function WaitlistModule({ userId, restaurantId, locations }: Props) {
  const supabase = createClient()
  const [tab,        setTab]       = useState<HostTab>('queue')
  const [locationId, setLocationId]= useState(locations[0]?.id ?? '')
  const [sessions,   setSessions]  = useState<WaitlistSession[]>([])
  const [guests,     setGuests]    = useState<Guest[]>([])
  const [settings,   setSettings]  = useState<LocationWaitlistSettings | null>(null)
  const [loading,    setLoading]   = useState(true)
  const [acting,     setActing]    = useState<string | null>(null)
  const [guestSearch,setGuestSearch]=useState('')

  // Load sessions for current location
  const loadSessions = useCallback(async () => {
    if (!locationId) return
    const { data } = await supabase
      .from('waitlist_sessions')
      .select('*')
      .eq('location_id', locationId)
      .in('status', ['waiting','notified'])
      .order('joined_at', { ascending: true })
    setSessions(data ?? [])
  }, [locationId, supabase])

  // Load all guests for restaurant
  const loadGuests = useCallback(async () => {
    if (!restaurantId) return
    const { data } = await supabase
      .from('guests')
      .select('*')
      .eq('restaurant_id', restaurantId)
      .order('last_visit_date', { ascending: false })
    setGuests(data ?? [])
  }, [restaurantId, supabase])

  const loadSettings = useCallback(async () => {
    if (!locationId) return
    const { data } = await supabase
      .from('location_waitlist_settings')
      .select('*')
      .eq('location_id', locationId)
      .single()
    setSettings(data)
  }, [locationId, supabase])

  useEffect(() => {
    async function init() {
      setLoading(true)
      await Promise.all([loadSessions(), loadGuests(), loadSettings()])
      setLoading(false)
    }
    init()
  }, [locationId])

  // Realtime subscription
  useEffect(() => {
    if (!locationId) return
    const channel = supabase
      .channel(`waitlist-${locationId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'waitlist_sessions',
        filter: `location_id=eq.${locationId}`,
      }, () => { loadSessions() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [locationId, loadSessions, supabase])

  async function doAction(sessionId: string, action: string) {
    setActing(sessionId + action)
    try {
      await fetch('/api/waitlist/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, action }),
      })
      await loadSessions()
    } finally {
      setActing(null)
    }
  }

  const waiting  = sessions.filter(s => s.status === 'waiting')
  const notified = sessions.filter(s => s.status === 'notified')
  const totalCovers = waiting.reduce((s, x) => s + x.party_size, 0)

  const filteredGuests = guests.filter(g =>
    !guestSearch || [g.first_name, g.last_name, g.phone, g.email].some(
      v => v?.toLowerCase().includes(guestSearch.toLowerCase())
    )
  )

  const location = locations.find(l => l.id === locationId)
  const baseUrl  = typeof window !== 'undefined' ? window.location.origin : ''
  const joinUrl  = `${baseUrl}/join/${locationId}`

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-serif text-xl font-medium text-[--text]">Queue</h1>
          {locations.length > 1 && (
            <select value={locationId} onChange={e => setLocationId(e.target.value)}
              className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none">
              {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          )}
        </div>
        <div className="flex gap-0.5">
          {(['queue','guests'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-2 text-xs font-medium rounded-md capitalize transition-colors ${tab === t ? 'bg-[--accent-light] text-[--accent]' : 'text-[--muted] hover:bg-[--surface-2]'}`}>
              {t === 'queue' ? `Live Queue (${waiting.length + notified.length})` : `Guests (${guests.length})`}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── Live queue ── */}
        {tab === 'queue' && (
          <div className="px-6 py-4">

            {/* Stats row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-white rounded-xl border border-[--border] p-3 text-center">
                <div className="text-2xl font-medium text-[--text]">{waiting.length}</div>
                <div className="text-[10px] text-[--muted] mt-0.5">Waiting</div>
              </div>
              <div className="bg-white rounded-xl border border-[--border] p-3 text-center">
                <div className="text-2xl font-medium text-amber-600">{notified.length}</div>
                <div className="text-[10px] text-[--muted] mt-0.5">Notified</div>
              </div>
              <div className="bg-white rounded-xl border border-[--border] p-3 text-center">
                <div className="text-2xl font-medium text-[--text]">{totalCovers}</div>
                <div className="text-[10px] text-[--muted] mt-0.5">Covers waiting</div>
              </div>
            </div>

            {/* QR code + join link */}
            <div className="bg-white rounded-xl border border-[--border] p-4 mb-4 flex items-center gap-4">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=72x72&data=${encodeURIComponent(joinUrl)}`}
                alt="QR code" className="w-18 h-18 rounded-lg flex-shrink-0"
                width={72} height={72} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-[--text] mb-0.5">Guest join link</div>
                <div className="text-[10px] text-[--muted] truncate font-mono">{joinUrl}</div>
                <div className="flex gap-2 mt-2">
                  <button onClick={() => navigator.clipboard.writeText(joinUrl)}
                    className="text-[10px] px-2 py-1 border border-[--border-2] rounded text-[--muted] hover:text-[--accent] hover:border-[--accent] transition-colors">
                    Copy link
                  </button>
                  <a href={`https://api.qrserver.com/v1/create-qr-code/?size=600x600&data=${encodeURIComponent(joinUrl)}`}
                    download={`qr-${location?.name ?? 'waitlist'}.png`} target="_blank" rel="noopener noreferrer"
                    className="text-[10px] px-2 py-1 border border-[--border-2] rounded text-[--muted] hover:text-[--accent] hover:border-[--accent] transition-colors">
                    Download QR
                  </a>
                </div>
              </div>
            </div>

            {/* Session cards */}
            {loading ? (
              <div className="text-center py-10 text-[--muted] text-sm">Loading queue…</div>
            ) : sessions.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3 opacity-20">🪑</div>
                <p className="text-sm text-[--muted]">Queue is empty.</p>
                <p className="text-xs text-[--hint] mt-1">Share the QR code or join link with guests.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {sessions.map((s, i) => {
                  const style = STATUS_STYLES[s.status]
                  const isActing = acting !== null && acting?.startsWith(s.id)
                  return (
                    <div key={s.id} className={`bg-white rounded-xl border border-[--border] p-4 transition-opacity ${style.row}`}>
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          {/* Position number */}
                          <div className="w-7 h-7 rounded-full bg-[--surface-2] flex items-center justify-center text-xs font-medium text-[--muted] flex-shrink-0 mt-0.5">
                            {s.status === 'waiting' ? i + 1 : '·'}
                          </div>
                          <div>
                            <div className="text-sm font-medium text-[--text]">{s.guest_name}</div>
                            <div className="text-[11px] text-[--muted] mt-0.5 flex items-center gap-2">
                              <span>Party of {s.party_size}</span>
                              <span>·</span>
                              <span>{waitTime(s.joined_at)}</span>
                              <span>·</span>
                              <span className="font-mono">{s.phone}</span>
                            </div>
                          </div>
                        </div>
                        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border flex-shrink-0 capitalize ${style.badge}`}>
                          {s.status}
                        </span>
                      </div>

                      {/* Actions */}
                      {(s.status === 'waiting' || s.status === 'notified') && (
                        <div className="flex gap-2 mt-3 pt-3 border-t border-[--border]">
                          {s.status === 'waiting' && (
                            <button onClick={() => doAction(s.id, 'notify')} disabled={!!isActing}
                              className="flex-1 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50 transition-colors">
                              {acting === s.id + 'notify' ? 'Texting…' : '📱 Notify'}
                            </button>
                          )}
                          {s.status === 'notified' && (
                            <button onClick={() => doAction(s.id, 'notify')} disabled={!!isActing}
                              className="flex-1 py-1.5 text-xs font-medium border border-[--accent] text-[--accent] rounded-lg hover:bg-[--accent-light] disabled:opacity-50 transition-colors">
                              Re-notify
                            </button>
                          )}
                          <button onClick={() => doAction(s.id, 'seat')} disabled={!!isActing}
                            className="flex-1 py-1.5 text-xs font-medium bg-[--green] text-white rounded-lg hover:opacity-90 disabled:opacity-50 transition-colors">
                            ✓ Seated
                          </button>
                          <button onClick={() => doAction(s.id, 'no_show')} disabled={!!isActing}
                            className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-black disabled:opacity-50 transition-colors">
                            No-show
                          </button>
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── Guest database ── */}
        {tab === 'guests' && (
          <div className="px-6 py-4">
            <div className="flex gap-2 mb-4">
              <input value={guestSearch} onChange={e => setGuestSearch(e.target.value)}
                placeholder="Search by name, phone, email…"
                className="flex-1 px-3 py-1.5 text-xs border border-[--border-2] rounded-lg outline-none focus:border-[--accent]" />
            </div>

            {filteredGuests.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3 opacity-20">👥</div>
                <p className="text-sm text-[--muted]">{guestSearch ? 'No guests match your search.' : 'No guests yet — they appear when people join the waitlist.'}</p>
              </div>
            ) : (
              <div className="space-y-2">
                {filteredGuests.map(g => (
                  <div key={g.id} className="bg-white rounded-xl border border-[--border] p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="text-sm font-medium text-[--text]">
                          {g.first_name} {g.last_name}
                          {g.birthday_month && (
                            <span className="ml-1.5 text-[10px] text-[--accent]">
                              🎂 {MONTHS[g.birthday_month - 1]}{g.birthday_day ? ` ${g.birthday_day}` : ''}
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[--muted] mt-0.5 space-x-2">
                          <span>{g.phone}</span>
                          {g.email && <span>· {g.email}</span>}
                        </div>
                        <div className="flex gap-2 mt-1.5 flex-wrap">
                          <span className="text-[10px] bg-[--surface-2] px-1.5 py-0.5 rounded text-[--muted]">
                            {g.visit_count} visit{g.visit_count !== 1 ? 's' : ''}
                          </span>
                          <span className="text-[10px] bg-[--surface-2] px-1.5 py-0.5 rounded text-[--muted]">
                            Last: {new Date(g.last_visit_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                          </span>
                          {g.sms_opt_in   && <span className="text-[10px] bg-green-50 px-1.5 py-0.5 rounded text-green-600">SMS ✓</span>}
                          {g.email_opt_in && <span className="text-[10px] bg-green-50 px-1.5 py-0.5 rounded text-green-600">Email ✓</span>}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
