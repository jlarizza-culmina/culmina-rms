// src/components/WeatherWidget.tsx
// Shows today's weather observations + commuter sentiment hints

'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import {
  type WeatherObservation,
  weatherEmoji,
  commuterSentiment,
  SENTIMENT_HINTS,
  formatTemp,
  formatPrecip,
  applyWeatherScope,
} from '@/lib/weatherUtils'

interface Props {
  restaurantId?: string
  locationId?: string
  compact?: boolean   // true = just the current condition pill
}

const SLOTS = ['morning', 'noon', 'evening'] as const
const SLOT_LABELS: Record<string, string> = { morning: 'Morning', noon: 'Midday', evening: 'Evening' }

export default function WeatherWidget({ restaurantId, locationId, compact = false }: Props) {
  const supabase = createClient()
  const [captures, setCaptures] = useState<WeatherObservation[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!restaurantId && !locationId) { setLoading(false); return }
      const today = new Date().toISOString().split('T')[0]
      let query = supabase.from('weather_observations').select('*')
      query = applyWeatherScope(query, locationId, restaurantId)
      const { data } = await query
        .gte('observed_at', `${today}T00:00:00`)
        .lte('observed_at', `${today}T23:59:59`)
        .order('observed_at')
      setCaptures((data ?? []) as WeatherObservation[])
      setLoading(false)
    }
    load()
  }, [restaurantId, locationId])

  if (loading) return null
  if (captures.length === 0) {
    if (compact) return null
    return (
      <div className="text-[11px] text-[--hint] p-3 bg-[--surface-2] rounded-lg">
        No weather data yet — will appear after the next capture (6am / noon / 6pm).
      </div>
    )
  }

  // Most recent capture
  const latest = captures[captures.length - 1]
  const latestPrecip = (latest.precipitation ?? 0) > 0
  const sentiment = commuterSentiment(latest.temp_f, latestPrecip)
  const hint = SENTIMENT_HINTS[sentiment]

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-[--muted]">
        <span>{weatherEmoji(latest.weather_code)}</span>
        <span>{formatTemp(latest.temp_f)}</span>
        <span className="text-[--hint]">{latest.condition}</span>
      </div>
    )
  }

  return (
    <div className="bg-[--surface-2] rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint]">
          Darien CT — Today
        </div>
        <div className="text-[10px] text-[--hint]">
          via Open-Meteo
        </div>
      </div>

      {/* Three capture slots */}
      <div className="grid grid-cols-3 gap-2">
        {SLOTS.map(slot => {
          const cap = captures.find(c => c.capture_slot === slot)
          return (
            <div key={slot} className={`rounded-lg p-2.5 text-center ${cap ? 'bg-white border border-[--border]' : 'bg-[--surface-2] border border-dashed border-[--border]'}`}>
              <div className="text-[10px] text-[--hint] mb-1">{SLOT_LABELS[slot]}</div>
              {cap ? (
                <>
                  <div className="text-2xl mb-1">{weatherEmoji(cap.weather_code)}</div>
                  <div className="text-sm font-medium text-[--text]">{formatTemp(cap.temp_f)}</div>
                  <div className="text-[10px] text-[--muted] mt-0.5">
                    Feels {formatTemp(cap.feels_like_f)}
                  </div>
                  {cap.humidity !== null && (
                    <div className="text-[10px] text-[--hint]">💧{cap.humidity}%</div>
                  )}
                  {(cap.precipitation ?? 0) > 0 && (
                    <div className="text-[10px] text-blue-500">{formatPrecip(cap.precipitation)} rain</div>
                  )}
                </>
              ) : (
                <div className="text-[10px] text-[--hint] mt-2">Pending</div>
              )}
            </div>
          )
        })}
      </div>

      {/* Commuter sentiment hint */}
      {hint && (
        <div className={`text-[11px] px-3 py-2 rounded-lg ${
          sentiment === 'indoor-seeking' ? 'bg-blue-50 text-blue-700' :
          sentiment.includes('cold') ? 'bg-orange-50 text-orange-700' :
          sentiment.includes('warm') || sentiment.includes('hot') ? 'bg-amber-50 text-amber-700' :
          'bg-[--surface-2] text-[--muted]'
        }`}>
          {hint}
        </div>
      )}

      {/* Wind summary */}
      {latest.wind_mph !== null && (
        <div className="flex gap-4 text-[10px] text-[--hint]">
          <span>💨 {latest.wind_mph} mph</span>
        </div>
      )}
    </div>
  )
}
