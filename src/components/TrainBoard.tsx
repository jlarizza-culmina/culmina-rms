'use client'
// src/components/TrainBoard.tsx
// Metro-North train arrivals for Darien station

import { useState, useEffect } from 'react'

interface Train {
  tripId: string
  routeId: string
  stopId: string
  arrivalTime: number
  departureTime: number
  minsAway: number
  direction: 'inbound' | 'outbound'
  status: string
}

interface Props {
  compact?: boolean
  direction?: 'inbound' | 'outbound' | 'both'
  limit?: number
}

function formatTime(unixSec: number): string {
  const d = new Date(unixSec * 1000)
  const h = d.getHours() % 12 || 12
  const m = String(d.getMinutes()).padStart(2, '0')
  const ap = d.getHours() >= 12 ? 'PM' : 'AM'
  return `${h}:${m} ${ap}`
}

export default function TrainBoard({ compact = false, direction = 'both', limit = 6 }: Props) {
  const [trains,  setTrains]  = useState<Train[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [updated, setUpdated] = useState<number | null>(null)

  async function fetchTrains() {
    try {
      const res  = await fetch('/api/mta/arrivals', { cache: 'no-store' })
      const data = await res.json()
      if (data.error && !data.trains?.length) {
        setError(data.error)
      } else {
        setError(null)
        setTrains(data.trains ?? [])
        setUpdated(data.updatedAt ?? null)
      }
    } catch (e: any) {
      setError(e.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchTrains()
    const interval = setInterval(fetchTrains, 30_000)
    return () => clearInterval(interval)
  }, [])

  const visible = trains
    .filter(t => direction === 'both' || t.direction === direction)
    .slice(0, limit)

  // ── Compact pill mode ─────────────────────────────────────────
  if (compact) {
    if (loading) return (
      <div className="flex items-center gap-1.5 text-[10px] text-[--hint]">
        <span className="w-1.5 h-1.5 rounded-full bg-[--hint] animate-pulse" />
        Loading train data…
      </div>
    )
    if (error || !visible.length) return (
      <div className="text-[10px] text-[--hint]">🚂 No train data</div>
    )
    return (
      <div className="flex flex-wrap gap-1.5 items-center">
        {visible.slice(0, 3).map((t, i) => (
          <span key={i} className={`inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-full font-medium border ${
            t.minsAway <= 2
              ? 'bg-red-50 text-red-600 border-red-200'
              : t.minsAway <= 5
              ? 'bg-amber-50 text-amber-600 border-amber-200'
              : 'bg-[--surface-2] text-[--muted] border-[--border]'
          }`}>
            🚆 {t.minsAway <= 0 ? 'Now' : `${t.minsAway}m`}
            <span className="opacity-60">{t.direction === 'inbound' ? '↑NYC' : '↓CT'}</span>
          </span>
        ))}
        <span className="text-[9px] text-[--hint]">Live MTA</span>
      </div>
    )
  }

  // ── Full board mode ───────────────────────────────────────────
  return (
    <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-[--border] bg-[--surface-2]">
        <div className="flex items-center gap-2">
          <span className="text-sm">🚆</span>
          <span className="text-xs font-medium text-[--text]">Darien — Metro-North</span>
        </div>
        <div className="flex items-center gap-2">
          {updated && (
            <span className="text-[9px] text-[--hint]">
              Updated {formatTime(updated)}
            </span>
          )}
          <button onClick={fetchTrains}
            className="text-[9px] text-[--accent] hover:underline">
            Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div className="px-4 py-6 text-center text-xs text-[--hint]">Loading train data…</div>
      ) : error ? (
        <div className="px-4 py-4 text-center">
          <div className="text-xs text-red-500 mb-1">Could not load train data</div>
          <div className="text-[10px] text-[--hint] truncate max-w-xs mx-auto">{error}</div>
          <button onClick={fetchTrains}
            className="mt-2 text-[11px] text-[--accent] hover:underline">
            Try again
          </button>
        </div>
      ) : visible.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-[--muted]">No upcoming trains</div>
      ) : (
        <div className="divide-y divide-[--border]">
          {visible.map((t, i) => (
            <div key={i} className="flex items-center px-4 py-2.5 gap-3">
              {/* Status dot */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                t.minsAway <= 2 ? 'bg-red-400'
                : t.minsAway <= 5 ? 'bg-amber-400'
                : 'bg-green-400'
              }`} />

              {/* Time */}
              <div className="w-16 text-xs font-medium text-[--text] flex-shrink-0">
                {formatTime(t.arrivalTime)}
              </div>

              {/* Mins away */}
              <div className={`w-14 text-xs font-semibold flex-shrink-0 ${
                t.minsAway <= 2 ? 'text-red-500'
                : t.minsAway <= 5 ? 'text-amber-500'
                : 'text-[--accent]'
              }`}>
                {t.minsAway <= 0 ? 'Now' : `${t.minsAway} min`}
              </div>

              {/* Direction */}
              <div className="flex-1 text-xs text-[--muted]">
                {t.direction === 'inbound' ? '↑ toward New York' : '↓ toward New Haven'}
              </div>

              {/* Status badge */}
              {t.status !== 'on time' && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-[--surface-2] text-[--hint] capitalize">
                  {t.status}
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="px-4 py-1.5 border-t border-[--border] text-[9px] text-[--hint]">
        2 min walk from platform · Live MTA data
      </div>
    </div>
  )
}
