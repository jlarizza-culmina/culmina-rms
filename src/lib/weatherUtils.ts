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

// WMO code → emoji
export function weatherEmoji(code: number | null): string {
  if (code === null) return '🌡'
  if (code === 0)    return '☀️'
  if (code === 1)    return '🌤'
  if (code === 2)    return '⛅'
  if (code === 3)    return '☁️'
  if (code <= 19)    return '🌫'
  if (code <= 39)    return '🌫'
  if (code <= 49)    return '🌧'  // drizzle
  if (code <= 59)    return '🌧'  // rain
  if (code <= 69)    return '🌨'  // snow
  if (code <= 79)    return '🌨'  // ice
  if (code <= 84)    return '🌦'  // shower
  return '⛈'                      // thunder
}

// Temperature → commuter sentiment (for production planning hints)
export function commuterSentiment(tempF: number | null, isPrecip: boolean): string {
  if (tempF === null) return 'unknown'
  if (isPrecip) return 'indoor-seeking'         // → more hot drinks, stay longer
  if (tempF < 32)   return 'cold-commute'       // → more coffee, hot drinks
  if (tempF < 50)   return 'cool-commute'       // → more coffee, hot food
  if (tempF < 68)   return 'comfortable'        // → normal mix
  if (tempF < 80)   return 'warm-commute'       // → more cold drinks, aperitivo
  return 'hot-commute'                           // → cold drinks, spritzes, gelato
}

// Sentiment → menu recommendations
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
  return `${(inches * 100).toFixed(1) / 100}"` 
}

// Get the capture for a specific hour from a list of captures
export function captureForHour(
  captures: WeatherCapture[],
  date: string,        // 'YYYY-MM-DD'
  hour: 6 | 12 | 18
): WeatherCapture | undefined {
  return captures.find(c =>
    c.captured_at.startsWith(date) && c.capture_hour === hour
  )
}
