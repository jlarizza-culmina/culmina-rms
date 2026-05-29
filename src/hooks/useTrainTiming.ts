// src/hooks/useTrainTiming.ts
// Hook for waitlist-aware train timing logic
// Used in WaitlistModule to coordinate table readiness with train arrivals

import { useState, useEffect, useCallback } from 'react'
import type { TrainArrival } from '@/app/api/mta/arrivals/route'

interface TrainTimingResult {
  nextInbound: TrainArrival | null       // next train leaving Darien (morning)
  nextOutbound: TrainArrival | null      // next train arriving from NYC (evening)
  allArrivals: TrainArrival[]
  loading: boolean
  error: string | null
  refresh: () => void
}

export function useTrainTiming(): TrainTimingResult {
  const [arrivals, setArrivals] = useState<TrainArrival[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/mta/arrivals?limit=10')
      const data = await res.json()
      if (!data.ok) throw new Error(data.error)
      setArrivals(data.arrivals)
      setError(null)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    const t = setInterval(load, 30_000)
    return () => clearInterval(t)
  }, [load])

  const nextInbound  = arrivals.find(a => a.direction === 'inbound')  ?? null
  const nextOutbound = arrivals.find(a => a.direction === 'outbound') ?? null

  return { nextInbound, nextOutbound, allArrivals: arrivals, loading, error, refresh: load }
}

// ── Utility: should we notify this guest now? ──────────────────
// Returns true if the table will be ready in time for the guest
// to grab a drink + walk to the train they need to catch.
export function shouldNotifyGuest(params: {
  tableReadyInMinutes: number    // estimated minutes until table is ready
  nextTrainMinutes: number | null // minutes until next inbound departure
  minDwellMinutes?: number        // min time guest should have at table (default 25)
  walkMinutes?: number            // walk to platform (default 2)
}): { notify: boolean; reason: string } {
  const { tableReadyInMinutes, nextTrainMinutes, minDwellMinutes = 25, walkMinutes = 2 } = params

  if (nextTrainMinutes === null) {
    return { notify: tableReadyInMinutes <= 5, reason: 'Table nearly ready' }
  }

  // Time guest needs to leave to catch train
  const leaveByMinutes = nextTrainMinutes - walkMinutes

  // Time between table ready and when they need to leave
  const availableDwellTime = leaveByMinutes - tableReadyInMinutes

  if (availableDwellTime >= minDwellMinutes) {
    // Enough dwell time before the train — notify as table becomes ready
    return {
      notify: tableReadyInMinutes <= 3,
      reason: `Table ready before the ${nextTrainMinutes - walkMinutes} min mark — ${availableDwellTime} min at table`,
    }
  }

  // Not enough time before this train — suggest waiting for next one
  return {
    notify: false,
    reason: `Only ${availableDwellTime} min before train — suggest waiting for next train`,
  }
}

// ── Utility: format train timing hint for host display ──────────
export function trainTimingHint(arrival: TrainArrival | null): string {
  if (!arrival) return ''
  const { minutesUntilArrival, arrivalTime, direction } = arrival
  if (minutesUntilArrival === null) return ''

  if (direction === 'outbound') {
    if (minutesUntilArrival <= 2) return `🚆 Train arriving NOW — guests walking in`
    if (minutesUntilArrival <= 8) return `🚆 Train in ${minutesUntilArrival} min — expect ${arrivalTime} walk-in rush`
    return `🚆 Next NYC arrival at ${arrivalTime} (${minutesUntilArrival} min)`
  }

  if (direction === 'inbound') {
    if (minutesUntilArrival <= 5) return `⚠️ Train to GCT in ${minutesUntilArrival} min — some guests may need to leave`
    return `🚆 Departure to GCT at ${arrivalTime} (${minutesUntilArrival} min)`
  }

  return ''
}
