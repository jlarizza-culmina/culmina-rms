// src/components/WeatherAnalyticsPanel.tsx
// 30-day weather history chart for AnalyticsModule
// Shows temperature trend + precipitation days

'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { weatherEmoji, type WeatherDailySummary } from '@/lib/weatherUtils'

interface Props {
  restaurantId?: string
  days?: number
}

export default function WeatherAnalyticsPanel({ restaurantId, days = 30 }: Props) {
  const supabase = createClient()
  const [summaries, setSummaries] = useState<WeatherDailySummary[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      if (!restaurantId) { setLoading(false); return }
      const since = new Date()
      since.setDate(since.getDate() - days)
      const { data } = await (supabase as any)
        .from('weather_daily_summary')
        .select('*')
        .eq('restaurant_id', restaurantId)
        .gte('capture_date', since.toISOString().split('T')[0])
        .order('capture_date', { ascending: true })
      setSummaries(data ?? [])
      setLoading(false)
    }
    load()
  }, [restaurantId, days])

  if (loading || summaries.length === 0) return null

  const maxTemp = Math.max(...summaries.map(s => s.max_temp_f ?? 0))
  const minTemp = Math.min(...summaries.map(s => s.min_temp_f ?? 100))
  const tempRange = maxTemp - minTemp || 1
  const precipDays = summaries.filter(s => s.had_precipitation).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-[--hint]">
          Weather — Last {days} days
        </div>
        <div className="text-[11px] text-[--muted]">
          🌧 {precipDays} rain day{precipDays !== 1 ? 's' : ''} · 
          avg {Math.round(summaries.reduce((n, s) => n + (s.avg_temp_f ?? 0), 0) / summaries.length)}°F
        </div>
      </div>

      {/* Temperature sparkline */}
      <div className="relative h-24">
        <svg viewBox={`0 0 ${summaries.length * 12} 60`} className="w-full h-full" preserveAspectRatio="none">
          {/* Precipitation bars */}
          {summaries.map((s, i) => s.had_precipitation ? (
            <rect key={i} x={i * 12} y={0} width={10} height={60}
              fill="rgba(59,130,246,0.08)" />
          ) : null)}

          {/* Temperature range band */}
          {summaries.length > 1 && (
            <polyline
              points={summaries.map((s, i) => {
                const y = 55 - ((s.max_temp_f ?? 50) - minTemp) / tempRange * 50
                return `${i * 12 + 5},${y}`
              }).join(' ')}
              fill="none" stroke="rgba(180,60,20,0.3)" strokeWidth="6" strokeLinejoin="round"
            />
          )}

          {/* Avg temp line */}
          {summaries.length > 1 && (
            <polyline
              points={summaries.map((s, i) => {
                const y = 55 - ((s.avg_temp_f ?? 50) - minTemp) / tempRange * 50
                return `${i * 12 + 5},${y}`
              }).join(' ')}
              fill="none" stroke="rgb(180,60,20)" strokeWidth="1.5" strokeLinejoin="round"
            />
          )}

          {/* Dots for each day */}
          {summaries.map((s, i) => {
            const y = 55 - ((s.avg_temp_f ?? 50) - minTemp) / tempRange * 50
            return (
              <circle key={i} cx={i * 12 + 5} cy={y} r={s.had_precipitation ? 3 : 2}
                fill={s.had_precipitation ? 'rgb(59,130,246)' : 'rgb(180,60,20)'} />
            )
          })}
        </svg>
        {/* Temp labels */}
        <div className="absolute inset-0 pointer-events-none flex flex-col justify-between text-[9px] text-[--hint] -right-8">
          <span>{Math.round(maxTemp)}°F</span>
          <span>{Math.round(minTemp)}°F</span>
        </div>
      </div>

      {/* Last 7 days detail */}
      <div className="grid grid-cols-7 gap-1">
        {summaries.slice(-7).map(s => {
          const date = new Date(s.capture_date + 'T12:00:00')
          const dayName = date.toLocaleDateString('en-US', { weekday: 'short' })
          const avgCode = s.had_precipitation ? 61 : (s.avg_cloud_cover ?? 0) > 75 ? 3 : (s.avg_cloud_cover ?? 0) > 25 ? 2 : 0
          return (
            <div key={s.capture_date} className="text-center p-1.5 bg-[--surface-2] rounded-lg">
              <div className="text-[9px] text-[--hint]">{dayName}</div>
              <div className="text-lg my-0.5">{weatherEmoji(avgCode)}</div>
              <div className="text-[10px] font-medium text-[--text]">{Math.round(s.avg_temp_f ?? 0)}°</div>
              {s.had_precipitation && (
                <div className="text-[9px] text-blue-500">🌧</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
