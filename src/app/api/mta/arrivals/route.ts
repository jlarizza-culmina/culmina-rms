// src/app/api/mta/arrivals/route.ts
// Live Metro-North arrivals at Darien (stop 122)
// No API key required — MTA removed requirement
// Feed: https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr

import { NextResponse } from 'next/server'
import GtfsRealtimeBindings from 'gtfs-realtime-bindings'

const MNR_FEED = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr'

// Stop IDs — Darien and neighbors
const DARIEN_PARENT  = '122'
const DARIEN_INBOUND  = '122_I'   // toward Grand Central Terminal (morning commute)
const DARIEN_OUTBOUND = '122_E'   // toward New Haven (evening — guests arriving from NYC)
const ALL_DARIEN      = new Set([DARIEN_PARENT, DARIEN_INBOUND, DARIEN_OUTBOUND])

// Walk time from platform to bar (it's in the station building)
const WALK_MINUTES = 2

export interface TrainArrival {
  tripId: string
  routeId: string
  stopId: string
  direction: 'inbound' | 'outbound' | 'unknown'
  arrivalEpoch: number | null
  departureEpoch: number | null
  arrivalTime: string | null       // "6:14 PM"
  departureTime: string | null
  minutesUntilArrival: number | null
  isOnTime: boolean
  scheduleRelationship: string
  isNextTrain: boolean
}

function schedRelLabel(code: number): string {
  switch (code) {
    case 0: return 'scheduled'
    case 1: return 'added'
    case 2: return 'unscheduled'
    case 3: return 'cancelled'
    case 5: return 'replaced'
    default: return 'unknown'
  }
}

function direction(stopId: string): 'inbound' | 'outbound' | 'unknown' {
  if (stopId === DARIEN_INBOUND)  return 'inbound'
  if (stopId === DARIEN_OUTBOUND) return 'outbound'
  return 'unknown'
}

function toET(epoch: number): string {
  return new Date(epoch * 1000).toLocaleTimeString('en-US', {
    timeZone: 'America/New_York',
    hour: '2-digit',
    minute: '2-digit',
  })
}

// Cache the feed for 30 seconds to avoid hammering the endpoint
let cache: { data: TrainArrival[]; fetchedAt: number } | null = null
const CACHE_TTL = 30 * 1000

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const dir = searchParams.get('direction') as 'inbound' | 'outbound' | null
  const limit = parseInt(searchParams.get('limit') ?? '5')

  try {
    const now = Date.now()
    let arrivals: TrainArrival[]

    if (cache && now - cache.fetchedAt < CACHE_TTL) {
      arrivals = cache.data
    } else {
      const res = await fetch(MNR_FEED, {
        headers: { 'Accept': 'application/x-protobuf' },
        next: { revalidate: 30 },
      })
      if (!res.ok) throw new Error(`MTA feed HTTP ${res.status}`)

      const buffer = await res.arrayBuffer()
      const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
        new Uint8Array(buffer)
      )

      const nowSec = Math.floor(now / 1000)
      arrivals = []

      for (const entity of feed.entity) {
        const tu = entity.tripUpdate
        if (!tu) continue

        const routeId = tu.trip?.routeId ?? 'MNR'
        const tripId  = tu.trip?.tripId  ?? ''

        for (const stu of tu.stopTimeUpdate ?? []) {
          if (!ALL_DARIEN.has(stu.stopId ?? '')) continue

          // Convert Long objects if needed (gtfs-realtime-bindings quirk)
          const rawArrival    = stu.arrival?.time
          const rawDeparture  = stu.departure?.time
          const arrivalEpoch  = rawArrival  ? Number(rawArrival)  : null
          const departureEpoch = rawDeparture ? Number(rawDeparture) : null

          // Only show upcoming trains (arriving in the next 90 minutes)
          const epochForSorting = arrivalEpoch ?? departureEpoch
          if (!epochForSorting || epochForSorting < nowSec || epochForSorting > nowSec + 90 * 60) continue

          const minutesUntil = epochForSorting
            ? Math.round((epochForSorting - nowSec) / 60)
            : null

          arrivals.push({
            tripId,
            routeId,
            stopId:    stu.stopId ?? DARIEN_PARENT,
            direction: direction(stu.stopId ?? ''),
            arrivalEpoch,
            departureEpoch,
            arrivalTime:    arrivalEpoch    ? toET(arrivalEpoch)    : null,
            departureTime:  departureEpoch  ? toET(departureEpoch)  : null,
            minutesUntilArrival: minutesUntil,
            isOnTime:      (stu.scheduleRelationship ?? 0) === 0,
            scheduleRelationship: schedRelLabel(stu.scheduleRelationship ?? 0),
            isNextTrain:   false, // set below
          })
        }
      }

      // Sort by soonest arrival
      arrivals.sort((a, b) => (a.arrivalEpoch ?? 0) - (b.arrivalEpoch ?? 0))
      if (arrivals.length > 0) arrivals[0].isNextTrain = true

      cache = { data: arrivals, fetchedAt: now }
    }

    // Filter by direction if requested
    const filtered = dir
      ? arrivals.filter(a => a.direction === dir || a.direction === 'unknown')
      : arrivals

    // Add walk-from-station note to each
    const result = filtered.slice(0, limit).map(a => ({
      ...a,
      tableReadyWindowMinutes: (a.minutesUntilArrival ?? 0) + WALK_MINUTES,
    }))

    return NextResponse.json({
      ok: true,
      station:    'Darien',
      stop_id:    DARIEN_PARENT,
      feed_url:   MNR_FEED,
      as_of:      new Date().toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' }),
      count:      result.length,
      walk_minutes: WALK_MINUTES,
      arrivals:   result,
    })

  } catch (err) {
    console.error('[mta/arrivals]', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
