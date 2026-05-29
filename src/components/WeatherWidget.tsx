// src/components/WeatherWidget.tsx
// Shows today's weather captures + commuter sentiment hints
// Used in AnalyticsModule and ProductionPlanner header

'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import {
  type WeatherCapture,
  weatherEmoji,
  commuterSentiment,
  SENTIMENT_HINTS,
  formatTemp,
  formatPrecip,
} from '@/lib/weatherUtils'

interface Props {
  restaurantId?: string
  compact?: boolean   // true = just the current condition pill
}

const HOUR_LABELS: Record<number, string> = { 6: 'Morning', 12: 'Midday', 18: 'Evening' }

export default function WeatherWidget({ restaurantId, compact = false }: Props) {
  const supabase = createClient()
  const [captures, setCaptures] = useState<WeatherCapture[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!restaurantId) { setLoading(false); return }
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('weather_captures')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('captured_at', `${today}T00:00:00`)
        .lte('captured_at', `${today}T23:59:59`)
        .order('capture_hour')
      setCaptures(data ?? [])
      setLoading(false)
    }
    load()
  }, [restaurantId])

  if (loading) return null
  if (captures.length === 0) {
    if (compact) return null
    return (
      <div className="text-[11px] text-[--hint] p-3 bg-[--surface-2] rounded-lg">
        No weather data yet — will appear after first cron run at 6am ET.
      </div>
    )
  }

  // Most recent capture
  const latest = captures[captures.length - 1]
  const sentiment = commuterSentiment(latest.temperature_f, latest.is_precipitation)
  const hint = SENTIMENT_HINTS[sentiment]

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-[11px] text-[--muted]">
        <span>{weatherEmoji(latest.weather_code)}</span>
        <span>{formatTemp(latest.temperature_f)}</span>
        <span className="text-[--hint]">{latest.condition_label}</span>
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
        {([6, 12, 18] as const).map(hour => {
          const cap = captures.find(c => c.capture_hour === hour)
          return (
            <div key={hour} className={`rounded-lg p-2.5 text-center ${cap ? 'bg-white border border-[--border]' : 'bg-[--surface-2] border border-dashed border-[--border]'}`}>
              <div className="text-[10px] text-[--hint] mb-1">{HOUR_LABELS[hour]}</div>
              {cap ? (
                <>
                  <div className="text-2xl mb-1">{weatherEmoji(cap.weather_code)}</div>
                  <div className="text-sm font-medium text-[--text]">{formatTemp(cap.temperature_f)}</div>
                  <div className="text-[10px] text-[--muted] mt-0.5">
                    Feels {formatTemp(cap.apparent_temp_f)}
                  </div>
                  {cap.humidity_pct !== null && (
                    <div className="text-[10px] text-[--hint]">💧{cap.humidity_pct}%</div>
                  )}
                  {cap.is_precipitation && cap.precipitation_in !== null && cap.precipitation_in > 0 && (
                    <div className="text-[10px] text-blue-500">{formatPrecip(cap.precipitation_in)} rain</div>
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

      {/* Wind + precip summary */}
      {latest && (
        <div className="flex gap-4 text-[10px] text-[--hint]">
          {latest.wind_speed_mph !== null && (
            <span>💨 {latest.wind_speed_mph} mph{latest.wind_gust_mph ? ` (gusts ${latest.wind_gust_mph})` : ''}</span>
          )}
          {latest.cloud_cover_pct !== null && (
            <span>☁️ {latest.cloud_cover_pct}% cloud</span>
          )}
        </div>
      )}
    </div>
  )
}
