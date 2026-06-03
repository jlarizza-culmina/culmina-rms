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
    const allStopIds = new Set<string>() // debug: collect every stop_id in the feed

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

    const DARIEN_STOP_IDS = new Set(['118','120','121','124'])

    for (const entity of feed.entity ?? []) {
      const tu = entity.tripUpdate
      if (!tu) continue

      const stopTimes = (tu.stopTimeUpdate ?? []) as any[]

      // Collect ALL stop IDs for debug
      for (const s of stopTimes) allStopIds.add(String(s.stopId ?? ''))

      // Find Darien-area stop
      const darienStu = stopTimes.find(s => DARIEN_STOP_IDS.has(String(s.stopId ?? '')))
      if (!darienStu) continue

      const arrTime = toNum(darienStu.arrival?.time) || toNum(darienStu.departure?.time)
      if (!arrTime || arrTime <= now - 120) continue

      const depTime  = toNum(darienStu.departure?.time) || arrTime
      const minsAway = Math.round((arrTime - now) / 60)

      // Direction: look at the terminal (last remaining stop in this trip).
      // Inbound trains end at GCT (stop_id "1"). Outbound end at New Haven area (high IDs).
      const lastStopId = parseInt(String(stopTimes[stopTimes.length - 1]?.stopId ?? '999'))
      const isInbound  = lastStopId <= 5

      trains.push({
        tripId:              String(tu.trip?.tripId  ?? ''),
        routeId:             String(tu.trip?.routeId ?? ''),
        stopId:              String(darienStu.stopId ?? ''),
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
      trains: trains.slice(0, 20),
      updatedAt: now,
      debug_total_stop_ids: allStopIds.size,
      debug_all_stop_ids: [...allStopIds].sort((a,b) => parseInt(a)-parseInt(b)),
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
