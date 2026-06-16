// src/app/api/weather/capture/route.ts
// Called by Vercel Cron 3x/day at 6am, 12pm, 6pm ET
// Uses Open-Meteo (free, no API key)

import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

// Darien Metro-North station coordinates
const DARIEN = {
  lat: 41.0765,
  lng: -73.4721,
  timezone: 'America/New_York',
}

// WMO weather code → human label
function wmoLabel(code: number): string {
  if (code === 0)          return 'Clear'
  if (code === 1)          return 'Mostly Clear'
  if (code === 2)          return 'Partly Cloudy'
  if (code === 3)          return 'Overcast'
  if (code <= 19)          return 'Fog / Mist'
  if (code <= 29)          return 'Drizzle'
  if (code <= 39)          return 'Fog'
  if (code <= 49)          return 'Drizzle'
  if (code <= 59)          return 'Rain'
  if (code <= 69)          return 'Snow'
  if (code <= 79)          return 'Ice Pellets'
  if (code <= 84)          return 'Rain Shower'
  if (code <= 94)          return 'Thunderstorm'
  return 'Thunderstorm'
}

// C to F conversion
function celsiusToF(c: number): number {
  return Math.round((c * 9/5 + 32) * 10) / 10
}

// mm to inches
function mmToIn(mm: number): number {
  return Math.round(mm / 25.4 * 1000) / 1000
}

// km/h to mph
function kphToMph(kph: number): number {
  return Math.round(kph * 0.621371 * 10) / 10
}

export async function GET(req: Request) {
  // Only enforce the cron secret for Vercel cron-triggered requests.
  const isVercelCron = req.headers.get('x-vercel-cron') === '1'
  const cronSecret = process.env.CRON_SECRET

  if (isVercelCron && cronSecret) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }
  // Manual browser/curl requests always pass through

  try {
    // Service-role client (bypasses RLS); resolve the location timezone first.
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
    const { data: locationData } = await supabase
      .from('locations')
      .select('timezone')
      .eq('id', process.env.NEXT_PUBLIC_LOCATION_ID)
      .maybeSingle()
    const tz = locationData?.timezone ?? 'America/New_York'

    // Fetch current conditions from Open-Meteo (current_weather + hourly for humidity)
    const params = new URLSearchParams({
      latitude:    String(DARIEN.lat),
      longitude:   String(DARIEN.lng),
      timezone:    tz,
      current_weather: 'true',
      hourly: 'relativehumidity_2m,apparent_temperature,precipitation,cloudcover,windgusts_10m',
      forecast_days: '1',
    })

    const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`)
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`)
    const data = await res.json()

    // Current weather (always present)
    const cw = data.current_weather
    const tempF       = celsiusToF(cw.temperature)
    const windMph     = kphToMph(cw.windspeed)
    const weatherCode = cw.weathercode

    // Find the hourly index closest to now
    const nowISO = cw.time // e.g. "2027-03-15T14:00"
    const hourlyTimes: string[] = data.hourly.time
    const idx = hourlyTimes.findIndex(t => t === nowISO)
    const hi = idx >= 0 ? idx : 0

    const hourly = data.hourly
    const apparentF  = celsiusToF(hourly.apparent_temperature[hi])
    const precipIn   = mmToIn(hourly.precipitation[hi])
    const humidity   = hourly.relativehumidity_2m[hi]

    // Get the restaurant_id for Corretto
    const restaurantId = process.env.RESTAURANT_ID ?? null

    // Capture slot from the location's local hour.
    const localHour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hour12: false,
      }).format(new Date()),
      10
    )
    const capture_slot = localHour < 10 ? 'morning'
      : localHour < 15 ? 'noon'
      : 'evening'

    const capture = {
      restaurant_id: restaurantId,
      location_id:   process.env.NEXT_PUBLIC_LOCATION_ID ?? null,
      observed_at:   new Date().toISOString(),
      temp_f:        tempF,
      temp_c:        Math.round(((tempF - 32) * 5 / 9) * 10) / 10,
      feels_like_f:  apparentF,
      humidity:      humidity,
      wind_mph:      windMph,
      precipitation: precipIn,
      weather_code:  weatherCode,
      condition:     wmoLabel(weatherCode),
      capture_slot,
    }

    // Weather observations are append-only — keep every capture as a new row.
    const { error } = await supabase
      .from('weather_observations')
      .insert(capture)

    if (error) {
      console.error('Supabase error:', JSON.stringify(error))
      throw error
    }

    return NextResponse.json({
      ok: true,
      captured: {
        slot:        capture.capture_slot,
        temp:        `${tempF}°F`,
        feels_like:  `${apparentF}°F`,
        condition:   capture.condition,
        precip:      `${precipIn}"`,
        wind:        `${windMph} mph`,
        humidity:    `${humidity}%`,
      }
    })

  } catch (err) {
    const message = err instanceof Error
      ? err.message
      : JSON.stringify(err)
    console.error('Weather capture error:', message)
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
