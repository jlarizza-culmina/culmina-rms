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

    const DARIEN_STOP_IDS = new Set(['166']) // Darien station GTFS stop_id

    for (const entity of feed.entity ?? []) {
      const tu = entity.tripUpdate
      if (!tu) continue

      // Collect ALL stop IDs for debug
      for (const s of tu.stopTimeUpdate ?? []) {
        allStopIds.add(String((s as any).stopId ?? ''))
      }

      // Find Darien stop in this trip
      const darienStu = (tu.stopTimeUpdate ?? []).find(
        (s: any) => DARIEN_STOP_IDS.has(String(s.stopId ?? ''))
      )
      if (!darienStu) continue

      const arrTime = toNum((darienStu as any).arrival?.time) || toNum((darienStu as any).departure?.time)
      if (!arrTime || arrTime <= now - 120) continue

      const depTime  = toNum((darienStu as any).departure?.time) || arrTime
      const minsAway = Math.round((arrTime - now) / 60)

      // MTA Metro-North direction_id:
      // 1 = Northbound → away from NYC (toward New Haven) = outbound
      // 2 = Southbound → toward Grand Central = inbound
      const dirId     = toNum(tu.trip?.directionId)
      const isInbound = dirId === 2   // southbound toward GCT

      trains.push({
        tripId:              String(tu.trip?.tripId    ?? ''),
        routeId:             String(tu.trip?.routeId   ?? ''),
        stopId:              '166',
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
