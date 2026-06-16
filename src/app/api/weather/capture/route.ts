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

function isPrecipitation(code: number): boolean {
  return code >= 20 && code !== 3
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

// Determine which capture hour (6, 12, 18) we're closest to
function captureHour(): 6 | 12 | 18 {
  const now = new Date()
  const etHour = parseInt(
    now.toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: 'America/New_York' })
  )
  if (etHour < 9)  return 6
  if (etHour < 15) return 12
  return 18
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
    // Fetch current conditions from Open-Meteo (current_weather + hourly for humidity/cloud)
    const params = new URLSearchParams({
      latitude:    String(DARIEN.lat),
      longitude:   String(DARIEN.lng),
      timezone:    DARIEN.timezone,
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
    const cloudCover = hourly.cloudcover[hi]
    const gustMph    = kphToMph(hourly.windgusts_10m[hi])

    // Write to Supabase using service role (bypasses RLS)
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )

    // Get the restaurant_id for Corretto (using the known restaurant_id)
    const restaurantId = process.env.RESTAURANT_ID ?? null
    const locationId   = process.env.LOCATION_ID ?? null

    const capture = {
      restaurant_id:   restaurantId,
      location_id:     locationId,
      capture_hour:    captureHour(),
      temperature_f:   tempF,
      apparent_temp_f: apparentF,
      precipitation_in: precipIn,
      wind_speed_mph:  windMph,
      wind_gust_mph:   gustMph,
      humidity_pct:    humidity,
      cloud_cover_pct: cloudCover,
      weather_code:    weatherCode,
      condition_label: wmoLabel(weatherCode),
      is_precipitation: isPrecipitation(weatherCode),
      latitude:        DARIEN.lat,
      longitude:       DARIEN.lng,
      timezone:        DARIEN.timezone,
      raw_json:        data,
    }

    const { error } = await supabase
      .from('weather_captures')
      .upsert(capture, {
        onConflict: 'restaurant_id,date_trunc,capture_hour',
        ignoreDuplicates: false,
      })

    if (error) throw error

    return NextResponse.json({
      ok: true,
      captured: {
        hour:        capture.capture_hour,
        temp:        `${tempF}°F`,
        feels_like:  `${apparentF}°F`,
        condition:   capture.condition_label,
        precip:      `${precipIn}"`,
        wind:        `${windMph} mph`,
        humidity:    `${humidity}%`,
      }
    })

  } catch (err) {
    console.error('[weather/capture]', err)
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}
