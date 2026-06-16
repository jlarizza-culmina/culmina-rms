'use client'
// src/components/OperatingHoursSettings.tsx
// Settings page for a location's operating hours, versioned by effective date.
//
// ASSUMED SCHEMA (adjust here if the real tables differ):
//   operating_hour_schedules: id, location_id, effective_from (date),
//                             effective_until (date|null), locked_at (timestamptz|null)
//   operating_hours:          id, schedule_id, day_of_week (smallint 0=Sun..6=Sat),
//                             is_closed, open_time, kitchen_close_time, close_time
//   Time columns are PostgreSQL `time` (24-hour); displayed as 12-hour strings.
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { to12Hour, to24Hour } from '@/lib/timeFormat'

interface Props {
  locationId?: string
  locationName?: string
}

interface Schedule {
  id: string
  location_id: string
  effective_from: string
  effective_until: string | null
  locked_at: string | null
}

interface HoursRow {
  id?: string
  schedule_id: string
  day_of_week: number
  is_closed: boolean
  open_time: string | null
  kitchen_close_time: string | null
  close_time: string | null
}

interface DayDraft {
  day_of_week: number
  is_closed: boolean
  open_time: string          // 12-hour display
  kitchen_close_time: string
  close_time: string
}

interface Draft {
  id?: string                // set when editing an existing schedule
  effective_from: string
  prevScheduleId?: string    // set when this is a successor (auto-end the prior one)
  days: DayDraft[]
}

const DAY_ABBR = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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

function todayStr(): string { return new Date().toISOString().split('T')[0] }
function addDaysStr(dateStr: string, delta: number): string {
  const d = new Date(dateStr + 'T12:00:00')
  d.setDate(d.getDate() + delta)
  return d.toISOString().split('T')[0]
}
function fmtDate(dateStr: string): string {
  return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function defaultDays(): DayDraft[] {
  // Corretto defaults: Mon–Sat 6:00 AM / 10:30 PM / 11:00 PM, Sun closed.
  return DAY_ABBR.map((_, i) => i === 0
    ? { day_of_week: 0, is_closed: true, open_time: '', kitchen_close_time: '', close_time: '' }
    : { day_of_week: i, is_closed: false, open_time: '6:00 AM', kitchen_close_time: '10:30 PM', close_time: '11:00 PM' })
}

function daysFromHours(rows: HoursRow[]): DayDraft[] {
  return DAY_ABBR.map((_, i) => {
    const r = rows.find(x => x.day_of_week === i)
    return {
      day_of_week: i,
      is_closed: r?.is_closed ?? false,
      open_time: r?.open_time ?? '',
      kitchen_close_time: r?.kitchen_close_time ?? '',
      close_time: r?.close_time ?? '',
    }
  })
}

export default function OperatingHoursSettings({ locationId, locationName }: Props) {
  const supabase = createClient()
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [hoursBySchedule, setHoursBySchedule] = useState<Record<string, HoursRow[]>>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [saving, setSaving] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const load = useCallback(async () => {
    if (!locationId) { setLoading(false); return }
    setLoading(true)
    const { data: scheds } = await supabase.from('operating_hour_schedules').select('*')
      .eq('location_id', locationId).order('effective_from', { ascending: false })
    const list = (scheds ?? []) as Schedule[]
    setSchedules(list)

    const ids = list.map(s => s.id)
    if (ids.length) {
      const { data: hrs } = await supabase.from('operating_hours').select('*').in('schedule_id', ids)
      const map: Record<string, HoursRow[]> = {}
      for (const row of (hrs ?? []) as HoursRow[]) {
        const display: HoursRow = {
          ...row,
          open_time:          to12Hour(row.open_time ?? '') || null,
          kitchen_close_time: to12Hour(row.kitchen_close_time ?? '') || null,
          close_time:         to12Hour(row.close_time ?? '') || null,
        }
        if (!map[row.schedule_id]) map[row.schedule_id] = []
        map[row.schedule_id].push(display)
      }
      setHoursBySchedule(map)
    } else {
      setHoursBySchedule({})
    }
    setLoading(false)
  }, [locationId, supabase])

  useEffect(() => { load() }, [load])

  const today = todayStr()
  const current = schedules.find(s => !s.effective_until || s.effective_until >= today) ?? null
  const past = schedules.filter(s => s.id !== current?.id)

  function startAdd() {
    setDraft({
      effective_from: current ? addDaysStr(today, 1) : today,
      prevScheduleId: current?.id,
      days: current ? daysFromHours(hoursBySchedule[current.id] ?? []) : defaultDays(),
    })
  }
  function startEditCurrent() {
    if (!current) return
    setDraft({
      id: current.id,
      effective_from: current.effective_from,
      days: daysFromHours(hoursBySchedule[current.id] ?? []),
    })
  }

  function setDay(i: number, patch: Partial<DayDraft>) {
    setDraft(p => p ? { ...p, days: p.days.map((d, idx) => idx === i ? { ...d, ...patch } : d) } : p)
  }
  function copyMonTo(indices: number[]) {
    setDraft(p => {
      if (!p) return p
      const mon = p.days[1]
      return {
        ...p,
        days: p.days.map((d, idx) => indices.includes(idx)
          ? { ...d, is_closed: false, open_time: mon.open_time, kitchen_close_time: mon.kitchen_close_time, close_time: mon.close_time }
          : d),
      }
    })
  }

  async function save() {
    if (!draft || !locationId) return
    if (!draft.effective_from) { alert('Effective-from date is required'); return }
    setSaving(true)

    let scheduleId = draft.id
    if (draft.id) {
      await supabase.from('operating_hour_schedules')
        .update({ effective_from: draft.effective_from }).eq('id', draft.id)
      await supabase.from('operating_hours').delete().eq('schedule_id', draft.id)
    } else {
      const { data } = await supabase.from('operating_hour_schedules').insert({
        location_id: locationId, effective_from: draft.effective_from, effective_until: null,
      }).select().single()
      scheduleId = (data as { id: string } | null)?.id
      // Auto-end the prior schedule the day before this one starts.
      if (scheduleId && draft.prevScheduleId) {
        await supabase.from('operating_hour_schedules')
          .update({ effective_until: addDaysStr(draft.effective_from, -1) })
          .eq('id', draft.prevScheduleId)
      }
    }

    if (scheduleId) {
      await supabase.from('operating_hours').insert(draft.days.map(d => ({
        schedule_id:        scheduleId,
        day_of_week:        d.day_of_week,
        is_closed:          d.is_closed,
        open_time:          d.is_closed ? null : (to24Hour(d.open_time) || null),
        kitchen_close_time: d.is_closed ? null : (to24Hour(d.kitchen_close_time) || null),
        close_time:         d.is_closed ? null : (to24Hour(d.close_time) || null),
      })))
    }

    setSaving(false)
    setDraft(null)
    load()
  }

  if (loading) return <div className="text-sm text-[--muted] py-8">Loading operating hours…</div>
  if (!locationId) return <p className="text-sm text-[--muted]">No location selected.</p>

  const inputCls = 'text-xs border border-[--border-2] rounded-lg px-2 py-1 outline-none focus:border-[--accent]'

  return (
    <div className="space-y-4">
      <div>
        <h2 className="font-serif text-lg font-medium text-[--text]">{locationName ? `${locationName} — ` : ''}Operating Hours</h2>
        <p className="text-xs text-[--muted] mt-0.5">Set the hours guests can visit. New schedules take effect on their start date. Past schedules are locked.</p>
      </div>

      {/* ── Edit / add form ── */}
      {draft ? (
        <div className="bg-white rounded-xl border border-[--border] p-4 space-y-3">
          <h3 className="font-serif text-sm font-medium text-[--text]">{draft.id ? 'Edit current schedule' : 'New schedule'}</h3>
          <div className="flex items-center gap-2">
            <label className="text-[11px] font-medium text-[--muted]">Effective from</label>
            <input type="date" value={draft.effective_from}
              onChange={e => setDraft(p => p ? { ...p, effective_from: e.target.value } : p)}
              className={inputCls} />
          </div>

          <div className="flex gap-2">
            <button onClick={() => copyMonTo([2, 3, 4, 5])}
              className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">Copy Mon to weekdays</button>
            <button onClick={() => copyMonTo([0, 1, 2, 3, 4, 5, 6])}
              className="text-[11px] text-[--accent] hover:text-[--accent-dark] font-medium">Copy to all days</button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-[10px] uppercase tracking-wide text-[--hint]">
                  <th className="text-left py-1 pr-2 w-12">Day</th>
                  <th className="text-left py-1 pr-2">Closed</th>
                  <th className="text-left py-1 pr-2">Open</th>
                  <th className="text-left py-1 pr-2">Kitchen Close</th>
                  <th className="text-left py-1 pr-2">Close</th>
                </tr>
              </thead>
              <tbody>
                {draft.days.map((d, i) => (
                  <tr key={i} className="border-t border-[--border]">
                    <td className="py-1.5 pr-2 font-medium text-[--text]">{DAY_ABBR[i]}</td>
                    <td className="py-1.5 pr-2">
                      <input type="checkbox" checked={d.is_closed}
                        onChange={e => setDay(i, { is_closed: e.target.checked })} className="accent-[--accent]" />
                    </td>
                    {(['open_time', 'kitchen_close_time', 'close_time'] as const).map(field => (
                      <td key={field} className="py-1.5 pr-2">
                        <select value={d[field]} disabled={d.is_closed}
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

          <div className="flex gap-2">
            <button onClick={save} disabled={saving}
              className="px-4 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark] disabled:opacity-50">
              {saving ? 'Saving…' : 'Save schedule'}
            </button>
            <button onClick={() => setDraft(null)}
              className="px-4 py-1.5 text-xs border border-[--border-2] text-[--muted] rounded-lg hover:bg-[--surface-2]">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* ── Current schedule ── */}
          {!current ? (
            <div className="bg-white rounded-xl border border-[--border] p-5 text-center space-y-3">
              <p className="text-sm text-[--muted]">No operating hours set. Add your first schedule.</p>
              <button onClick={startAdd}
                className="px-3 py-1.5 text-xs font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">
                + Add schedule
              </button>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-[--border] overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[--border] bg-[--surface-2]">
                <span className="text-xs font-medium text-[--text]">Current schedule · Effective {fmtDate(current.effective_from)}</span>
                <div className="flex gap-2">
                  <button onClick={startEditCurrent}
                    className="px-2.5 py-1 text-[11px] border border-[--border-2] rounded-lg text-[--muted] hover:text-[--text]">Edit current schedule</button>
                  <button onClick={startAdd}
                    className="px-2.5 py-1 text-[11px] font-medium bg-[--accent] text-white rounded-lg hover:bg-[--accent-dark]">+ New schedule</button>
                </div>
              </div>
              <HoursGrid days={daysFromHours(hoursBySchedule[current.id] ?? [])} />
            </div>
          )}

          {/* ── History ── */}
          {past.length > 0 && (
            <div>
              <button onClick={() => setShowHistory(v => !v)}
                className="text-[11px] text-[--muted] hover:text-[--text] underline">
                Past schedules {showHistory ? '▲' : '▼'}
              </button>
              {showHistory && (
                <div className="mt-2 space-y-3">
                  {past.map(s => (
                    <div key={s.id} className={`rounded-xl border border-[--border] overflow-hidden ${s.locked_at ? 'opacity-60' : ''}`}>
                      <div className="px-4 py-2 border-b border-[--border] bg-[--surface-2] text-[11px] text-[--muted]">
                        {s.locked_at && <span className="mr-1" title="Locked">🔒</span>}
                        Effective {fmtDate(s.effective_from)} – {s.effective_until ? fmtDate(s.effective_until) : 'ongoing'}
                      </div>
                      <HoursGrid days={daysFromHours(hoursBySchedule[s.id] ?? [])} />
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

// Read-only 7-row hours grid.
function HoursGrid({ days }: { days: DayDraft[] }) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-[10px] uppercase tracking-wide text-[--hint] border-b border-[--border]">
          <th className="text-left px-4 py-1.5 w-16">Day</th>
          <th className="text-left px-4 py-1.5">Open</th>
          <th className="text-left px-4 py-1.5">Kitchen Close</th>
          <th className="text-left px-4 py-1.5">Close</th>
        </tr>
      </thead>
      <tbody>
        {days.map((d, i) => (
          <tr key={i} className="border-b border-[--border] last:border-0">
            <td className="px-4 py-1.5 font-medium text-[--text]">{DAY_ABBR[i]}</td>
            {d.is_closed ? (
              <td className="px-4 py-1.5 text-[--hint]" colSpan={3}>Closed</td>
            ) : (
              <>
                <td className="px-4 py-1.5 text-[--muted]">{d.open_time || '—'}</td>
                <td className="px-4 py-1.5 text-[--muted]">{d.kitchen_close_time || '—'}</td>
                <td className="px-4 py-1.5 text-[--muted]">{d.close_time || '—'}</td>
              </>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
