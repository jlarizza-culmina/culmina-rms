// src/lib/weatherUtils.ts
// Shared weather types, icons, and helpers for display components

export interface WeatherCapture {
  id: string
  restaurant_id: string
  location_id?: string | null
  captured_at: string
  capture_hour: 6 | 12 | 18
  temperature_f: number | null
  apparent_temp_f: number | null
  precipitation_in: number | null
  wind_speed_mph: number | null
  wind_gust_mph: number | null
  humidity_pct: number | null
  cloud_cover_pct: number | null
  weather_code: number | null
  condition_label: string | null
  is_precipitation: boolean
  latitude?: number | null
  longitude?: number | null
}

export interface WeatherDailySummary {
  capture_date: string
  avg_temp_f: number | null
  min_temp_f: number | null
  max_temp_f: number | null
  total_precip_in: number | null
  had_precipitation: boolean
  avg_humidity: number | null
  avg_cloud_cover: number | null
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

export function captureForHour(
  captures: WeatherCapture[],
  date: string,
  hour: 6 | 12 | 18
): WeatherCapture | undefined {
  return captures.find(c =>
    c.captured_at.startsWith(date) && c.capture_hour === hour
  )
}
