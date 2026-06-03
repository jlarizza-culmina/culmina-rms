// src/app/api/mta/arrivals/route.ts
// Metro-North GTFS-RT feed for Darien station (stop 122)

import { NextResponse } from 'next/server'

export interface TrainArrival {
  tripId: string
  routeId: string
  stopId: string
  arrivalTime: number
  departureTime: number
  minsAway: number
  minutesUntilArrival: number   // alias for minsAway — used by useTrainTiming
  direction: 'inbound' | 'outbound'
  status: string
}

const MNR_FEED = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/mnr%2Fgtfs-mnr'

export async function GET() {
  try {
    const res = await fetch(MNR_FEED, {
      headers: { 'x-api-key': process.env.MTA_API_KEY ?? '' },
      next: { revalidate: 30 },
    })

    if (!res.ok) {
      return NextResponse.json({ error: `MTA HTTP ${res.status}` }, { status: 503 })
    }

    const buffer = await res.arrayBuffer()
    const bytes  = new Uint8Array(buffer)

    // Validate: protobuf GTFS-RT messages start with 0x0A (field 1, wire type 2)
    // If first byte is 0x3C ('<') it's HTML, 0x7B ('{') it's JSON — both mean an error page
    if (bytes.length === 0 || bytes[0] === 0x3C || bytes[0] === 0x7B) {
      const preview = new TextDecoder().decode(buffer.slice(0, 200))
      return NextResponse.json({ error: 'MTA returned non-protobuf data', preview }, { status: 503 })
    }

    // Parse using gtfs-realtime-bindings
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const GtfsRealtimeBindings = require('gtfs-realtime-bindings')
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      Buffer.from(buffer)
    )

    const now    = Math.floor(Date.now() / 1000)
    const trains: TrainArrival[] = []
    const debugStops: Record<string, number[]> = {} // stopId -> [arrivalTimes]

    // Safely convert protobuf Long or number to JS number
    function toNum(val: any): number {
      if (!val) return 0
      if (typeof val === 'number') return val
      if (typeof val === 'object' && val !== null) {
        if (typeof val.toNumber === 'function') return val.toNumber()
        if ('low' in val) return val.low + val.high * 0x100000000
      }
      return Number(val)
    }

    const DARIEN_STOPS = new Set([118, 120, 121, 124])

    for (const entity of feed.entity ?? []) {
      const tu = entity.tripUpdate
      if (!tu) continue

      // Sort all stops in this trip by sequence
      const allStops = (tu.stopTimeUpdate ?? [])
        .map((s: any) => ({
          stopId: parseInt(String(s.stopId ?? '0')),
          seq:    toNum(s.stopSequence),
          stu:    s,
        }))
        .sort((a: any, b: any) => a.seq - b.seq)

      // Find a Darien-area stop in this trip
      const darienIdx = allStops.findIndex((s: any) => DARIEN_STOPS.has(s.stopId))
      if (darienIdx === -1) continue

      const darienEntry = allStops[darienIdx]
      const stu      = darienEntry.stu
      const arrTime  = toNum(stu.arrival?.time) || toNum(stu.departure?.time)
      if (!arrTime || arrTime <= now - 120) continue

      const depTime  = toNum(stu.departure?.time) || arrTime
      const minsAway = Math.round((arrTime - now) / 60)
      const stopId   = String(darienEntry.stopId)

      // Debug collect
      if (darienEntry.stopId >= 110 && darienEntry.stopId <= 130) {
        if (!debugStops[stopId]) debugStops[stopId] = []
        debugStops[stopId].push(arrTime)
      }

      // MTA Metro-North direction_id convention (per MTA developer docs):
      // 0 or 2 = Southbound → toward Grand Central = inbound
      // 1      = Northbound → toward New Haven/Stamford = outbound
      const dirId     = toNum(tu.trip?.directionId)
      const isInbound = dirId === 0 || dirId === 2

      trains.push({
        tripId:              tu.trip?.tripId    ?? '',
        routeId:             tu.trip?.routeId   ?? '',
        stopId,
        arrivalTime:         arrTime,
        departureTime:       depTime,
        minsAway,
        minutesUntilArrival: minsAway,
        direction:           isInbound ? 'inbound' : 'outbound',
        status:              minsAway <= 0 ? 'arriving' : 'on time',
      })
    }

    trains.sort((a, b) => a.arrivalTime - b.arrivalTime)

    return NextResponse.json({
      trains: trains.slice(0, 10),
      updatedAt: now,
      debug_stops_110_130: Object.fromEntries(
        Object.entries(debugStops)
          .sort(([a],[b]) => parseInt(a)-parseInt(b))
          .map(([id, times]) => [id, times.sort().slice(0,3).map(t => {
            const d = new Date(t*1000)
            return `${d.getHours()}:${String(d.getMinutes()).padStart(2,'0')}`
          })])
      ),
    })

  } catch (err: any) {
    console.error('[mta/arrivals]', err?.message ?? err)
    // Return a graceful empty response rather than crashing the UI
    return NextResponse.json({
      trains: [],
      updatedAt: Math.floor(Date.now() / 1000),
      error: err?.message ?? String(err),
    })
  }
}
