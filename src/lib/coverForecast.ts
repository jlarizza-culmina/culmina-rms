// src/lib/coverForecast.ts
// Resolve forecast covers for a date from baselines + day-of-week modifiers.
import { SupabaseClient } from '@supabase/supabase-js'

export async function getForecastForDate(
  supabase: SupabaseClient,
  locationId: string,
  date: Date
): Promise<Record<string, number>> {
  // Returns: { [daypart_id]: forecast_covers }

  const year = date.getFullYear()
  const dow = date.getDay().toString()  // '0'=Sun through '6'=Sat

  const { data: baselines } = await supabase
    .from('cover_forecast_baselines')
    .select('daypart_id, baseline_covers')
    .eq('location_id', locationId)
    .eq('year', year)

  if (!baselines || baselines.length === 0) return {}

  const { data: modifiers } = await supabase
    .from('cover_forecast_modifiers')
    .select('daypart_id, modifier_pct')
    .eq('location_id', locationId)
    .eq('year', year)
    .eq('granularity', 'day_of_week')
    .eq('granularity_value', dow)

  const modifierMap: Record<string, number> = {}
  modifiers?.forEach((m: { daypart_id: string; modifier_pct: number }) => { modifierMap[m.daypart_id] = m.modifier_pct })

  const result: Record<string, number> = {}
  baselines.forEach((b: { daypart_id: string; baseline_covers: number }) => {
    const mod = modifierMap[b.daypart_id] ?? 0
    result[b.daypart_id] = Math.round(b.baseline_covers * (1 + mod / 100))
  })

  return result
}
