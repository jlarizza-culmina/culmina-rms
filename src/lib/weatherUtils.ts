// src/lib/weatherUtils.ts
// Shared weather types, icons, and helpers for display components.
// Backed by the weather_observations table.

export interface WeatherObservation {
  id: string
  restaurant_id: string | null
  location_id: string | null
  observed_at: string
  temp_f: number | null
  temp_c: number | null
  feels_like_f: number | null
  humidity: number | null
  wind_mph: number | null
  precipitation: number | null
  weather_code: number | null
  condition: string | null
  capture_slot: string // 'morning' | 'noon' | 'evening'
}

export interface WeatherDailySummary {
  capture_date: string
  avg_temp_f: number | null
  min_temp_f: number | null
  max_temp_f: number | null
  total_precip_in: number | null
  had_precipitation: boolean
  avg_humidity: number | null
  weather_code: number | null
  capture_count: number
}

export function weatherEmoji(code: number | null): string {
  if (code === null) return '🌡'
  if (code === 0)    return '☀️'
  if (code === 1)    return '🌤'
  if (code === 2)    return '⛅'
  if (code === 3)    return '☁️'
  if (code <= 19)    return '🌫'
  if (code <= 39)    return '🌫'
  if (code <= 49)    return '🌧'
  if (code <= 59)    return '🌧'
  if (code <= 69)    return '🌨'
  if (code <= 79)    return '🌨'
  if (code <= 84)    return '🌦'
  return '⛈'
}

export function commuterSentiment(tempF: number | null, isPrecip: boolean): string {
  if (tempF === null) return 'unknown'
  if (isPrecip) return 'indoor-seeking'
  if (tempF < 32)   return 'cold-commute'
  if (tempF < 50)   return 'cool-commute'
  if (tempF < 68)   return 'comfortable'
  if (tempF < 80)   return 'warm-commute'
  return 'hot-commute'
}

export const SENTIMENT_HINTS: Record<string, string> = {
  'indoor-seeking':  '☕ Rainy — expect longer dwell time, push hot drinks and Bicerin',
  'cold-commute':    '🧥 Cold — prioritize Cappuccino, Cioccolato Caldo, hot food',
  'cool-commute':    '🍵 Cool — Americano, Flat White, warm antipasti',
  'comfortable':     '⚖️ Comfortable — balanced mix across all categories',
  'warm-commute':    '🍸 Warm — Aperol Spritz, Negroni, Shakerato, cold drinks',
  'hot-commute':     '🥤 Hot — cold drinks, Caffè Freddo, Shakerato, Bianco e Nero',
  'unknown':         '',
}

export function formatTemp(f: number | null): string {
  return f !== null ? `${Math.round(f)}°F` : '—'
}

export function formatPrecip(inches: number | null): string {
  if (inches === null) return '—'
  if (inches === 0) return 'None'
  if (inches < 0.01) return 'Trace'
  return `${inches.toFixed(2)}"`
}

// Scope a weather_observations query: prefer location_id, and fall back to
// legacy rows whose location_id is null (captured before location scoping).
export function applyWeatherScope<T>(query: T, locationId?: string, restaurantId?: string): T {
  const q = query as any
  if (locationId && restaurantId)
    return q.or(`location_id.eq.${locationId},and(location_id.is.null,restaurant_id.eq.${restaurantId})`)
  if (locationId)
    return q.or(`location_id.eq.${locationId},location_id.is.null`)
  if (restaurantId)
    return q.eq('restaurant_id', restaurantId)
  return q
}

// Aggregate raw observations into per-day summaries (client-side).
export function summarizeByDay(obs: WeatherObservation[]): WeatherDailySummary[] {
  const byDate = new Map<string, WeatherObservation[]>()
  for (const o of obs) {
    const d = o.observed_at.split('T')[0]
    if (!byDate.has(d)) byDate.set(d, [])
    byDate.get(d)!.push(o)
  }
  const avg = (xs: number[]) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null
  return Array.from(byDate.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, rows]) => {
      const temps = rows.map(r => r.temp_f).filter((n): n is number => n != null)
      const hums  = rows.map(r => r.humidity).filter((n): n is number => n != null)
      const codes = rows.map(r => r.weather_code).filter((n): n is number => n != null)
      const totalPrecip = rows.reduce((sum, r) => sum + (r.precipitation ?? 0), 0)
      return {
        capture_date:     date,
        avg_temp_f:       avg(temps),
        min_temp_f:       temps.length ? Math.min(...temps) : null,
        max_temp_f:       temps.length ? Math.max(...temps) : null,
        total_precip_in:  totalPrecip,
        had_precipitation: totalPrecip > 0,
        avg_humidity:     avg(hums),
        weather_code:     codes.length ? Math.max(...codes) : null,
        capture_count:    rows.length,
      }
    })
}
