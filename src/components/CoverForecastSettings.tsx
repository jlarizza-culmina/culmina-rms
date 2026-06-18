'use client'
// src/components/CoverForecastSettings.tsx
// Cover forecast config: baseline covers + day-of-week modifiers per daypart.
//
// ASSUMED SCHEMA (adjust here if the real tables differ):
//   cover_forecast_baselines: id, location_id, year, daypart_id, baseline_covers
//     unique (location_id, year, daypart_id)
//   cover_forecast_modifiers: id, location_id, year, daypart_id, granularity,
//     granularity_value, modifier_pct, notes
//     unique (location_id, year, daypart_id, granularity, granularity_value)
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

interface Props {
  locationId?: string
  locationName?: string
}

interface Daypart { id: string; name: string; sort_order: number }

// Columns Mon–Sun; DB stores Sun=0..Sat=6 (JS getDay()).
const DOW_COLS: { label: string; dow: string }[] = [
  { label: 'Mon', dow: '1' }, { label: 'Tue', dow: '2' }, { label: 'Wed', dow: '3' },
  { label: 'Thu', dow: '4' }, { label: 'Fri', dow: '5' }, { label: 'Sat', dow: '6' }, { label: 'Sun', dow: '0' },
]

function clampMod(n: number): number {
  if (isNaN(n)) return 0
  return Math.max(-99, Math.min(999, n))
}

function computeForecast(
  date: Date,
  daypartId: string,
  baselines: Record<string, number>,
  dowModifiers: Record<string, Record<string, number>>
): number {
  const baseline = baselines[daypartId] ?? 0
  const dow = date.getDay().toString()
  const dowMod = dowModifiers[daypartId]?.[dow] ?? 0
  return Math.round(baseline * (1 + dowMod / 100))
}

export default function CoverForecastSettings({ locationId, locationName }: Props) {
  const supabase = createClient()
  const [year, setYear] = useState(new Date().getFullYear() + 1)
  const [dayparts, setDayparts] = useState<Daypart[]>([])
  const [baselines, setBaselines] = useState<Record<string, number>>({})
  const [dowModifiers, setDowModifiers] = useState<Record<string, Record<string, number>>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const [{ data: dps }, { data: bl }, { data: mods }] = await Promise.all([
      supabase.from('daypart_configs').select('id,name,sort_order').eq('location_id', locationId).order('sort_order'),
      supabase.from('cover_forecast_baselines').select('*').eq('location_id', locationId).eq('year', year),
      supabase.from('cover_forecast_modifiers').select('*').eq('location_id', locationId).eq('year', year).eq('granularity', 'day_of_week'),
    ])
    setDayparts((dps ?? []) as Daypart[])
    const bmap: Record<string, number> = {}
    for (const b of (bl ?? []) as { daypart_id: string; baseline_covers: number }[]) bmap[b.daypart_id] = b.baseline_covers
    setBaselines(bmap)
    const mmap: Record<string, Record<string, number>> = {}
    for (const m of (mods ?? []) as { daypart_id: string; granularity_value: string; modifier_pct: number }[]) {
      if (!mmap[m.daypart_id]) mmap[m.daypart_id] = {}
      mmap[m.daypart_id][m.granularity_value] = m.modifier_pct
    }
    setDowModifiers(mmap)
    setLoading(false)
  }, [locationId, year, supabase])

  useEffect(() => { load() }, [load])

  function setBaseline(dpId: string, raw: string) {
    setBaselines(b => {
      const n = { ...b }
      if (raw === '') delete n[dpId]
      else n[dpId] = Math.max(0, parseInt(raw) || 0)
      return n
    })
  }
  function setMod(dpId: string, dow: string, val: number) {
    setDowModifiers(m => ({ ...m, [dpId]: { ...(m[dpId] ?? {}), [dow]: clampMod(val) } }))
  }
  function bump(dpId: string, dow: string, delta: number) {
    setMod(dpId, dow, (dowModifiers[dpId]?.[dow] ?? 0) + delta)
  }

  async function save() {
    if (!locationId) return
    setSaving(true)
    for (const dp of dayparts) {
      if (baselines[dp.id] != null) {
        await supabase.from('cover_forecast_baselines').upsert(
          { location_id: locationId, year, daypart_id: dp.id, baseline_covers: baselines[dp.id] },
          { onConflict: 'location_id,year,daypart_id' }
        )
      }
      for (const col of DOW_COLS) {
        const mod = dowModifiers[dp.id]?.[col.dow] ?? 0
        if (mod !== 0) {
          await supabase.from('cover_forecast_modifiers').upsert(
            { location_id: locationId, year, daypart_id: dp.id, granularity: 'day_of_week', granularity_value: col.dow, modifier_pct: mod },
            { onConflict: 'location_id,year,daypart_id,granularity,granularity_value' }
          )
        } else {
          await supabase.from('cover_forecast_modifiers').delete()
            .eq('location_id', locationId).eq('year', year).eq('daypart_id', dp.id)
            .eq('granularity', 'day_of_week').eq('granularity_value', col.dow)
        }
      }
    }
    setSaving(false)
    load()
    alert(`✓ Forecast configuration saved for ${year}`)
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading forecast…</div>
  if (!locationId) return <p className="text-sm text-[--muted]">No location selected.</p>

  const previewDays = Array.from({ length: 30 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d })

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-2">
        <div>
          <h2 className="font-serif text-lg font-medium text-[--text]">{locationName ? `${locationName} — ` : ''}Cover Forecast</h2>
          <p className="text-xs text-[--muted] mt-0.5">Encode your knowledge of demand patterns once. Culmina applies them to production planning automatically.</p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setYear(y => y - 1)} className="px-2 py-0.5 border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">←</button>
          <span className="font-medium text-[--text] w-12 text-center">{year}</span>
          <button onClick={() => setYear(y => y + 1)} className="px-2 py-0.5 border border-[--border-2] rounded-lg text-[--muted] hover:bg-[--surface-2]">→</button>
        </div>
      </div>

      {dayparts.length === 0 ? (
        <p className="text-sm text-[--muted]">No dayparts configured. Set up dayparts first (Settings → Dayparts).</p>
      ) : (
        <>
          {/* Section 1: baseline */}
          <div>
            <h3 className="font-serif text-sm font-medium text-[--text]">Step 1 — Baseline covers</h3>
            <p className="text-xs text-[--muted] mb-3">The typical cover count for a standard day. All modifiers are relative to this number.</p>
            <div className="bg-white rounded-xl border border-[--border] p-4 space-y-2 max-w-sm">
              {dayparts.map(dp => (
                <div key={dp.id} className="flex items-center justify-between gap-3">
                  <span className="text-xs font-medium text-[--text]">{dp.name}</span>
                  <input type="number" min={0} value={baselines[dp.id] ?? ''} placeholder="0"
                    onChange={e => setBaseline(dp.id, e.target.value)}
                    className="w-20 text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]" />
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: DOW modifiers */}
          <div>
            <h3 className="font-serif text-sm font-medium text-[--text]">Step 2 — Day-of-week modifiers (%)</h3>
            <p className="text-xs text-[--muted] mb-3">Adjust covers for each day of the week. Blank = no adjustment (0%).</p>
            <div className="space-y-4">
              {dayparts.map(dp => (
                <div key={dp.id} className="bg-white rounded-xl border border-[--border] p-3 overflow-x-auto">
                  <div className="text-xs font-medium text-[--text] mb-2">{dp.name}</div>
                  <table className="text-[11px]">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-wide text-[--hint]">
                        {DOW_COLS.map(c => <th key={c.dow} className="px-1 py-1 text-center w-24">{c.label}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        {DOW_COLS.map(c => {
                          const mod = dowModifiers[dp.id]?.[c.dow] ?? 0
                          const bg = mod > 0 ? '#f0fdf4' : mod < 0 ? '#fef2f2' : undefined
                          return (
                            <td key={c.dow} className="px-1 py-1">
                              <div className="flex items-center gap-0.5 justify-center">
                                <button onClick={() => bump(dp.id, c.dow, -5)} className="w-5 h-6 border border-[--border-2] rounded text-[--muted] hover:bg-[--surface-2]">−</button>
                                <input type="number" value={mod === 0 ? '' : mod} placeholder="0"
                                  onChange={e => setMod(dp.id, c.dow, e.target.value === '' ? 0 : parseInt(e.target.value))}
                                  style={{ background: bg }}
                                  className="w-12 text-center text-xs border border-[--border-2] rounded px-1 py-1 outline-none focus:border-[--accent]" />
                                <button onClick={() => bump(dp.id, c.dow, 5)} className="w-5 h-6 border border-[--border-2] rounded text-[--muted] hover:bg-[--surface-2]">+</button>
                              </div>
                            </td>
                          )
                        })}
                      </tr>
                      <tr>
                        {DOW_COLS.map(c => {
                          const baseline = baselines[dp.id] ?? 0
                          const mod = dowModifiers[dp.id]?.[c.dow] ?? 0
                          const est = Math.round(baseline * (1 + mod / 100))
                          return (
                            <td key={c.dow} className="px-1 pt-1 text-center text-[10px] text-[--hint]">
                              {c.dow === DOW_COLS[0].dow && <span className="sr-only">Est. covers</span>}
                              {baseline ? est : '—'}
                            </td>
                          )
                        })}
                      </tr>
                    </tbody>
                  </table>
                  <div className="text-[10px] text-[--hint] mt-1">Est. covers →</div>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: save */}
          <button onClick={save} disabled={saving}
            className="w-full py-2.5 text-sm font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
            {saving ? 'Saving…' : 'Save forecast configuration'}
          </button>

          {/* Section 4: 30-day preview */}
          <div>
            <button onClick={() => setShowPreview(v => !v)} className="text-[11px] text-[--muted] hover:text-[--text] underline">
              Preview — next 30 days {showPreview ? '▲' : '▼'}
            </button>
            {showPreview && (
              <div className="mt-2 bg-white rounded-xl border border-[--border] overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                      <th className="text-left px-3 py-2">Date</th>
                      <th className="text-left px-3 py-2">DOW</th>
                      {dayparts.map(dp => <th key={dp.id} className="text-left px-3 py-2">{dp.name}</th>)}
                      <th className="text-left px-3 py-2">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previewDays.map((d, i) => {
                      const dow = d.getDay().toString()
                      const anyMod = dayparts.some(dp => (dowModifiers[dp.id]?.[dow] ?? 0) !== 0)
                      const perDaypart = dayparts.map(dp => computeForecast(d, dp.id, baselines, dowModifiers))
                      const total = perDaypart.reduce((s, n) => s + n, 0)
                      return (
                        <tr key={i} className="border-b border-[--border] last:border-0">
                          <td className="px-3 py-1.5 text-[--muted]">{d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</td>
                          <td className="px-3 py-1.5 text-[--muted]">
                            {anyMod && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[--accent] mr-1 align-middle" />}
                            {d.toLocaleDateString('en-US', { weekday: 'short' })}
                          </td>
                          {perDaypart.map((n, j) => <td key={j} className="px-3 py-1.5 text-[--text]">{n}</td>)}
                          <td className="px-3 py-1.5 font-medium text-[--text]">{total}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
