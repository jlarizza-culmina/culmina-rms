// src/components/TrainBoard.tsx
// Live Darien Metro-North arrivals — used in WaitlistModule and host view
// Shows next inbound/outbound trains with minutes-to-arrival

'use client'
import { useState, useEffect, useCallback } from 'react'
import type { TrainArrival } from '@/app/api/mta/arrivals/route'

interface Props {
  direction?: 'inbound' | 'outbound'   // omit for both
  limit?: number
  compact?: boolean                     // pill mode for header
  onNextTrainMinutes?: (min: number | null) => void  // for waitlist logic
}

const DIR_LABELS = {
  inbound:  'toward Grand Central',
  outbound: 'from Grand Central (arriving)',
  unknown:  '',
}

const DIR_ICONS = {
  inbound:  '🚆↗',
  outbound: '🚆↙',
  unknown:  '🚆',
}

function MinutesBadge({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="text-[--hint]">—</span>
  if (minutes <= 2)  return <span className="text-red-600 font-bold text-xs">NOW</span>
  if (minutes <= 5)  return <span className="text-orange-500 font-semibold text-xs">{minutes} min</span>
  if (minutes <= 15) return <span className="text-amber-600 font-medium text-xs">{minutes} min</span>
  return <span className="text-[--muted] text-xs">{minutes} min</span>
}

export default function TrainBoard({ direction, limit = 4, compact = false, onNextTrainMinutes }: Props) {
  const [arrivals, setArrivals] = useState<TrainArrival[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [asOf,     setAsOf]     = useState<string>('')

  const load = useCallback(async () => {
    try {
      const params = new URLSearchParams({ limit: String(limit) })
      if (direction) params.set('direction', direction)
      const res = await fetch(`/api/mta/arrivals?${params}`)
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setArrivals(data.arrivals)
      setAsOf(data.as_of)
      setError(null)
      // Notify parent of next train ETA
      const next = data.arrivals.find((a: TrainArrival) => a.isNextTrain)
      onNextTrainMinutes?.(next?.minutesUntilArrival ?? null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [direction, limit, onNextTrainMinutes])

  useEffect(() => {
    load()
    const interval = setInterval(load, 30_000)  // refresh every 30s
    return () => clearInterval(interval)
  }, [load])

  // ── Compact mode: just a pill ──
  if (compact) {
    if (loading || arrivals.length === 0) return null
    const next = arrivals[0]
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-[--muted]" title={`Next train: ${next.arrivalTime}`}>
        <span>🚆</span>
        <MinutesBadge minutes={next.minutesUntilArrival} />
      </div>
    )
  }

  // ── Full board ──
  return (
    <div className="rounded-xl border border-[--border] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-[--surface-2] border-b border-[--border]">
        <div className="flex items-center gap-2">
          <span className="text-sm">🚆</span>
          <span className="text-[10px] font-semibold uppercase tracking-wide text-[--hint]">
            Darien Station
            {direction && <span className="ml-1 font-normal">{DIR_LABELS[direction]}</span>}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {asOf && <span className="text-[9px] text-[--hint]">Updated {asOf}</span>}
          <button onClick={load} className="text-[--hint] hover:text-[--accent] text-[10px]">↻</button>
        </div>
      </div>

      {/* Body */}
      {loading ? (
        <div className="py-6 text-center text-[11px] text-[--hint]">Loading train data…</div>
      ) : error ? (
        <div className="py-4 px-3 text-[11px] text-red-500">
          Could not load train data: {error}
        </div>
      ) : arrivals.length === 0 ? (
        <div className="py-6 text-center text-[11px] text-[--hint]">
          No trains in the next 90 minutes
        </div>
      ) : (
        <div className="divide-y divide-[--border]">
          {arrivals.map((a, i) => (
            <div key={a.tripId + a.stopId}
              className={`flex items-center px-3 py-2.5 gap-3 ${a.isNextTrain ? 'bg-amber-50' : ''}`}>
              {/* Direction icon */}
              <span className="text-base flex-shrink-0">{DIR_ICONS[a.direction]}</span>

              {/* Time */}
              <div className="flex-shrink-0 w-16 text-xs font-medium text-[--text]">
                {a.arrivalTime ?? a.departureTime ?? '—'}
              </div>

              {/* Countdown */}
              <div className="flex-shrink-0 w-14">
                <MinutesBadge minutes={a.minutesUntilArrival} />
              </div>

              {/* Route / status */}
              <div className="flex-1 min-w-0">
                <div className="text-[11px] text-[--muted] truncate">
                  {a.direction === 'outbound' ? 'from NYC arriving' : 'departing to GCT'}
                  {!a.isOnTime && (
                    <span className="ml-1.5 text-orange-500 text-[9px]">{a.scheduleRelationship}</span>
                  )}
                </div>
              </div>

              {/* Next train badge */}
              {a.isNextTrain && (
                <span className="flex-shrink-0 text-[9px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-semibold">
                  NEXT
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Footer: walk time note */}
      <div className="px-3 py-1.5 bg-[--surface-2] border-t border-[--border]">
        <span className="text-[9px] text-[--hint]">2 min walk from platform · Live MTA data</span>
      </div>
    </div>
  )
}
