'use client'
// src/components/DaypartSettings.tsx
// Settings page for managing a location's dayparts + per-day schedule.
//
// ASSUMED SCHEMA (columns not specified in the ticket — adjust here if the
// real tables differ):
//   daypart_configs:   id, location_id, name, time_type, sort_order, locked_at
//   daypart_schedule:  id, daypart_id, day_of_week (smallint, 0=Sun..6=Sat),
//                      is_active, open_time, kitchen_close_time, close_time
//   Time columns are PostgreSQL `time` (24-hour "HH:MM:SS"); converted to/from
//   12-hour strings for display via to12Hour/to24Hour.
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'

interface Props {
  locationId?: string
  locationName?: string
}

type TimeType = 'all_day' | 'variable' | 'specific'

interface DaypartConfig {
  id: string
  location_id: string
  name: string
  time_type: TimeType
  sort_order: number
  locked_at: string | null
}

interface ScheduleRow {
  id?: string
  daypart_id: string
  day_of_week: number
  is_active: boolean
  open_time: string | null
  kitchen_close_time: string | null
  close_time: string | null
}

interface DayDraft {
  day_of_week: number
  is_active: boolean
  open_time: string
  kitchen_close_time: string
  close_time: string
}

interface Draft {
  id?: string
  name: string
  time_type: TimeType
  locked_at?: string | null
  days: DayDraft[]
}

const TYPE_OPTIONS: { value: TimeType; label: string }[] = [
  { value: 'all_day',  label: 'All Day' },
  { value: 'variable', label: 'Variable' },
  { value: 'specific', label: 'Specific' },
]
const TYPE_LABELS: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map(t => [t.value, t.label]))

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const DEFAULT_TIMES: Record<string, { open: string; kitchen: string; close: string }> = {
  morning:   { open: '6:00 AM', kitchen: '10:30 AM', close: '11:00 AM' },
  aperitivo: { open: '4:30 PM', kitchen: '8:30 PM',  close: '9:00 PM' },
  dinner:    { open: '5:30 PM', kitchen: '9:30 PM',  close: '10:00 PM' },
}

const TIME_OPTIONS: string[] = (() => {
  const out: string[] = []
  for (let h = 0; h < 24; h++) {
    for (const m of [0, 30]) {
      const ampm = h < 12 ? 'AM' : 'PM'
      const h12 = h % 12 || 12
      out.push(`${h12}:${String(m).padStart(2, '0')} ${ampm}`)
    }
  }
  return out
})()

// "6:00 AM" → "06:00", "10:30 PM" → "22:30", "" → ""
function to24Hour(time12: string): string {
  if (!time12) return ''
  const m = time12.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i)
  if (!m) return ''
  let h = parseInt(m[1], 10)
  const ap = m[3].toUpperCase()
  if (ap === 'AM') { if (h === 12) h = 0 }
  else if (h !== 12) h += 12
  return `${String(h).padStart(2, '0')}:${m[2]}`
}

// "06:00:00" → "6:00 AM", "22:30:00" → "10:30 PM", "" → ""
function to12Hour(time24: string): string {
  if (!time24) return ''
  const m = time24.trim().match(/^(\d{1,2}):(\d{2})/)
  if (!m) return ''
  const h = parseInt(m[1], 10)
  const ap = h < 12 ? 'AM' : 'PM'
  const h12 = h % 12 || 12
  return `${h12}:${m[2]} ${ap}`
}

function blankDays(name: string): DayDraft[] {
  const def = DEFAULT_TIMES[name.trim().toLowerCase()]
  return DAY_ABBR.map((_, i) => ({
    day_of_week: i,
    is_active: i >= 1 && i <= 6, // Mon–Sat
    open_time: def?.open ?? '',
    kitchen_close_time: def?.kitchen ?? '',
    close_time: def?.close ?? '',
  }))
}

function daysFromSchedule(rows: ScheduleRow[]): DayDraft[] {
  return DAY_ABBR.map((_, i) => {
    const r = rows.find(x => x.day_of_week === i)
    return {
      day_of_week: i,
      is_active: r?.is_active ?? false,
      open_time: r?.open_time ?? '',
      kitchen_close_time: r?.kitchen_close_time ?? '',
      close_time: r?.close_time ?? '',
    }
  })
}

export default function DaypartSettings({ locationId, locationName }: Props) {
  const supabase = createClient()
  const [dayparts,  setDayparts]  = useState<DaypartConfig[]>([])
  const [schedules, setSchedules] = useState<Record<string, ScheduleRow[]>>({})
  const [loading,   setLoading]   = useState(true)
  const [draft,     setDraft]     = useState<Draft | null>(null)
  const [saving,    setSaving]    = useState(false)

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const { data: configs } = await supabase.from('daypart_configs').select('*')
      .eq('location_id', locationId).order('sort_order')
    const list = (configs ?? []) as DaypartConfig[]
    setDayparts(list)

    const ids = list.map(d => d.id)
    if (ids.length) {
      const { data: sched } = await supabase.from('daypart_schedule').select('*')
        .in('daypart_id', ids)
      const map: Record<string, ScheduleRow[]> = {}
      for (const row of (sched ?? []) as ScheduleRow[]) {
        // DB stores 24-hour time; convert to 12-hour for display.
        const displayRow: ScheduleRow = {
          ...row,
          open_time:          to12Hour(row.open_time ?? '') || null,
          kitchen_close_time: to12Hour(row.kitchen_close_time ?? '') || null,
          close_time:         to12Hour(row.close_time ?? '') || null,
        }
        if (!map[row.daypart_id]) map[row.daypart_id] = []
        map[row.daypart_id].push(displayRow)
      }
      setSchedules(map)
    } else {
      setSchedules({})
    }
    setLoading(false)
  }, [locationId, supabase])

  useEffect(() => { load() }, [load])

  function daysActiveLabel(id: string): string {
    const rows = schedules[id] ?? []
    const active = DAY_ABBR.filter((_, i) => rows.find(r => r.day_of_week === i)?.is_active)
    if (active.length === 7) return 'Daily'
    if (active.length === 0) return '—'
    return active.join(' ')
  }

  function startAdd() {
    setDraft({ name: '', time_type: 'specific', days: blankDays('') })
  }
  function startEdit(dp: DaypartConfig) {
    setDraft({
      id: dp.id, name: dp.name, time_type: dp.time_type, locked_at: dp.locked_at,
      days: daysFromSchedule(schedules[dp.id] ?? []),
    })
  }

  function setDay(i: number, patch: Partial<DayDraft>) {
    setDraft(p => p ? { ...p, days: p.days.map((d, idx) => idx === i ? { ...d, ...patch } : d) } : p)
  }

  function copyToWeekdays() {
    setDraft(p => {
      if (!p) return p
      const mon = p.days[1]
      return {
        ...p,
        days: p.days.map((d, idx) => (idx >= 2 && idx <= 5)
          ? { ...d, open_time: mon.open_time, kitchen_close_time: mon.kitchen_close_time, close_time: mon.close_time }
          : d),
      }
    })
  }

  async function save() {
    if (!draft || !locationId) return
    if (!draft.name.trim()) { alert('Name is required'); return }
    if (draft.time_type === 'specific' && !draft.days.some(d => d.is_active)) {
      alert('Select at least one active day'); return
    }
    setSaving(true)

    // Schedule rows: specific → from grid; all_day/variable → 7 active days, no times.
    const rows: DayDraft[] = draft.time_type === 'specific'
      ? draft.days
      : DAY_ABBR.map((_, i) => ({ day_of_week: i, is_active: true, open_time: '', kitchen_close_time: '', close_time: '' }))

    let daypartId = draft.id
    if (draft.id) {
      await supabase.from('daypart_configs')
        .update({ name: draft.name.trim(), time_type: draft.time_type }).eq('id', draft.id)
      await supabase.from('daypart_schedule').delete().eq('daypart_id', draft.id)
    } else {
      const { data } = await supabase.from('daypart_configs').insert({
        location_id: locationId, name: draft.name.trim(), time_type: draft.time_type,
        sort_order: dayparts.length + 1, locked_at: null,
      }).select().single()
      daypartId = (data as { id: string } | null)?.id
    }

    if (daypartId) {
      await supabase.from('daypart_schedule').insert(rows.map(d => ({
        daypart_id:         daypartId,
        day_of_week:        d.day_of_week,
        is_active:          d.is_active,
        open_time:          d.is_active && d.open_time ? to24Hour(d.open_time) || null : null,
        kitchen_close_time: d.is_active && d.kitchen_close_time ? to24Hour(d.kitchen_close_time) || null : null,
        close_time:         d.is_active && d.close_time ? to24Hour(d.close_time) || null : null,
      })))
    }
    setSaving(false)
    setDraft(null)
    load()
  }

  async function move(dp: DaypartConfig, dir: -1 | 1) {
    const idx = dayparts.findIndex(d => d.id === dp.id)
    const swapIdx = idx + dir
    if (swapIdx < 0 || swapIdx >= dayparts.length) return
    const other = dayparts[swapIdx]
    await supabase.from('daypart_configs').update({ sort_order: other.sort_order }).eq('id', dp.id)
    await supabase.from('daypart_configs').update({ sort_order: dp.sort_order }).eq('id', other.id)
    load()
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading dayparts…</div>
  if (!locationId) return <p className="text-sm text-[--muted]">No location selected.</p>

  const hasLocked = dayparts.some(d => d.locked_at)
  const inputCls = 'text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]'

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-lg font-medium text-[--text]">{locationName ? `${locationName} — ` : ''}Dayparts</h2>
        <p className="text-xs text-[--muted] mt-0.5">Dayparts drive cover inputs, pull list groupings, and production planning. Configure before first use.</p>
      </div>

      {hasLocked && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-800">
          ⚠ This location has production history. Daypart changes affect historical reports — edit with care.
        </div>
      )}

      {!draft && (
        <div className="flex justify-end">
          <button onClick={startAdd}
            className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">
            + Add Daypart
          </button>
        </div>
      )}

      {/* Daypart table */}
      {dayparts.length === 0 ? (
        <p className="text-sm text-[--muted] py-6 text-center">No dayparts yet. Add your first.</p>
      ) : (
        <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[--border] bg-[--surface-2] text-[10px] uppercase tracking-wide text-[--hint]">
                <th className="text-left px-3 py-2">Name</th>
                <th className="text-left px-3 py-2">Type</th>
                <th className="text-left px-3 py-2">Days Active</th>
                <th className="text-left px-3 py-2 w-14">Sort</th>
                <th className="text-left px-3 py-2 w-28">Actions</th>
              </tr>
            </thead>
            <tbody>
              {dayparts.map((dp, i) => (
                <tr key={dp.id} className="border-b border-[--border] last:border-0">
                  <td className="px-3 py-2.5 font-medium text-[--text]">
                    {dp.locked_at && <span className="mr-1" title="Locked — production history exists">🔒</span>}
                    {dp.name}
                  </td>
                  <td className="px-3 py-2.5 text-[--muted]">{TYPE_LABELS[dp.time_type] ?? dp.time_type}</td>
                  <td className="px-3 py-2.5 text-[--muted]">{daysActiveLabel(dp.id)}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex gap-0.5">
                      <button onClick={() => move(dp, -1)} disabled={i === 0}
                        className="px-1.5 text-[--muted] hover:text-[--text] disabled:opacity-30">↑</button>
                      <button onClick={() => move(dp, 1)} disabled={i === dayparts.length - 1}
                        className="px-1.5 text-[--muted] hover:text-[--text] disabled:opacity-30">↓</button>
                    </div>
                  </td>
                  <td className="px-3 py-2.5">
                    {dp.locked_at ? (
                      <span className="text-[10px] text-[--hint]">Locked</span>
                    ) : (
                      <button onClick={() => startEdit(dp)}
                        className="px-2 py-0.5 text-[10px] border border-[--border-2] rounded text-[--muted] hover:text-[--text]">Edit</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / edit form */}
      {draft && (
        <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
          <h3 className="font-serif text-sm font-medium text-[--text]">{draft.id ? `Edit: ${draft.name}` : 'Add Daypart'}</h3>

          {draft.locked_at ? (
            <div className="space-y-3">
              <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                This daypart is locked — production history exists. Contact your administrator to make changes.
              </p>
              <button onClick={() => setDraft(null)}
                className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                Close
              </button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Name</label>
                  <input value={draft.name}
                    onChange={e => setDraft(p => p ? {
                      ...p, name: e.target.value,
                      // Prefill known-daypart defaults while adding.
                      days: !p.id && p.time_type === 'specific' ? blankDays(e.target.value) : p.days,
                    } : p)}
                    placeholder='e.g. "Morning", "Aperitivo"'
                    className={`${inputCls} w-full`} autoFocus />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-[--muted] mb-1">Time type</label>
                  <select value={draft.time_type}
                    onChange={e => setDraft(p => p ? { ...p, time_type: e.target.value as TimeType } : p)}
                    className={`${inputCls} w-full bg-white`}>
                    {TYPE_OPTIONS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              </div>

              {draft.time_type === 'specific' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-[--hint]">Schedule</span>
                    <button onClick={copyToWeekdays}
                      className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">Copy to all weekdays</button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-[10px] uppercase tracking-wide text-[--hint]">
                          <th className="text-left py-1 pr-2">Day</th>
                          <th className="text-left py-1 pr-2">Open</th>
                          <th className="text-left py-1 pr-2">Kitchen close</th>
                          <th className="text-left py-1 pr-2">Close</th>
                        </tr>
                      </thead>
                      <tbody>
                        {draft.days.map((d, i) => (
                          <tr key={i} className="border-t border-[--border]">
                            <td className="py-1.5 pr-2">
                              <label className="flex items-center gap-1.5 cursor-pointer">
                                <input type="checkbox" checked={d.is_active}
                                  onChange={e => setDay(i, { is_active: e.target.checked })} className="accent-[--accent]" />
                                {DAY_ABBR[i]}
                              </label>
                            </td>
                            {(['open_time', 'kitchen_close_time', 'close_time'] as const).map(field => (
                              <td key={field} className="py-1.5 pr-2">
                                <select value={d[field]} disabled={!d.is_active}
                                  onChange={e => setDay(i, { [field]: e.target.value } as Partial<DayDraft>)}
                                  className={`${inputCls} bg-white disabled:opacity-40`}>
                                  <option value="">—</option>
                                  {TIME_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                                </select>
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div className="flex gap-2">
                <button onClick={save} disabled={saving}
                  className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
                  {saving ? 'Saving…' : 'Save'}
                </button>
                <button onClick={() => setDraft(null)}
                  className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
