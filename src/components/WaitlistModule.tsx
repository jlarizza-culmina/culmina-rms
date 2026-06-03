'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import type { WaitlistSession, Guest, Location, LocationWaitlistSettings } from '@/lib/types'
import TrainBoard from './TrainBoard'

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

  // Sort state for the table
  const [sortKey, setSortKey] = useState<'position'|'party_size'|'mins_away'>('position')
  const [sortDir, setSortDir] = useState<'asc'|'desc'>('asc')

  function toggleSort(key: typeof sortKey) {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Format arrival time
  function fmtArrival(iso: string | null | undefined): { time: string; mins: number } | null {
    if (!iso) return null
    const d = new Date(iso)
    const h = d.getHours() % 12 || 12
    const m = String(d.getMinutes()).padStart(2,'0')
    const ap = d.getHours() >= 12 ? 'PM' : 'AM'
    const mins = Math.round((d.getTime() - Date.now()) / 60000)
    return { time: `${h}:${m} ${ap}`, mins }
  }

  // Group active sessions by arrival train for the train summary
  const active = sessions.filter(s => s.status === 'waiting' || s.status === 'notified')

  const trainSummary = (() => {
    const groups: Record<string, { time: string; mode: string; waiting: number; notified: number; covers: number }> = {}
    for (const s of active) {
      const arr = fmtArrival(s.estimated_arrival_at)
      const key = arr ? arr.time : 'walk-in'
      if (!groups[key]) groups[key] = { time: arr?.time ?? 'Walk-in', mode: s.arrival_mode ?? 'other', waiting: 0, notified: 0, covers: 0 }
      if (s.status === 'waiting')  groups[key].waiting++
      if (s.status === 'notified') groups[key].notified++
      groups[key].covers += s.party_size
    }
    return Object.values(groups).sort((a, b) => a.time.localeCompare(b.time))
  })()

  // Sorted + indexed sessions for table
  const sortedSessions = [...active].sort((a, b) => {
    const aArr = fmtArrival(a.estimated_arrival_at)
    const bArr = fmtArrival(b.estimated_arrival_at)
    const aPos = sessions.filter(s => s.status === 'waiting').indexOf(a) + 1
    const bPos = sessions.filter(s => s.status === 'waiting').indexOf(b) + 1
    let cmp = 0
    if (sortKey === 'position')  cmp = aPos - bPos
    if (sortKey === 'party_size') cmp = a.party_size - b.party_size
    if (sortKey === 'mins_away')  cmp = (aArr?.mins ?? 999) - (bArr?.mins ?? 999)
    return sortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">

      {/* Header */}
      <div className="bg-white border-b border-[--border] px-6 py-4 flex-shrink-0">
        <div className="flex items-center justify-between mb-3">
          <h1 className="font-serif text-xl font-medium text-[--text]">Queue</h1>
          <div className="flex items-center gap-3">
            <TrainBoard compact />
            {locations.length > 1 && (
              <select value={locationId} onChange={e => setLocationId(e.target.value)}
                className="text-xs border border-[--border-2] rounded-lg px-2.5 py-1.5 bg-white outline-none">
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
          </div>
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

            {/* Train arrivals */}
            <div className="mb-4">
              <TrainBoard limit={10} />
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

            {/* Train arrival summary */}
            {trainSummary.length > 0 && (
              <div className="bg-white rounded-xl border border-[--border] mb-4 overflow-hidden">
                <div className="bg-[--surface-2] px-4 py-2 border-b border-[--border] grid grid-cols-5 gap-2">
                  {['Arrival','Direction','Waiting','Notified','Covers'].map(h => (
                    <div key={h} className="text-[10px] font-semibold uppercase tracking-wide text-[--hint]">{h}</div>
                  ))}
                </div>
                {trainSummary.map(t => (
                  <div key={t.time} className="grid grid-cols-5 gap-2 px-4 py-2.5 border-b border-[--border] last:border-0 text-xs">
                    <div className="font-medium text-[--text]">{t.time}</div>
                    <div className="text-[--muted]">
                      {t.mode === 'inbound' ? '🚆→NYC' : t.mode === 'outbound' ? '🚆→NH' : '🚶 Walk-in'}
                    </div>
                    <div className="text-[--text]">{t.waiting > 0 ? <span className="font-medium">{t.waiting}</span> : <span className="text-[--hint]">—</span>}</div>
                    <div className="text-amber-600">{t.notified > 0 ? <span className="font-medium">{t.notified}</span> : <span className="text-[--hint]">—</span>}</div>
                    <div className="font-medium text-[--accent]">{t.covers}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Queue table */}
            {loading ? (
              <div className="text-center py-10 text-[--muted] text-sm">Loading queue…</div>
            ) : active.length === 0 ? (
              <div className="text-center py-12">
                <div className="text-4xl mb-3 opacity-20">🪑</div>
                <p className="text-sm text-[--muted]">Queue is empty.</p>
                <p className="text-xs text-[--hint] mt-1">Share the QR code or join link with guests.</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
                {/* Table header */}
                <div className="bg-[--surface-2] border-b border-[--border] grid text-[10px] font-semibold uppercase tracking-wide text-[--hint]"
                  style={{ gridTemplateColumns: '40px 1fr 110px 80px 90px 90px 100px 110px 32px 32px 80px' }}>
                  {[
                    { key: 'position',   label: '#' },
                    { key: null,         label: 'Name' },
                    { key: null,         label: 'Phone' },
                    { key: 'party_size', label: 'Party' },
                    { key: null,         label: 'Direction' },
                    { key: null,         label: 'Train' },
                    { key: 'mins_away',  label: 'ETA' },
                    { key: null,         label: 'In queue' },
                    { key: null,         label: '' },
                    { key: null,         label: '' },
                    { key: null,         label: '' },
                  ].map((col, i) => (
                    <div key={i} className={`px-2 py-2.5 ${col.key ? 'cursor-pointer hover:text-[--text] select-none' : ''} flex items-center gap-0.5`}
                      onClick={() => col.key && toggleSort(col.key as any)}>
                      {col.label}
                      {col.key && sortKey === col.key && <span className="text-[--accent]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
                    </div>
                  ))}
                </div>

                {/* Table rows */}
                {sortedSessions.map((s, i) => {
                  const arr     = fmtArrival(s.estimated_arrival_at)
                  const isActing = acting !== null && acting?.startsWith(s.id)
                  const pos = sessions.filter(x => x.status === 'waiting').indexOf(s) + 1
                  const urgentColor = arr
                    ? arr.mins <= 5  ? 'text-red-500'
                    : arr.mins <= 15 ? 'text-amber-500'
                    : 'text-[--accent]'
                    : 'text-[--muted]'
                  return (
                    <div key={s.id}
                      className={`grid border-b border-[--border] last:border-0 items-center text-xs hover:bg-[--surface-2]/50 transition-colors ${s.status === 'notified' ? 'bg-amber-50/40' : ''}`}
                      style={{ gridTemplateColumns: '40px 1fr 110px 80px 90px 90px 100px 110px 32px 32px 80px' }}>

                      {/* # */}
                      <div className="px-2 py-2.5">
                        <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-semibold ${s.status === 'waiting' ? 'bg-[--surface-2] text-[--muted]' : 'bg-amber-100 text-amber-600'}`}>
                          {s.status === 'waiting' ? pos || i+1 : '!'}
                        </div>
                      </div>

                      {/* Name */}
                      <div className="px-2 py-2.5 min-w-0">
                        <div className="font-medium text-[--text] truncate">{s.guest_name}</div>
                        {s.birthday_month && (
                          <span className="text-[9px] text-[--accent]">🎂 {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][s.birthday_month-1]}{s.birthday_day ? ` ${s.birthday_day}` : ''}</span>
                        )}
                      </div>

                      {/* Phone */}
                      <div className="px-2 py-2.5 font-mono text-[--muted] text-[11px] truncate">{s.phone}</div>

                      {/* Party */}
                      <div className="px-2 py-2.5 text-center">
                        <span className="inline-flex items-center justify-center w-6 h-6 rounded-full bg-[--accent-light] text-[--accent] text-[11px] font-semibold">{s.party_size}</span>
                      </div>

                      {/* Direction */}
                      <div className="px-2 py-2.5 text-[11px] text-[--muted]">
                        {s.arrival_mode === 'inbound' ? '🚆 →NYC' : s.arrival_mode === 'outbound' ? '🚆 →NH' : '🚶'}
                      </div>

                      {/* Train time */}
                      <div className={`px-2 py-2.5 text-[11px] font-medium ${urgentColor}`}>
                        {arr ? arr.time : '—'}
                      </div>

                      {/* ETA mins */}
                      <div className={`px-2 py-2.5 text-[11px] font-semibold ${urgentColor}`}>
                        {arr
                          ? arr.mins <= 0 ? 'Arriving' : `${arr.mins} min`
                          : '—'}
                      </div>

                      {/* In queue */}
                      <div className="px-2 py-2.5 text-[11px] text-[--hint]">{waitTime(s.joined_at)}</div>

                      {/* Notify / Re-notify */}
                      <div className="py-2.5 px-0.5">
                        {(s.status === 'waiting' || s.status === 'notified') && (
                          <button onClick={() => doAction(s.id, 'notify')} disabled={!!isActing}
                            title={s.status === 'notified' ? 'Re-notify' : 'Notify'}
                            className={`w-7 h-7 rounded-lg flex items-center justify-center text-sm transition-colors ${s.status === 'waiting' ? 'bg-[--accent] text-white hover:bg-[--accent-dark]' : 'border border-[--accent] text-[--accent] hover:bg-[--accent-light]'} disabled:opacity-40`}>
                            {acting === s.id+'notify' ? '…' : '📱'}
                          </button>
                        )}
                      </div>

                      {/* Seat */}
                      <div className="py-2.5 px-0.5">
                        {(s.status === 'waiting' || s.status === 'notified') && (
                          <button onClick={() => doAction(s.id, 'seat')} disabled={!!isActing}
                            title="Seat party"
                            className="w-7 h-7 rounded-lg bg-[--green] text-white flex items-center justify-center text-sm hover:opacity-90 disabled:opacity-40">
                            {acting === s.id+'seat' ? '…' : '✓'}
                          </button>
                        )}
                      </div>

                      {/* No-show */}
                      <div className="px-2 py-2.5">
                        {(s.status === 'waiting' || s.status === 'notified') && (
                          <button onClick={() => doAction(s.id, 'no_show')} disabled={!!isActing}
                            className="text-[10px] px-2 py-1 bg-gray-900 text-white rounded-lg hover:bg-black disabled:opacity-40">
                            No-show
                          </button>
                        )}
                      </div>
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
